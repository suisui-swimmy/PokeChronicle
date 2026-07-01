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

function createEventDedupeKey(parseResult: BattleMessageParseResult) {
  if (parseResult.status === "unknown") {
    return parseResult.matchText ? `unknown:${parseResult.matchText}` : null;
  }

  const actor = `${parseResult.event.actor.side ?? "unknown"}:${parseResult.event.actor.name ?? ""}`;
  const target = parseResult.event.target
    ? `${parseResult.event.target.side ?? "unknown"}:${parseResult.event.target.name ?? ""}`
    : "";

  return [
    "event",
    parseResult.event.type,
    actor,
    parseResult.event.move ?? "",
    target,
    parseResult.event.classification.templateId ?? "",
  ].join("|");
}

function createBattleEvent(input: TimelineObservationInput): BattleEvent | null {
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
  const event = createBattleEvent(input);
  const unknown = createUnknownEvent(input);
  const dedupeKey = event || unknown ? createEventDedupeKey(input.parseResult) : null;

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
