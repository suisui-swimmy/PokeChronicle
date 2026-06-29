import type {
  BattleEvent,
  BattleEventType,
  ClassificationMethod,
} from "../events/schema";
import { createOcrMatchText, normalizeOcrText } from "../normalize/ocrText";
import { matchDictionaryEntry } from "../dictionary/fuzzyMatch";
import { BATTLE_DICTIONARY } from "../dictionary/generatedBattleDictionary";
import type { DictionaryEntry, DictionaryMatch } from "../dictionary/types";

export interface BattleMessageParseInput {
  rawText: string;
  ocrConfidence?: number | null;
}

export interface BattleMessageDictionary {
  pokemon: readonly DictionaryEntry[];
  moves: readonly DictionaryEntry[];
}

export interface ParsedBattleEvent {
  type: BattleEventType;
  actor: BattleEvent["actor"];
  move: string | null;
  target: BattleEvent["target"];
  confidence: number | null;
  classification: BattleEvent["classification"];
}

export interface EventParseResult {
  status: "event";
  rawText: string;
  normalizedText: string;
  matchText: string;
  event: ParsedBattleEvent;
  candidateMatches: string[];
}

export interface UnknownParseResult {
  status: "unknown";
  rawText: string;
  normalizedText: string;
  matchText: string;
  reviewStatus: "unreviewed";
  candidateMatches: string[];
  classification: BattleEvent["classification"];
}

export type BattleMessageParseResult = EventParseResult | UnknownParseResult;

const DEFAULT_ACTOR = { name: null, side: null } satisfies BattleEvent["actor"];

function formatDictionaryCandidate(kind: "pokemon" | "move", match: DictionaryMatch) {
  if (!match.best) {
    return `${kind}:${match.normalizedInput}:not_found:${match.reason}`;
  }

  const score = match.score === null ? "--" : match.score.toFixed(2);
  return `${kind}:${match.normalizedInput}->${match.best}:${match.status}:${score}:${match.reason}`;
}

function combineConfidence(ocrConfidence: number | null | undefined, scores: number[]) {
  const dictionaryConfidence = scores.length > 0 ? Math.min(...scores) : null;

  if (ocrConfidence === null || ocrConfidence === undefined) {
    return dictionaryConfidence;
  }

  if (dictionaryConfidence === null) {
    return ocrConfidence;
  }

  return Math.min(ocrConfidence, dictionaryConfidence);
}

function createClassification(
  method: ClassificationMethod,
  templateId: string | null,
  alternatives: string[] = [],
): BattleEvent["classification"] {
  return {
    method,
    templateId,
    alternatives,
  };
}

function createSimpleEvent(
  type: BattleEventType,
  normalizedText: string,
  matchText: string,
  rawText: string,
  ocrConfidence: number | null | undefined,
  templateId: string,
): EventParseResult {
  return {
    status: "event",
    rawText,
    normalizedText,
    matchText,
    event: {
      type,
      actor: DEFAULT_ACTOR,
      move: null,
      target: null,
      confidence: ocrConfidence ?? 0.9,
      classification: createClassification("seed_rule", templateId),
    },
    candidateMatches: [templateId],
  };
}

function parseContextEvent(
  rawText: string,
  normalizedText: string,
  matchText: string,
  ocrConfidence: number | null | undefined,
) {
  const effectPatterns: Array<[BattleEventType, string, string[]]> = [
    ["supereffective", "effect_supereffective", ["効果はバツグンだ", "効果はバッグンだ", "効果はバックンだ"]],
    ["resisted", "effect_resisted", ["効果はいまひとつ"]],
    ["immune", "effect_immune", ["効果がない", "効果はない"]],
    ["critical", "critical_hit", ["急所"]],
    ["boost", "stat_boost", ["上がった"]],
    ["unboost", "stat_unboost", ["下がった"]],
    ["miss", "move_miss", ["外れた", "あたらなかった"]],
    ["fail", "move_fail", ["失敗", "うまく決まらない"]],
    ["protect", "protect", ["身を守った", "守られた"]],
    ["faint", "faint", ["倒れた", "たおれた", "ひんし"]],
    ["switch_out", "switch_out", ["引っこめた", "ひっこめた"]],
  ];

  for (const [type, templateId, patterns] of effectPatterns) {
    if (patterns.some((pattern) => matchText.includes(createOcrMatchText(pattern)))) {
      return createSimpleEvent(type, normalizedText, matchText, rawText, ocrConfidence, templateId);
    }
  }

  if (matchText.startsWith("ゆけっ") || matchText.startsWith("いけっ")) {
    return createSimpleEvent(
      "switch_in",
      normalizedText,
      matchText,
      rawText,
      ocrConfidence,
      "switch_in_call",
    );
  }

  return null;
}

function splitMoveMessage(matchText: string) {
  const opponentPrefix = "相手の";
  const side: BattleEvent["actor"]["side"] = matchText.startsWith(opponentPrefix)
    ? "opponent"
    : null;
  const body = side === "opponent" ? matchText.slice(opponentPrefix.length) : matchText;
  const candidates: Array<{
    actorText: string;
    moveText: string;
    side: BattleEvent["actor"]["side"];
  }> = [];

  for (let index = 0; index < body.length; index += 1) {
    if (body[index] !== "の") {
      continue;
    }

    if (index <= 0 || index >= body.length - 1) {
      continue;
    }

    candidates.push({
      actorText: body.slice(0, index),
      moveText: body.slice(index + 1),
      side,
    });
  }

  return candidates;
}

function parseMoveEvent(
  rawText: string,
  normalizedText: string,
  matchText: string,
  ocrConfidence: number | null | undefined,
  dictionary: BattleMessageDictionary,
) {
  const parts = splitMoveMessage(matchText);

  if (!parts || parts.length === 0) {
    return null;
  }

  const candidateMatches: string[] = [];

  for (const part of parts) {
    const pokemonMatch = matchDictionaryEntry(part.actorText, dictionary.pokemon, {
      ocrConfidence,
    });
    const moveMatch = matchDictionaryEntry(part.moveText, dictionary.moves, {
      ocrConfidence,
    });
    const partCandidates = [
      formatDictionaryCandidate("pokemon", pokemonMatch),
      formatDictionaryCandidate("move", moveMatch),
    ];
    candidateMatches.push(...partCandidates);

    if (pokemonMatch.status !== "accepted" || moveMatch.status !== "accepted") {
      continue;
    }

    const method: ClassificationMethod =
      pokemonMatch.method === "fuzzy" || moveMatch.method === "fuzzy"
        ? "fuzzy_dictionary"
        : "seed_rule";
    const alternatives = [pokemonMatch, moveMatch]
      .flatMap((match) => [match.secondBest].filter((value): value is string => Boolean(value)))
      .filter((value, index, values) => values.indexOf(value) === index);

    return {
      result: {
        status: "event",
        rawText,
        normalizedText,
        matchText,
        event: {
          type: "move",
          actor: {
            name: pokemonMatch.best,
            side: part.side,
          },
          move: moveMatch.best,
          target: null,
          confidence: combineConfidence(ocrConfidence, [
            pokemonMatch.score ?? 1,
            moveMatch.score ?? 1,
          ]),
          classification: createClassification(method, "attack_actor_move", alternatives),
        },
        candidateMatches: partCandidates,
      } satisfies EventParseResult,
    };
  }

  return { candidateMatches };
}

function createUnknownResult(
  rawText: string,
  normalizedText: string,
  matchText: string,
  candidateMatches: string[],
): UnknownParseResult {
  return {
    status: "unknown",
    rawText,
    normalizedText,
    matchText,
    reviewStatus: "unreviewed",
    candidateMatches,
    classification: createClassification("unknown", null, candidateMatches),
  };
}

export function parseBattleMessage(
  input: string | BattleMessageParseInput,
  dictionary: BattleMessageDictionary = BATTLE_DICTIONARY,
): BattleMessageParseResult {
  const rawText = typeof input === "string" ? input : input.rawText;
  const ocrConfidence = typeof input === "string" ? null : input.ocrConfidence;
  const normalizedText = normalizeOcrText(rawText);
  const matchText = createOcrMatchText(rawText);

  if (!matchText) {
    return createUnknownResult(rawText, normalizedText, matchText, []);
  }

  const contextEvent = parseContextEvent(rawText, normalizedText, matchText, ocrConfidence);

  if (contextEvent) {
    return contextEvent;
  }

  const moveEvent = parseMoveEvent(rawText, normalizedText, matchText, ocrConfidence, dictionary);

  if (moveEvent?.result) {
    return moveEvent.result;
  }

  return createUnknownResult(rawText, normalizedText, matchText, moveEvent?.candidateMatches ?? []);
}
