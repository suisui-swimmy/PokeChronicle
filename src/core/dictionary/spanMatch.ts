import { createOcrMatchText } from "../normalize/ocrText";
import type { DictionaryEntry } from "./types";

export interface DictionarySpan {
  entry: DictionaryEntry;
  key: string;
  start: number;
  end: number;
  method: "exact_span";
}

interface IndexedDictionaryEntry {
  entry: DictionaryEntry;
  key: string;
}

const indexCache = new WeakMap<readonly DictionaryEntry[], readonly IndexedDictionaryEntry[]>();

function createEntryKeys(entry: DictionaryEntry) {
  return [entry.label, ...(entry.aliases ?? [])]
    .map((value) => createOcrMatchText(value))
    .filter(Boolean);
}

function getDictionaryIndex(entries: readonly DictionaryEntry[]) {
  const cached = indexCache.get(entries);

  if (cached) {
    return cached;
  }

  const seen = new Set<string>();
  const index = entries
    .flatMap((entry) =>
      createEntryKeys(entry).map((key) => ({
        entry,
        key,
      })),
    )
    .filter((item) => {
      const cacheKey = `${item.entry.id}:${item.key}`;

      if (seen.has(cacheKey)) {
        return false;
      }

      seen.add(cacheKey);
      return true;
    })
    .sort((left, right) => right.key.length - left.key.length || left.key.localeCompare(right.key));

  indexCache.set(entries, index);
  return index;
}

function overlaps(left: DictionarySpan, right: DictionarySpan) {
  return left.start < right.end && right.start < left.end;
}

export function findDictionarySpans(input: string, entries: readonly DictionaryEntry[]) {
  const matchText = createOcrMatchText(input);

  if (!matchText) {
    return [];
  }

  const candidates: DictionarySpan[] = [];

  for (const item of getDictionaryIndex(entries)) {
    let start = matchText.indexOf(item.key);

    while (start >= 0) {
      candidates.push({
        entry: item.entry,
        key: item.key,
        start,
        end: start + item.key.length,
        method: "exact_span",
      });
      start = matchText.indexOf(item.key, start + 1);
    }
  }

  const accepted: DictionarySpan[] = [];

  for (const candidate of candidates.sort(
    (left, right) =>
      right.key.length - left.key.length ||
      left.start - right.start ||
      left.entry.label.localeCompare(right.entry.label),
  )) {
    if (accepted.some((span) => overlaps(span, candidate))) {
      continue;
    }

    accepted.push(candidate);
  }

  return accepted.sort((left, right) => left.start - right.start || right.key.length - left.key.length);
}
