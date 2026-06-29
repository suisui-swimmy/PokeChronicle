import { createOcrMatchText } from "../normalize/ocrText";
import type { DictionaryEntry, DictionaryMatch } from "./types";

export interface DictionaryMatchOptions {
  acceptScore?: number;
  reviewScore?: number;
  acceptMargin?: number;
  ocrConfidence?: number | null;
  minOcrConfidenceForFuzzy?: number;
}

const DEFAULT_ACCEPT_SCORE = 0.84;
const DEFAULT_REVIEW_SCORE = 0.72;
const DEFAULT_ACCEPT_MARGIN = 0.08;
const DEFAULT_MIN_OCR_CONFIDENCE_FOR_FUZZY = 0.65;

interface ScoredDictionaryEntry {
  entry: DictionaryEntry;
  key: string;
  score: number;
}

function toCharacters(value: string) {
  return Array.from(value);
}

export function levenshteinDistance(left: string, right: string) {
  const leftChars = toCharacters(left);
  const rightChars = toCharacters(right);
  const previous = Array.from({ length: rightChars.length + 1 }, (_, index) => index);
  const current = Array.from({ length: rightChars.length + 1 }, () => 0);

  for (let leftIndex = 1; leftIndex <= leftChars.length; leftIndex += 1) {
    current[0] = leftIndex;

    for (let rightIndex = 1; rightIndex <= rightChars.length; rightIndex += 1) {
      const cost = leftChars[leftIndex - 1] === rightChars[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + cost,
      );
    }

    for (let index = 0; index < previous.length; index += 1) {
      previous[index] = current[index];
    }
  }

  return previous[rightChars.length];
}

export function normalizedSimilarity(left: string, right: string) {
  if (left === right) {
    return 1;
  }

  const longestLength = Math.max(toCharacters(left).length, toCharacters(right).length);

  if (longestLength === 0) {
    return 1;
  }

  return 1 - levenshteinDistance(left, right) / longestLength;
}

function createEntryKeys(entry: DictionaryEntry) {
  return [entry.label, ...(entry.aliases ?? [])].map((value) => createOcrMatchText(value));
}

function createNoMatch(input: string, normalizedInput: string, reason: string): DictionaryMatch {
  return {
    input,
    normalizedInput,
    best: null,
    bestEntry: null,
    score: null,
    secondBest: null,
    secondScore: null,
    status: "not_found",
    method: "none",
    reason,
  };
}

export function matchDictionaryEntry(
  input: string,
  entries: readonly DictionaryEntry[],
  options: DictionaryMatchOptions = {},
): DictionaryMatch {
  const normalizedInput = createOcrMatchText(input);

  if (!normalizedInput) {
    return createNoMatch(input, normalizedInput, "empty-input");
  }

  for (const entry of entries) {
    if (createEntryKeys(entry).includes(normalizedInput)) {
      return {
        input,
        normalizedInput,
        best: entry.label,
        bestEntry: entry,
        score: 1,
        secondBest: null,
        secondScore: null,
        status: "accepted",
        method: "exact",
        reason: "exact-match",
      };
    }
  }

  const scoredEntries = entries
    .map<ScoredDictionaryEntry>((entry) => {
      const score = Math.max(
        ...createEntryKeys(entry).map((key) => normalizedSimilarity(normalizedInput, key)),
      );

      return {
        entry,
        key: createOcrMatchText(entry.label),
        score,
      };
    })
    .sort((left, right) => right.score - left.score);

  const best = scoredEntries[0] ?? null;

  if (!best) {
    return createNoMatch(input, normalizedInput, "empty-dictionary");
  }

  const second = scoredEntries[1] ?? null;
  const acceptScore = options.acceptScore ?? DEFAULT_ACCEPT_SCORE;
  const reviewScore = options.reviewScore ?? DEFAULT_REVIEW_SCORE;
  const acceptMargin = options.acceptMargin ?? DEFAULT_ACCEPT_MARGIN;
  const minOcrConfidence =
    options.minOcrConfidenceForFuzzy ?? DEFAULT_MIN_OCR_CONFIDENCE_FOR_FUZZY;
  const margin = best.score - (second?.score ?? 0);
  const hasEnoughOcrConfidence =
    options.ocrConfidence === null ||
    options.ocrConfidence === undefined ||
    options.ocrConfidence >= minOcrConfidence;
  const commonFields = {
    input,
    normalizedInput,
    best: best.entry.label,
    bestEntry: best.entry,
    score: best.score,
    secondBest: second?.entry.label ?? null,
    secondScore: second?.score ?? null,
    method: "fuzzy" as const,
  };

  if (best.score >= acceptScore && margin >= acceptMargin && hasEnoughOcrConfidence) {
    return {
      ...commonFields,
      status: "accepted",
      reason: `score>=${acceptScore} margin>=${acceptMargin}`,
    };
  }

  if (best.score >= reviewScore) {
    return {
      ...commonFields,
      status: "needs_review",
      reason: hasEnoughOcrConfidence ? "low-score-or-margin" : "low-ocr-confidence",
    };
  }

  return {
    ...commonFields,
    status: "not_found",
    reason: "below-review-score",
  };
}
