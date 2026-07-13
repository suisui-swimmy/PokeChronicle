import type { OCRResult } from "./types";
import {
  getParsedBattleEvents,
  type BattleMessageParseResult,
  type ParsedBattleEvent,
  type UnknownParseResult,
} from "../parser/seedParser";
import type {
  OCRCandidateStrategy,
  OCRWorkerRecognitionCandidate,
} from "./workerMessages";

export interface EvaluatedOcrCandidate {
  candidate: OCRWorkerRecognitionCandidate;
  result: OCRResult;
  parseResult: BattleMessageParseResult;
  durationMs: number;
}

export interface OcrCandidateAssessment {
  score: number;
  isStrong: boolean;
  eventSignatures: string[];
  reason: string;
}

export interface OcrCandidateSelection {
  selected: EvaluatedOcrCandidate;
  parseResult: BattleMessageParseResult;
  conflict: boolean;
  reason: string;
  assessments: Map<string, OcrCandidateAssessment>;
}

const ACTOR_OR_TARGET_EVENT_TYPES = new Set<ParsedBattleEvent["type"]>([
  "damage",
  "heal",
  "status",
  "status_cure",
  "boost",
  "unboost",
  "protect",
  "miss",
  "fail",
  "item",
  "ability",
  "activate",
  "flinch",
]);

function hasRequiredSlots(event: ParsedBattleEvent) {
  if (event.type === "move") {
    return Boolean(event.actor.name && event.move);
  }

  if (["switch_in", "switch_out", "faint"].includes(event.type)) {
    return Boolean(event.actor.name);
  }

  if (ACTOR_OR_TARGET_EVENT_TYPES.has(event.type)) {
    return Boolean(event.actor.name || event.target?.name);
  }

  return true;
}

function createEventSignature(event: ParsedBattleEvent) {
  return [
    event.type,
    event.actor.side ?? "unknown",
    event.actor.name ?? "",
    event.move ?? "",
    event.target?.side ?? "unknown",
    event.target?.name ?? "",
  ].join("|");
}

function unique<T>(values: readonly T[]) {
  return [...new Set(values)];
}

function createEventBundleSignature(eventSignatures: readonly string[]) {
  return [...eventSignatures].sort().join("\n");
}

function isHighSignalFaintCandidate(
  events: readonly ParsedBattleEvent[],
  matchText: string,
  ocrConfidence: number,
  eventConfidence: number,
) {
  return (
    events.length === 1 &&
    events[0].type === "faint" &&
    Boolean(events[0].actor.name) &&
    /(?:倒れ|たおれ|たおあれ|だおれ|おれだ|ひんし)/u.test(matchText) &&
    ocrConfidence >= 0.75 &&
    eventConfidence >= 0.78
  );
}

function isHighSignalDegradedSwitchInCandidate(
  events: readonly ParsedBattleEvent[],
  ocrConfidence: number,
  eventConfidence: number,
) {
  return (
    events.length === 1 &&
    events[0].type === "switch_in" &&
    Boolean(events[0].actor.name) &&
    events[0].classification.templateId === "switch_in_degraded_call" &&
    ocrConfidence >= 0.7 &&
    eventConfidence >= 0.68
  );
}

export function assessOcrCandidate(candidate: EvaluatedOcrCandidate): OcrCandidateAssessment {
  const normalizedLength = Array.from(candidate.parseResult.normalizedText).length;
  const ocrConfidence = candidate.result.confidence ?? 0;

  if (candidate.parseResult.status === "unknown") {
    return {
      score: Math.min(30, normalizedLength) + ocrConfidence * 5,
      isStrong: false,
      eventSignatures: [],
      reason: normalizedLength === 0 ? "empty" : "unknown",
    };
  }

  const events = getParsedBattleEvents(candidate.parseResult);
  const slotsComplete = events.length > 0 && events.every(hasRequiredSlots);
  const eventConfidence = Math.min(
    ...events.map((event) => event.confidence ?? ocrConfidence),
  );
  const methods = events.map((event) => event.classification.method);
  const hasOnlyStrongMethods = methods.every(
    (method) => method === "seed_rule" || method === "template_dictionary",
  );
  const hasFuzzyMethod = methods.some((method) => method === "fuzzy_dictionary");
  const hasHighSignalFaint = isHighSignalFaintCandidate(
    events,
    candidate.parseResult.matchText,
    ocrConfidence,
    eventConfidence,
  );
  const hasHighSignalDegradedSwitchIn = isHighSignalDegradedSwitchInCandidate(
    events,
    ocrConfidence,
    eventConfidence,
  );
  const isStrong =
    slotsComplete &&
    normalizedLength >= 3 &&
    (hasOnlyStrongMethods ||
      hasHighSignalFaint ||
      hasHighSignalDegradedSwitchIn ||
      (hasFuzzyMethod && eventConfidence >= 0.82));
  const methodScore = hasOnlyStrongMethods
    ? 18
    : hasHighSignalFaint || hasHighSignalDegradedSwitchIn
      ? 14
      : hasFuzzyMethod
        ? 7
        : 3;

  return {
    score:
      100 +
      (slotsComplete ? 24 : 0) +
      methodScore +
      eventConfidence * 10 +
      Math.min(10, normalizedLength / 3),
    isStrong,
    eventSignatures: unique(events.map(createEventSignature)),
    reason: !slotsComplete
      ? "missing-required-slot"
      : isStrong
        ? "strong-event"
        : "weak-event",
  };
}

export function shouldRetryOcrCandidate(candidate: EvaluatedOcrCandidate) {
  return !assessOcrCandidate(candidate).isStrong;
}

function createConflictParseResult(
  selected: EvaluatedOcrCandidate,
  signatures: readonly string[],
): UnknownParseResult {
  const candidateMatches = [
    ...selected.parseResult.candidateMatches,
    ...signatures.map((signature) => `ocr-conflict:${signature}`),
  ];

  return {
    status: "unknown",
    rawText: selected.result.rawText,
    normalizedText: selected.parseResult.normalizedText,
    matchText: selected.parseResult.matchText,
    reviewStatus: "unreviewed",
    candidateMatches: unique(candidateMatches),
    classification: {
      method: "unknown",
      templateId: null,
      alternatives: unique(candidateMatches),
    },
  };
}

export function selectOcrCandidate(
  candidates: readonly EvaluatedOcrCandidate[],
): OcrCandidateSelection {
  if (candidates.length === 0) {
    throw new Error("OCR candidate selection requires at least one candidate.");
  }

  const assessments = new Map(
    candidates.map((candidate) => [candidate.candidate.id, assessOcrCandidate(candidate)]),
  );
  const ranked = [...candidates].sort((left, right) => {
    const scoreDelta =
      (assessments.get(right.candidate.id)?.score ?? 0) -
      (assessments.get(left.candidate.id)?.score ?? 0);

    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    return (right.result.confidence ?? 0) - (left.result.confidence ?? 0);
  });
  const selected = ranked[0];
  const strongAssessments = candidates.flatMap((candidate) => {
    const assessment = assessments.get(candidate.candidate.id);
    return assessment?.isStrong ? [assessment] : [];
  });
  const strongBundles = unique(
    strongAssessments.map((assessment) =>
      createEventBundleSignature(assessment.eventSignatures),
    ),
  );
  const conflict = strongBundles.length > 1;
  const selectedAssessment = assessments.get(selected.candidate.id);

  if (conflict) {
    const strongSignatures = unique(
      strongAssessments.flatMap((assessment) => assessment.eventSignatures),
    );

    return {
      selected,
      parseResult: createConflictParseResult(selected, strongSignatures),
      conflict: true,
      reason: "conflicting-strong-events",
      assessments,
    };
  }

  if (!selectedAssessment?.isStrong && selected.parseResult.status === "event") {
    return {
      selected,
      parseResult: createConflictParseResult(
        selected,
        (selectedAssessment?.eventSignatures ?? []).map((signature) => `held:${signature}`),
      ),
      conflict: false,
      reason: "weak-event-held-for-review",
      assessments,
    };
  }

  return {
    selected,
    parseResult: selected.parseResult,
    conflict: false,
    reason: selectedAssessment?.isStrong ? "strong-event-selected" : "best-unknown-selected",
    assessments,
  };
}

export function createRecognitionCandidate(
  input: {
    id: string;
    variantId: string;
    strategy: OCRCandidateStrategy;
    segments: OCRWorkerRecognitionCandidate["segments"];
  },
): OCRWorkerRecognitionCandidate {
  return {
    id: input.id,
    variantId: input.variantId,
    strategy: input.strategy,
    segments: input.segments.slice(0, 3),
  };
}
