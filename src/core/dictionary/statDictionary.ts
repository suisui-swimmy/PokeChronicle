import type { DictionaryEntry } from "./types";

export const STAT_DICTIONARY: readonly DictionaryEntry[] = [
  { id: "stat:attack", label: "攻撃" },
  { id: "stat:defense", label: "防御" },
  { id: "stat:special-attack", label: "特攻" },
  { id: "stat:special-defense", label: "特防" },
  { id: "stat:speed", label: "素早さ", aliases: ["すばやさ"] },
  { id: "stat:accuracy", label: "命中率" },
  { id: "stat:evasion", label: "回避率" },
];
