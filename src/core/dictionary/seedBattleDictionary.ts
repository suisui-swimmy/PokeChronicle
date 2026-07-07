import type { DictionaryEntry } from "./types";
import { STAT_DICTIONARY } from "./statDictionary";

export const SEED_POKEMON_DICTIONARY: readonly DictionaryEntry[] = [
  { id: "pokemon:whimsicott", label: "エルフーン" },
  { id: "pokemon:delphox", label: "マフォクシー" },
  { id: "pokemon:malamar", label: "カラマネロ" },
  { id: "pokemon:grimmsnarl", label: "オーロンゲ" },
];

export const SEED_MOVE_DICTIONARY: readonly DictionaryEntry[] = [
  { id: "move:tailwind", label: "おいかぜ" },
  { id: "move:protect", label: "まもる" },
  { id: "move:encore", label: "アンコール" },
  { id: "move:spirit-break", label: "ソウルクラッシュ" },
];

export const SEED_BATTLE_DICTIONARY = {
  pokemon: SEED_POKEMON_DICTIONARY,
  moves: SEED_MOVE_DICTIONARY,
  stats: STAT_DICTIONARY,
} as const;
