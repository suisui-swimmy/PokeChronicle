export interface DictionaryEntry {
  id: string;
  label: string;
  aliases?: string[];
}

export type DictionaryMatchStatus = "accepted" | "needs_review" | "not_found";

export type DictionaryMatchMethod = "exact" | "fuzzy" | "none";

export interface DictionaryMatch {
  input: string;
  normalizedInput: string;
  best: string | null;
  bestEntry: DictionaryEntry | null;
  score: number | null;
  secondBest: string | null;
  secondScore: number | null;
  status: DictionaryMatchStatus;
  method: DictionaryMatchMethod;
  reason: string;
}
