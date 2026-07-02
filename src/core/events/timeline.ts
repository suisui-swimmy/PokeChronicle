import type {
  BattleEvent,
  NormalizedRoi,
  OCRLine,
  OCRMessage,
  UnknownEvent,
} from "./schema";
import type { BattleMessageParseResult } from "../parser/seedParser";

export const DEFAULT_TIMELINE_DUPLICATE_WINDOW_MS = 2500;

export interface TimelineObservationInput {
  id: string;
  battleId: string;
  rawText: string;
  parseResult: BattleMessageParseResult;
  ocrConfidence: number | null;
  lines: readonly OCRLine[];
  frameIndex: number | null;
  timestampMs: number;
  roi: NormalizedRoi;
  afterEventId: string | null;
  recentConstrainedCandidates?: readonly TimelineConstrainedCandidateRecord[];
  candidatePromotionWindowMs?: number;
}

export interface TimelineDeduplicationRecord {
  id: string;
  key: string;
  kind: "event" | "unknown";
  timestampMs: number;
  frameIndex: number | null;
}

export interface TimelineObservation {
  ocrMessage: OCRMessage;
  event: BattleEvent | null;
  unknown: UnknownEvent | null;
  dedupe: TimelineDeduplicationRecord | null;
}

export interface TimelineConstrainedCandidateRecord {
  identity: string;
  timestampMs: number;
  frameIndex: number | null;
}

interface ParsedConstrainedCandidateMatch {
  identity: string;
  eventType: BattleEvent["type"];
  actorName: string | null;
  actorSide: BattleEvent["actor"]["side"];
  move: string | null;
  targetName: string | null;
  targetSide: NonNullable<BattleEvent["target"]>["side"] | null;
  templateId: string | null;
  score: number | null;
}

export function createSourceFrameRef(frameIndex: number | null, timestampMs: number) {
  return frameIndex === null ? `time:${timestampMs}` : `frame:${frameIndex}:${timestampMs}`;
}

function countCharacters(value: string) {
  return Array.from(value).length;
}

function containsJapaneseText(value: string) {
  return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(value);
}

export function shouldCreateUnknownEvent(input: {
  matchText: string;
  normalizedText: string;
  ocrConfidence: number | null;
  candidateMatches: readonly string[];
}) {
  const matchText = input.matchText.trim();

  if (!matchText) {
    return false;
  }

  const matchTextLength = countCharacters(matchText);

  if (matchTextLength >= 6 && (input.ocrConfidence ?? 0) >= 0.7) {
    return true;
  }

  if (input.candidateMatches.length > 0 && matchTextLength >= 3) {
    return true;
  }

  return containsJapaneseText(input.normalizedText) && matchTextLength >= 8;
}

function createResolvedEventDedupeKey(
  event: Pick<BattleEvent, "type" | "actor" | "move" | "target" | "classification">,
) {
  const actor = `${event.actor.side ?? "unknown"}:${event.actor.name ?? ""}`;
  const target = event.target
    ? `${event.target.side ?? "unknown"}:${event.target.name ?? ""}`
    : "";

  return [
    "event",
    event.type,
    actor,
    event.move ?? "",
    target,
    event.classification.templateId ?? "",
  ].join("|");
}

function decodeCandidateValue(value: string | undefined) {
  if (!value) {
    return "";
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseNullableSide(value: string): BattleEvent["actor"]["side"] {
  return value === "player" || value === "opponent" ? value : null;
}

function parseTargetSide(value: string): NonNullable<BattleEvent["target"]>["side"] | null {
  return value === "player" || value === "opponent" ? value : null;
}

function extractConstrainedCandidateMatch(
  candidateMatches: readonly string[],
): ParsedConstrainedCandidateMatch | null {
  const encoded = candidateMatches.find((candidate) =>
    candidate.startsWith("constrained-candidate;"),
  );

  if (!encoded) {
    return null;
  }

  const fields = new Map<string, string>();

  for (const part of encoded.split(";").slice(1)) {
    const separatorIndex = part.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    fields.set(part.slice(0, separatorIndex), part.slice(separatorIndex + 1));
  }

  const identity = decodeCandidateValue(fields.get("identity"));
  const eventType = decodeCandidateValue(fields.get("eventType")) as BattleEvent["type"];
  const templateId = decodeCandidateValue(fields.get("templateId"));

  if (!identity || !eventType || eventType === "unknown") {
    return null;
  }

  const actorName = decodeCandidateValue(fields.get("actorName"));
  const move = decodeCandidateValue(fields.get("move"));
  const targetName = decodeCandidateValue(fields.get("targetName"));
  const rawScore = Number(decodeCandidateValue(fields.get("score")));

  return {
    identity,
    eventType,
    actorName: actorName || null,
    actorSide: parseNullableSide(decodeCandidateValue(fields.get("actorSide"))),
    move: move || null,
    targetName: targetName || null,
    targetSide: parseTargetSide(decodeCandidateValue(fields.get("targetSide"))),
    templateId: templateId || null,
    score: Number.isFinite(rawScore) ? rawScore : null,
  };
}

function getPromotedConstrainedCandidate(
  input: TimelineObservationInput,
): ParsedConstrainedCandidateMatch | null {
  if (input.parseResult.status !== "unknown") {
    return null;
  }

  const candidate = extractConstrainedCandidateMatch(input.parseResult.candidateMatches);

  if (!candidate) {
    return null;
  }

  const windowMs = input.candidatePromotionWindowMs ?? DEFAULT_TIMELINE_DUPLICATE_WINDOW_MS;
  const hasRecentMatch = (input.recentConstrainedCandidates ?? []).some((record) => {
    const deltaMs = input.timestampMs - record.timestampMs;

    return record.identity === candidate.identity && deltaMs >= 0 && deltaMs <= windowMs;
  });

  return hasRecentMatch ? candidate : null;
}

export function createConstrainedCandidateRecord(
  parseResult: BattleMessageParseResult,
  timestampMs: number,
  frameIndex: number | null,
): TimelineConstrainedCandidateRecord | null {
  const candidate = extractConstrainedCandidateMatch(parseResult.candidateMatches);

  if (!candidate) {
    return null;
  }

  return {
    identity: candidate.identity,
    timestampMs,
    frameIndex,
  };
}

function createBattleEvent(
  input: TimelineObservationInput,
  promotedCandidate: ParsedConstrainedCandidateMatch | null,
): BattleEvent | null {
  if (input.parseResult.status !== "event" && !promotedCandidate) {
    return null;
  }

  if (promotedCandidate) {
    return {
      id: `evt_${input.id}`,
      battleId: input.battleId,
      turn: null,
      timestampMs: input.timestampMs,
      type: promotedCandidate.eventType,
      actor: {
        name: promotedCandidate.actorName,
        side: promotedCandidate.actorSide,
      },
      move: promotedCandidate.move,
      target: promotedCandidate.targetName
        ? {
            name: promotedCandidate.targetName,
            side: promotedCandidate.targetSide,
          }
        : null,
      rawText: input.rawText,
      normalizedText: input.parseResult.normalizedText,
      confidence:
        input.ocrConfidence === null
          ? promotedCandidate.score
          : promotedCandidate.score === null
            ? input.ocrConfidence
            : Math.min(input.ocrConfidence, promotedCandidate.score),
      classification: {
        method: "template_dictionary",
        templateId: promotedCandidate.templateId,
        alternatives: [...input.parseResult.candidateMatches],
      },
      source: {
        frameIndex: input.frameIndex,
        timestampMs: input.timestampMs,
        cropObjectUrl: null,
      },
    };
  }

  if (input.parseResult.status !== "event") {
    return null;
  }

  const event = input.parseResult.event;

  return {
    id: `evt_${input.id}`,
    battleId: input.battleId,
    turn: null,
    timestampMs: input.timestampMs,
    type: event.type,
    actor: event.actor,
    move: event.move,
    target: event.target,
    rawText: input.rawText,
    normalizedText: input.parseResult.normalizedText,
    confidence: event.confidence,
    classification: event.classification,
    source: {
      frameIndex: input.frameIndex,
      timestampMs: input.timestampMs,
      cropObjectUrl: null,
    },
  };
}

function createUnknownEvent(input: TimelineObservationInput): UnknownEvent | null {
  if (input.parseResult.status !== "unknown" || !input.parseResult.matchText) {
    return null;
  }

  if (
    !shouldCreateUnknownEvent({
      matchText: input.parseResult.matchText,
      normalizedText: input.parseResult.normalizedText,
      ocrConfidence: input.ocrConfidence,
      candidateMatches: input.parseResult.candidateMatches,
    })
  ) {
    return null;
  }

  return {
    id: `unk_${input.id}`,
    battleId: input.battleId,
    timestampMs: input.timestampMs,
    afterEventId: input.afterEventId,
    rawText: input.rawText,
    normalizedText: input.parseResult.normalizedText,
    ocrConfidence: input.ocrConfidence,
    candidateMatches: [...input.parseResult.candidateMatches],
    sourceFrameRef: createSourceFrameRef(input.frameIndex, input.timestampMs),
    reviewStatus: "unreviewed",
  };
}

export function createTimelineObservation(input: TimelineObservationInput): TimelineObservation {
  const ocrMessage: OCRMessage = {
    id: input.id,
    battleId: input.battleId,
    rawText: input.rawText,
    normalizedText: input.parseResult.normalizedText,
    matchText: input.parseResult.matchText,
    ocrConfidence: input.ocrConfidence,
    timestampMs: input.timestampMs,
    frameIndex: input.frameIndex,
    roi: input.roi,
    lines: [...input.lines],
  };
  const promotedCandidate = getPromotedConstrainedCandidate(input);
  const event = createBattleEvent(input, promotedCandidate);
  const unknown = event ? null : createUnknownEvent(input);
  const dedupeKey = event
    ? createResolvedEventDedupeKey(event)
    : unknown && input.parseResult.matchText
      ? `unknown:${input.parseResult.matchText}`
      : null;

  return {
    ocrMessage,
    event,
    unknown,
    dedupe: dedupeKey
      ? {
          id: event?.id ?? unknown?.id ?? input.id,
          key: dedupeKey,
          kind: event ? "event" : "unknown",
          timestampMs: input.timestampMs,
          frameIndex: input.frameIndex,
        }
      : null,
  };
}

export function shouldSuppressTimelineObservation(
  previous: TimelineDeduplicationRecord | null,
  next: TimelineDeduplicationRecord | null,
  windowMs = DEFAULT_TIMELINE_DUPLICATE_WINDOW_MS,
) {
  if (!previous || !next || previous.key !== next.key) {
    return false;
  }

  const deltaMs = next.timestampMs - previous.timestampMs;

  return deltaMs >= 0 && deltaMs <= windowMs;
}
