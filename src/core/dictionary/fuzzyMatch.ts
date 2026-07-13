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
  new Set(["ブ", "プ", "フ", "ぶ", "ぷ", "ふ"]),
  new Set(["ッ", "ツ", "っ", "つ"]),
  new Set(["シ", "ツ", "ソ", "ン"]),
  new Set(["ト", "ド"]),
  new Set(["ミ", "三"]),
];

const kanaScriptFoldCache = new Map<string, string>();
const ocrConfusableCache = new Map<string, boolean>();
const keyedEntriesCache = new WeakMap<readonly DictionaryEntry[], KeyedDictionaryEntry[]>();
const similarityScoreCache = new Map<string, number>();
const MAX_SIMILARITY_SCORE_CACHE_SIZE = 50000;

function getNormalizedOcrChar(value: string) {
  return SMALL_KANA_MAP.get(value) ?? value;
}

function foldKanaScript(value: string) {
  const cached = kanaScriptFoldCache.get(value);

  if (cached !== undefined) {
    return cached;
  }

  const codePoint = value.codePointAt(0);

  if (codePoint === undefined) {
    kanaScriptFoldCache.set(value, value);
    return value;
  }

  if (codePoint >= 0x30a1 && codePoint <= 0x30f6) {
    const folded = String.fromCodePoint(codePoint - 0x60);
    kanaScriptFoldCache.set(value, folded);
    return folded;
  }

  kanaScriptFoldCache.set(value, value);
  return value;
}

function createCharPairKey(left: string, right: string) {
  return left <= right ? `${left}\u0000${right}` : `${right}\u0000${left}`;
}

function createSimilarityScoreCacheKey(
  normalizedInput: string,
  key: string,
  mode: DictionaryMatchOptions["similarity"],
) {
  return `${mode ?? "standard"}\u0000${normalizedInput}\u0000${key}`;
}

function areSameOcrSound(left: string, right: string) {
  return getNormalizedOcrChar(left) === getNormalizedOcrChar(right);
}

function areOcrConfusable(left: string, right: string) {
  const normalizedLeft = getNormalizedOcrChar(left);
  const normalizedRight = getNormalizedOcrChar(right);

  if (normalizedLeft === normalizedRight) {
    return true;
  }

  const cacheKey = createCharPairKey(normalizedLeft, normalizedRight);
  const cached = ocrConfusableCache.get(cacheKey);

  if (cached !== undefined) {
    return cached;
  }

  const isConfusable = OCR_CONFUSION_GROUPS.some(
    (group) => group.has(normalizedLeft) && group.has(normalizedRight),
  );
  ocrConfusableCache.set(cacheKey, isConfusable);
  return isConfusable;
}

function substitutionCost(left: string, right: string) {
  if (left === right) {
    return 0;
  }

  if (areSameOcrSound(left, right)) {
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

  if (index > 0 && areSameOcrSound(chars[index - 1], char)) {
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

function hasHiragana(value: string) {
  return /[ぁ-ん]/u.test(value);
}

function hasKatakana(value: string) {
  return /[ァ-ヶ]/u.test(value);
}

function foldKanaScriptText(value: string) {
  return toCharacters(value)
    .map((char) => foldKanaScript(getNormalizedOcrChar(char)))
    .join("");
}

function collapseRepeatedCharacters(value: string) {
  let collapsed = "";

  for (const char of toCharacters(value)) {
    if (collapsed.endsWith(char)) {
      continue;
    }

    collapsed += char;
  }

  return collapsed;
}

function createMixedKanaOcrVariant(value: string) {
  if (!hasHiragana(value) || !hasKatakana(value)) {
    return null;
  }

  const variant = collapseRepeatedCharacters(foldKanaScriptText(value));
  return variant === value ? null : variant;
}

function getKeyedDictionaryEntries(entries: readonly DictionaryEntry[]) {
  const cached = keyedEntriesCache.get(entries);

  if (cached) {
    return cached;
  }

  const keyedEntries = entries.map((entry) => ({
    entry,
    keys: createEntryKeys(entry),
  }));
  keyedEntriesCache.set(entries, keyedEntries);
  return keyedEntries;
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
  const cacheKey = createSimilarityScoreCacheKey(normalizedInput, key, mode);
  const cached = similarityScoreCache.get(cacheKey);

  if (cached !== undefined) {
    return cached;
  }

  let score: number;

  if (mode !== "ocr_weighted") {
    score = normalizedSimilarity(normalizedInput, key);
  } else {
    const lengthDelta = Math.abs(countCharacters(normalizedInput) - countCharacters(key));
    const lengthPenalty = Math.max(0, lengthDelta - 1) * 0.08;

    score = Math.max(0, normalizedOcrWeightedSimilarity(normalizedInput, key) - lengthPenalty);

    const mixedKanaVariant = createMixedKanaOcrVariant(normalizedInput);

    if (mixedKanaVariant) {
      const foldedKey = foldKanaScriptText(key);
      const variantLengthDelta = Math.abs(
        countCharacters(mixedKanaVariant) - countCharacters(foldedKey),
      );
      const variantLengthPenalty = Math.max(0, variantLengthDelta - 1) * 0.08;

      score = Math.max(
        score,
        normalizedOcrWeightedSimilarity(mixedKanaVariant, foldedKey) - variantLengthPenalty,
      );
    }
  }

  if (similarityScoreCache.size >= MAX_SIMILARITY_SCORE_CACHE_SIZE) {
    similarityScoreCache.clear();
  }

  similarityScoreCache.set(cacheKey, score);
  return score;
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

  const keyedEntries = getKeyedDictionaryEntries(entries);

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
  let best: ScoredDictionaryEntry | null = null;
  let second: ScoredDictionaryEntry | null = null;

  for (const { entry, keys } of keyedEntries) {
    let score = 0;

    for (const key of keys) {
      if (Math.abs(countCharacters(normalizedInput) - countCharacters(key)) > maxLengthDelta) {
        continue;
      }

      score = Math.max(score, scoreEntryKey(normalizedInput, key, options.similarity));
    }

    const scoredEntry = { entry, score };

    if (!best || scoredEntry.score > best.score) {
      second = best;
      best = scoredEntry;
    } else if (!second || scoredEntry.score > second.score) {
      second = scoredEntry;
    }
  }

  if (!best) {
    return createNoMatch(input, normalizedInput, "empty-dictionary");
  }

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
