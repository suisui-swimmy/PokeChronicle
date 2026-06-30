import type {
  BattleEvent,
  BattleEventType,
  ClassificationMethod,
} from "../events/schema";
import { createOcrMatchText, normalizeOcrText } from "../normalize/ocrText";
import { matchDictionaryEntry } from "../dictionary/fuzzyMatch";
import { BATTLE_DICTIONARY } from "../dictionary/generatedBattleDictionary";
import { findDictionarySpans, type DictionarySpan } from "../dictionary/spanMatch";
import type { DictionaryEntry, DictionaryMatch } from "../dictionary/types";

export interface BattleMessageParseInput {
  rawText: string;
  ocrConfidence?: number | null;
  lines?: readonly string[];
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
const OPPONENT_PREFIX = "相手の";
const MAX_INLINE_GAP_NOISE = 4;
const MAX_CANDIDATE_MATCHES = 16;

interface MatchSurface {
  id: string;
  text: string;
  matchText: string;
  priority: number;
}

interface SpanMoveCandidate {
  surface: MatchSurface;
  pokemon: DictionarySpan;
  move: DictionarySpan;
  gap: string;
  side: BattleEvent["actor"]["side"];
  confidenceScore: number;
}

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

function pushUniqueCandidate(candidates: string[], value: string) {
  if (candidates.length >= MAX_CANDIDATE_MATCHES || candidates.includes(value)) {
    return;
  }

  candidates.push(value);
}

function getSourceLines(rawText: string, lines?: readonly string[]) {
  const sourceLines = lines && lines.length > 0 ? lines : rawText.split(/\r\n?|\n/g);

  return sourceLines
    .map((line) => normalizeOcrText(line))
    .filter(Boolean);
}

function createSurface(id: string, text: string, priority: number): MatchSurface | null {
  const matchText = createOcrMatchText(text);

  if (!matchText) {
    return null;
  }

  return {
    id,
    text,
    matchText,
    priority,
  };
}

function createMatchSurfaces(rawText: string, lines?: readonly string[]) {
  const surfaces: MatchSurface[] = [];
  const seen = new Set<string>();
  const sourceLines = getSourceLines(rawText, lines);
  const fullSurface = createSurface("full", rawText, 0);

  function addSurface(surface: MatchSurface | null) {
    if (!surface || seen.has(surface.matchText)) {
      return;
    }

    seen.add(surface.matchText);
    surfaces.push(surface);
  }

  addSurface(fullSurface);

  sourceLines.forEach((line, index) => {
    addSurface(createSurface(`line:${index + 1}`, line, 20 + index));
  });

  for (const windowSize of [2, 3]) {
    for (let start = 0; start <= sourceLines.length - windowSize; start += 1) {
      addSurface(
        createSurface(
          `lines:${start + 1}-${start + windowSize}`,
          sourceLines.slice(start, start + windowSize).join(""),
          10 + windowSize + start,
        ),
      );
    }
  }

  for (const surface of [...surfaces]) {
    const opponentIndex = surface.matchText.indexOf(OPPONENT_PREFIX);

    if (opponentIndex > 0) {
      addSurface(
        createSurface(
          `${surface.id}:suffix:opponent`,
          surface.matchText.slice(opponentIndex),
          surface.priority + 40,
        ),
      );
    }
  }

  return surfaces.sort((left, right) => left.priority - right.priority);
}

function createPokemonSuffixSurfaces(
  surfaces: readonly MatchSurface[],
  dictionary: BattleMessageDictionary,
) {
  const expanded = [...surfaces];
  const seen = new Set(expanded.map((surface) => surface.matchText));

  for (const surface of surfaces) {
    const [firstPokemon] = findDictionarySpans(surface.matchText, dictionary.pokemon);

    if (!firstPokemon || firstPokemon.start <= 0) {
      continue;
    }

    const matchText = surface.matchText.slice(firstPokemon.start);

    if (seen.has(matchText)) {
      continue;
    }

    seen.add(matchText);
    expanded.push({
      id: `${surface.id}:suffix:pokemon`,
      text: matchText,
      matchText,
      priority: surface.priority + 60,
    });
  }

  return expanded.sort((left, right) => left.priority - right.priority);
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
  surfaces: readonly MatchSurface[],
) {
  const surfaceMatchTexts = [
    matchText,
    ...surfaces.map((surface) => surface.matchText),
  ].filter((value, index, values) => value && values.indexOf(value) === index);
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
    if (
      patterns.some((pattern) => {
        const patternText = createOcrMatchText(pattern);
        return surfaceMatchTexts.some((surfaceText) => surfaceText.includes(patternText));
      })
    ) {
      return createSimpleEvent(type, normalizedText, matchText, rawText, ocrConfidence, templateId);
    }
  }

  if (surfaceMatchTexts.some((surfaceText) => surfaceText.startsWith("ゆけっ") || surfaceText.startsWith("いけっ"))) {
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
  const side: BattleEvent["actor"]["side"] = matchText.startsWith(OPPONENT_PREFIX)
    ? "opponent"
    : null;
  const body = side === "opponent" ? matchText.slice(OPPONENT_PREFIX.length) : matchText;
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

function formatSpanHint(
  kind: "pokemon" | "move",
  surface: MatchSurface,
  span: DictionarySpan,
) {
  return `span:${kind}:surface=${surface.id}:value=${span.entry.label}:range=${span.start}-${span.end}:method=${span.method}`;
}

function formatSpanRelationCandidate(candidate: SpanMoveCandidate, status: "accepted" | "rejected", reason: string) {
  const gap = candidate.gap.length > 0 ? candidate.gap : "empty";

  return `span-relation:${status}:surface=${candidate.surface.id}:actor=${candidate.pokemon.entry.label}:move=${candidate.move.entry.label}:gap=${gap}:side=${candidate.side ?? "unknown"}:method=exact_span:reason=${reason}`;
}

function countGapNoise(gap: string) {
  return Array.from(gap.replace(/の/g, "")).length;
}

function inferOpponentSide(surfaceText: string, pokemonStart: number): BattleEvent["actor"]["side"] {
  const prefixStart = Math.max(0, pokemonStart - OPPONENT_PREFIX.length);
  const immediatePrefix = surfaceText.slice(prefixStart, pokemonStart);

  return immediatePrefix === OPPONENT_PREFIX ? "opponent" : null;
}

function findSpanMoveCandidates(
  surface: MatchSurface,
  dictionary: BattleMessageDictionary,
  candidateMatches: string[],
) {
  const pokemonSpans = findDictionarySpans(surface.matchText, dictionary.pokemon);
  const moveSpans = findDictionarySpans(surface.matchText, dictionary.moves);
  const validCandidates: SpanMoveCandidate[] = [];

  for (const pokemon of pokemonSpans) {
    pushUniqueCandidate(candidateMatches, formatSpanHint("pokemon", surface, pokemon));
  }

  for (const move of moveSpans) {
    pushUniqueCandidate(candidateMatches, formatSpanHint("move", surface, move));
  }

  for (const pokemon of pokemonSpans) {
    for (const move of moveSpans) {
      if (pokemon.end > move.start) {
        continue;
      }

      const gap = surface.matchText.slice(pokemon.end, move.start);

      if (!gap.includes("の")) {
        if (move.start - pokemon.end <= MAX_INLINE_GAP_NOISE) {
          pushUniqueCandidate(
            candidateMatches,
            formatSpanRelationCandidate(
              {
                surface,
                pokemon,
                move,
                gap,
                side: inferOpponentSide(surface.matchText, pokemon.start),
                confidenceScore: 0,
              },
              "rejected",
              "missing-possessive-no",
            ),
          );
        }
        continue;
      }

      const gapNoise = countGapNoise(gap);

      if (gapNoise > MAX_INLINE_GAP_NOISE) {
        pushUniqueCandidate(
          candidateMatches,
          formatSpanRelationCandidate(
            {
              surface,
              pokemon,
              move,
              gap,
              side: inferOpponentSide(surface.matchText, pokemon.start),
              confidenceScore: 0,
            },
            "rejected",
            "gap-noise-too-long",
          ),
        );
        continue;
      }

      validCandidates.push({
        surface,
        pokemon,
        move,
        gap,
        side: inferOpponentSide(surface.matchText, pokemon.start),
        confidenceScore: Math.max(0.75, 1 - gapNoise * 0.04),
      });
    }
  }

  return validCandidates.sort(
    (left, right) =>
      right.confidenceScore - left.confidenceScore ||
      left.surface.priority - right.surface.priority ||
      left.pokemon.start - right.pokemon.start,
  );
}

function parseMoveEventFromSpans(
  rawText: string,
  normalizedText: string,
  matchText: string,
  ocrConfidence: number | null | undefined,
  dictionary: BattleMessageDictionary,
  surfaces: readonly MatchSurface[],
) {
  const candidateMatches: string[] = [];
  const expandedSurfaces = createPokemonSuffixSurfaces(surfaces, dictionary);

  for (const surface of expandedSurfaces) {
    const [candidate] = findSpanMoveCandidates(surface, dictionary, candidateMatches);

    if (!candidate) {
      continue;
    }

    const relationCandidate = formatSpanRelationCandidate(candidate, "accepted", "pokemon-no-move");
    const alternatives = [relationCandidate];

    return {
      result: {
        status: "event",
        rawText,
        normalizedText,
        matchText,
        event: {
          type: "move",
          actor: {
            name: candidate.pokemon.entry.label,
            side: candidate.side,
          },
          move: candidate.move.entry.label,
          target: null,
          confidence: combineConfidence(ocrConfidence, [candidate.confidenceScore]),
          classification: createClassification(
            "template_dictionary",
            "attack_actor_move_span",
            alternatives,
          ),
        },
        candidateMatches: [relationCandidate],
      } satisfies EventParseResult,
    };
  }

  return { candidateMatches };
}

function parseMoveEvent(
  rawText: string,
  normalizedText: string,
  matchText: string,
  ocrConfidence: number | null | undefined,
  dictionary: BattleMessageDictionary,
  surfaces: readonly MatchSurface[],
) {
  const parts = splitMoveMessage(matchText);

  if (!parts || parts.length === 0) {
    return parseMoveEventFromSpans(
      rawText,
      normalizedText,
      matchText,
      ocrConfidence,
      dictionary,
      surfaces,
    );
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

  const spanMoveEvent = parseMoveEventFromSpans(
    rawText,
    normalizedText,
    matchText,
    ocrConfidence,
    dictionary,
    surfaces,
  );

  if (spanMoveEvent.result) {
    return spanMoveEvent;
  }

  return { candidateMatches: [...candidateMatches, ...spanMoveEvent.candidateMatches] };
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
  const lines = typeof input === "string" ? undefined : input.lines;
  const normalizedText = normalizeOcrText(rawText);
  const matchText = createOcrMatchText(rawText);
  const surfaces = createMatchSurfaces(rawText, lines);

  if (!matchText) {
    return createUnknownResult(rawText, normalizedText, matchText, []);
  }

  const contextEvent = parseContextEvent(
    rawText,
    normalizedText,
    matchText,
    ocrConfidence,
    surfaces,
  );

  if (contextEvent) {
    return contextEvent;
  }

  const moveEvent = parseMoveEvent(
    rawText,
    normalizedText,
    matchText,
    ocrConfidence,
    dictionary,
    surfaces,
  );

  if (moveEvent?.result) {
    return moveEvent.result;
  }

  return createUnknownResult(rawText, normalizedText, matchText, moveEvent?.candidateMatches ?? []);
}
