import { createOcrMatchText } from "../normalize/ocrText";
import type { DictionaryEntry, DictionaryMatch } from "./types";

export interface DictionaryMatchOptions {
  acceptScore?: number;
  reviewScore?: number;
  acceptMargin?: number;
  ocrConfidence?: number | null;
  minOcrConfidenceForFuzzy?: number;
  similarity?: "standard" | "ocr_weighted";
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

interface KeyedDictionaryEntry {
  entry: DictionaryEntry;
  keys: string[];
}

function toCharacters(value: string) {
  return Array.from(value);
}

function countCharacters(value: string) {
  return toCharacters(value).length;
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

  const longestLength = Math.max(countCharacters(left), countCharacters(right));

  if (longestLength === 0) {
    return 1;
  }

  return 1 - levenshteinDistance(left, right) / longestLength;
}

const SMALL_KANA_MAP = new Map<string, string>([
  ["ァ", "ア"],
  ["ィ", "イ"],
  ["ゥ", "ウ"],
  ["ェ", "エ"],
  ["ォ", "オ"],
  ["ャ", "ヤ"],
  ["ュ", "ユ"],
  ["ョ", "ヨ"],
  ["ぁ", "あ"],
  ["ぃ", "い"],
  ["ぅ", "う"],
  ["ぇ", "え"],
  ["ぉ", "お"],
  ["ゃ", "や"],
  ["ゅ", "ゆ"],
  ["ょ", "よ"],
]);

const OCR_CONFUSION_GROUPS = [
  new Set(["ガ", "カ", "力"]),
  new Set(["ギ", "キ"]),
  new Set(["バ", "パ", "ハ", "八", "六"]),
  new Set(["ブ", "プ", "フ"]),
  new Set(["ッ", "ツ", "つ"]),
  new Set(["シ", "ツ", "ソ", "ン"]),
  new Set(["ト", "ド"]),
  new Set(["ミ", "三"]),
];

function getNormalizedOcrChar(value: string) {
  return SMALL_KANA_MAP.get(value) ?? value;
}

function areOcrConfusable(left: string, right: string) {
  const normalizedLeft = getNormalizedOcrChar(left);
  const normalizedRight = getNormalizedOcrChar(right);

  if (normalizedLeft === normalizedRight) {
    return true;
  }

  return OCR_CONFUSION_GROUPS.some(
    (group) => group.has(normalizedLeft) && group.has(normalizedRight),
  );
}

function substitutionCost(left: string, right: string) {
  if (left === right) {
    return 0;
  }

  if (getNormalizedOcrChar(left) === getNormalizedOcrChar(right)) {
    return 0.15;
  }

  if (areOcrConfusable(left, right)) {
    return 0.35;
  }

  return 1;
}

function insertionDeletionCost(
  chars: readonly string[],
  index: number,
  otherChars: readonly string[],
  otherIndex: number,
) {
  const char = chars[index];

  if (char === "ー") {
    return 0.2;
  }

  if (index > 0 && getNormalizedOcrChar(chars[index - 1]) === getNormalizedOcrChar(char)) {
    return 0.25;
  }

  const nextOtherChar = otherChars[otherIndex];
  const previousOtherChar = otherIndex > 0 ? otherChars[otherIndex - 1] : undefined;

  if (
    (nextOtherChar && areOcrConfusable(char, nextOtherChar)) ||
    (previousOtherChar && areOcrConfusable(char, previousOtherChar))
  ) {
    return 0.35;
  }

  return 1;
}

export function weightedOcrDistance(left: string, right: string) {
  const leftChars = toCharacters(left);
  const rightChars = toCharacters(right);
  const previous = Array.from({ length: rightChars.length + 1 }, (_, index) => index);
  const current = Array.from({ length: rightChars.length + 1 }, () => 0);

  for (let rightIndex = 1; rightIndex <= rightChars.length; rightIndex += 1) {
    previous[rightIndex] =
      previous[rightIndex - 1] +
      insertionDeletionCost(rightChars, rightIndex - 1, leftChars, 0);
  }

  for (let leftIndex = 1; leftIndex <= leftChars.length; leftIndex += 1) {
    current[0] =
      previous[0] + insertionDeletionCost(leftChars, leftIndex - 1, rightChars, 0);

    for (let rightIndex = 1; rightIndex <= rightChars.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] +
          insertionDeletionCost(rightChars, rightIndex - 1, leftChars, leftIndex),
        previous[rightIndex] +
          insertionDeletionCost(leftChars, leftIndex - 1, rightChars, rightIndex),
        previous[rightIndex - 1] +
          substitutionCost(leftChars[leftIndex - 1], rightChars[rightIndex - 1]),
      );
    }

    for (let index = 0; index < previous.length; index += 1) {
      previous[index] = current[index];
    }
  }

  return previous[rightChars.length];
}

export function normalizedOcrWeightedSimilarity(left: string, right: string) {
  if (left === right) {
    return 1;
  }

  const longestLength = Math.max(countCharacters(left), countCharacters(right));

  if (longestLength === 0) {
    return 1;
  }

  return Math.max(0, 1 - weightedOcrDistance(left, right) / longestLength);
}

function createEntryKeys(entry: DictionaryEntry) {
  return [entry.label, ...(entry.aliases ?? [])].map((value) => createOcrMatchText(value));
}

function getOcrWeightedLengthDeltaLimit(inputLength: number) {
  if (inputLength <= 4) {
    return 1;
  }

  if (inputLength <= 8) {
    return 3;
  }

  return 4;
}

function scoreEntryKey(normalizedInput: string, key: string, mode: DictionaryMatchOptions["similarity"]) {
  if (mode !== "ocr_weighted") {
    return normalizedSimilarity(normalizedInput, key);
  }

  const lengthDelta = Math.abs(countCharacters(normalizedInput) - countCharacters(key));
  const lengthPenalty = Math.max(0, lengthDelta - 1) * 0.08;

  return Math.max(0, normalizedOcrWeightedSimilarity(normalizedInput, key) - lengthPenalty);
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

  const keyedEntries: KeyedDictionaryEntry[] = entries.map((entry) => ({
    entry,
    keys: createEntryKeys(entry),
  }));

  for (const keyedEntry of keyedEntries) {
    if (keyedEntry.keys.includes(normalizedInput)) {
      return {
        input,
        normalizedInput,
        best: keyedEntry.entry.label,
        bestEntry: keyedEntry.entry,
        score: 1,
        secondBest: null,
        secondScore: null,
        status: "accepted",
        method: "exact",
        reason: "exact-match",
      };
    }
  }

  const inputLength = countCharacters(normalizedInput);
  const maxLengthDelta =
    options.similarity === "ocr_weighted"
      ? getOcrWeightedLengthDeltaLimit(inputLength)
      : Number.POSITIVE_INFINITY;
  const scoredEntries = keyedEntries
    .map<ScoredDictionaryEntry>(({ entry, keys }) => {
      const candidateKeys = keys.filter(
        (key) => Math.abs(countCharacters(normalizedInput) - countCharacters(key)) <= maxLengthDelta,
      );
      const score =
        candidateKeys.length > 0
          ? Math.max(
              ...candidateKeys.map((key) => scoreEntryKey(normalizedInput, key, options.similarity)),
            )
          : 0;

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
