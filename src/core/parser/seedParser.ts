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
import { decodeConstrainedTemplate } from "../templates/constrainedTemplateDecoder";
import { STANDARD_TEMPLATE_RULES } from "../templates/standardTemplateRules";
import { matchTemplateRules } from "../templates/templateMatcher";
import type { BattleTemplateRule } from "../templates/types";

export interface BattleMessageParseInput {
  rawText: string;
  ocrConfidence?: number | null;
  lines?: readonly string[];
}

export interface BattleMessageDictionary {
  pokemon: readonly DictionaryEntry[];
  moves: readonly DictionaryEntry[];
}

export interface BattleMessageParserOptions {
  templateRules?: readonly BattleTemplateRule[];
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
const RELAXED_STRONG_ACTOR_MOVE_OPTIONS = {
  acceptScore: 0.72,
  reviewScore: 0.68,
  acceptMargin: 0.12,
  minOcrConfidenceForFuzzy: 0.68,
} as const;
const RELAXED_STRONG_MOVE_ACTOR_OPTIONS = {
  acceptScore: 0.62,
  reviewScore: 0.58,
  acceptMargin: 0.1,
  minOcrConfidenceForFuzzy: 0.72,
} as const;
const RELAXED_HP_LOSS_ACTOR_OPTIONS = {
  acceptScore: 0.8,
  reviewScore: 0.72,
  acceptMargin: 0.08,
  minOcrConfidenceForFuzzy: 0.65,
} as const;

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
    [
      "supereffective",
      "effect_supereffective",
      ["効果はバツグンだ", "効果はパツグンだ", "効果はバッグンだ", "効果はパッグンだ", "効果はバックンだ"],
    ],
    ["resisted", "effect_resisted", ["効果はいまひとつ", "効果はいまひとつだ"]],
    ["immune", "effect_immune", ["効果がない", "効果はない"]],
    ["critical", "critical_hit", ["急所"]],
    ["boost", "stat_boost", ["上がった"]],
    ["unboost", "stat_unboost", ["下がった", "下かった", "下がっだ"]],
    ["miss", "move_miss", ["外れた", "あたらなかった"]],
    ["fail", "move_fail", ["失敗", "うまく決まらない"]],
    ["protect", "protect", ["身を守った", "守られた"]],
    ["faint", "faint", ["倒れた", "たおれた", "たおれだ", "だたおれだ", "ひんし"]],
    ["switch_out", "switch_out", ["引っこめた", "ひっこめた"]],
    ["battle_end", "battle_end_surrender", ["降参が選ばれました", "降参が選はばれました"]],
    ["battle_end", "battle_end_loss", ["勝負に負けた", "勝負に口けた"]],
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

function createEventFromDictionaryActor(
  type: BattleEventType,
  rawText: string,
  normalizedText: string,
  matchText: string,
  actorMatch: DictionaryMatch,
  side: BattleEvent["actor"]["side"],
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
      actor: {
        name: actorMatch.best,
        side,
      },
      move: null,
      target: null,
      confidence: combineConfidence(ocrConfidence, [actorMatch.score ?? 1]),
      classification: createClassification(
        actorMatch.method === "fuzzy" ? "fuzzy_dictionary" : "seed_rule",
        templateId,
        [formatDictionaryCandidate("pokemon", actorMatch)],
      ),
    },
    candidateMatches: [formatDictionaryCandidate("pokemon", actorMatch), templateId],
  };
}

function parseHpLossLifeCostEvent(
  rawText: string,
  normalizedText: string,
  matchText: string,
  ocrConfidence: number | null | undefined,
  dictionary: BattleMessageDictionary,
  surfaces: readonly MatchSurface[],
) {
  const candidateMatches: string[] = [];

  for (const surface of surfaces) {
    const match = surface.matchText.match(/(?:(相手の))?(.{2,16}?)は命[がか]少し削られ[ただ]/u);

    if (!match) {
      continue;
    }

    let side: BattleEvent["actor"]["side"] = match[1] ? "opponent" : null;
    let actorText = match[2];
    const opponentPrefixIndex = actorText.lastIndexOf(OPPONENT_PREFIX);

    if (opponentPrefixIndex >= 0) {
      side = "opponent";
      actorText = actorText.slice(opponentPrefixIndex + OPPONENT_PREFIX.length);
    }

    const actorMatch = matchDictionaryEntry(actorText, dictionary.pokemon, {
      ocrConfidence,
      ...RELAXED_HP_LOSS_ACTOR_OPTIONS,
    });

    pushUniqueCandidate(candidateMatches, formatDictionaryCandidate("pokemon", actorMatch));

    if (actorMatch.status !== "accepted") {
      continue;
    }

    return {
      result: createEventFromDictionaryActor(
        "damage",
        rawText,
        normalizedText,
        matchText,
        actorMatch,
        side,
        ocrConfidence,
        "hp_loss_life_cost_noisy",
      ),
      candidateMatches,
    };
  }

  return { candidateMatches };
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
    const side =
      candidate.side ?? inferResolvedActorSide(candidate.pokemon.entry.label, surfaces);

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
            side,
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
    let pokemonMatch = matchDictionaryEntry(part.actorText, dictionary.pokemon, {
      ocrConfidence,
    });
    const strictMoveMatch = matchDictionaryEntry(part.moveText, dictionary.moves, {
      ocrConfidence,
    });
    let moveMatch = strictMoveMatch;
    const partCandidates = [
      formatDictionaryCandidate("pokemon", pokemonMatch),
      formatDictionaryCandidate("move", strictMoveMatch),
    ];

    if (
      pokemonMatch.status === "accepted" &&
      (pokemonMatch.method === "exact" || (pokemonMatch.score ?? 0) >= 0.9) &&
      strictMoveMatch.status !== "accepted"
    ) {
      const relaxedMoveMatch = matchDictionaryEntry(part.moveText, dictionary.moves, {
        ocrConfidence,
        ...RELAXED_STRONG_ACTOR_MOVE_OPTIONS,
      });
      pushUniqueCandidate(
        partCandidates,
        `strong-actor:${formatDictionaryCandidate("move", relaxedMoveMatch)}`,
      );

      if (relaxedMoveMatch.status === "accepted") {
        moveMatch = relaxedMoveMatch;
      }
    }

    if (
      strictMoveMatch.status === "accepted" &&
      (strictMoveMatch.method === "exact" || (strictMoveMatch.score ?? 0) >= 0.94) &&
      pokemonMatch.status !== "accepted"
    ) {
      const relaxedPokemonMatch = matchDictionaryEntry(part.actorText, dictionary.pokemon, {
        ocrConfidence,
        ...RELAXED_STRONG_MOVE_ACTOR_OPTIONS,
      });
      pushUniqueCandidate(
        partCandidates,
        `strong-move:${formatDictionaryCandidate("pokemon", relaxedPokemonMatch)}`,
      );

      if (relaxedPokemonMatch.status === "accepted") {
        pokemonMatch = relaxedPokemonMatch;
      }
    }

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

function parseTemplateEvent(
  rawText: string,
  normalizedText: string,
  matchText: string,
  ocrConfidence: number | null | undefined,
  dictionary: BattleMessageDictionary,
  surfaces: readonly MatchSurface[],
  templateRules: readonly BattleTemplateRule[],
) {
  const templateMatch = matchTemplateRules(surfaces, dictionary, templateRules);

  if (!templateMatch) {
    return null;
  }

  const actor =
    templateMatch.actor.name && !templateMatch.actor.side
      ? {
          ...templateMatch.actor,
          side: inferResolvedActorSide(templateMatch.actor.name, surfaces) ?? templateMatch.actor.side,
        }
      : templateMatch.actor;

  return {
    status: "event",
    rawText,
    normalizedText,
    matchText,
    event: {
      type: templateMatch.rule.eventType,
      actor,
      move: templateMatch.move,
      target: templateMatch.target,
      confidence: combineConfidence(ocrConfidence, [templateMatch.confidenceScore]),
      classification: createClassification(
        "template_dictionary",
        templateMatch.rule.id,
        [templateMatch.evidence],
      ),
    },
    candidateMatches: [templateMatch.evidence],
  } satisfies EventParseResult;
}

function parseConstrainedTemplateEvent(
  rawText: string,
  normalizedText: string,
  matchText: string,
  ocrConfidence: number | null | undefined,
  dictionary: BattleMessageDictionary,
  surfaces: readonly MatchSurface[],
  templateRules: readonly BattleTemplateRule[],
) {
  const constrainedRules = selectConstrainedTemplateRules(
    matchText,
    surfaces,
    templateRules,
    dictionary,
  );

  if (constrainedRules.length === 0) {
    return { candidateMatches: [] };
  }

  const constrainedSurfaces = selectConstrainedTemplateSurfaces(surfaces, constrainedRules);

  if (constrainedSurfaces.length === 0) {
    return { candidateMatches: [] };
  }

  const constrainedMatch = decodeConstrainedTemplate({
    surfaces: constrainedSurfaces,
    dictionary,
    rules: constrainedRules,
    ocrConfidence,
  });

  if (!constrainedMatch) {
    return { candidateMatches: [] };
  }

  if (!constrainedMatch.accepted) {
    return {
      candidateMatches: [`constrained-review:${constrainedMatch.evidence}`],
    };
  }

  const actor =
    constrainedMatch.actor.name && !constrainedMatch.actor.side
      ? {
          ...constrainedMatch.actor,
          side:
            inferResolvedActorSide(constrainedMatch.actor.name, surfaces) ??
            constrainedMatch.actor.side,
        }
      : constrainedMatch.actor;

  return {
    result: {
      status: "event",
      rawText,
      normalizedText,
      matchText,
      event: {
        type: constrainedMatch.eventType,
        actor,
        move: constrainedMatch.move,
        target: constrainedMatch.target,
        confidence: combineConfidence(ocrConfidence, [constrainedMatch.confidenceScore]),
        classification: createClassification(
          "template_dictionary",
          constrainedMatch.rule.id,
          [constrainedMatch.evidence],
        ),
      },
      candidateMatches: [constrainedMatch.evidence],
    } satisfies EventParseResult,
    candidateMatches: [constrainedMatch.evidence],
  };
}

function isConstrainedMoveSurface(surfaceText: string) {
  const possessiveIndex = surfaceText.indexOf("の");

  if (possessiveIndex < 0) {
    return false;
  }

  if (surfaceText.startsWith(OPPONENT_PREFIX)) {
    return true;
  }

  const actorText = surfaceText.slice(0, possessiveIndex);
  const moveText = surfaceText.slice(possessiveIndex + 1);

  return (
    actorText.length >= 2 &&
    actorText.length <= 8 &&
    moveText.length >= 2 &&
    moveText.length <= 14
  );
}

function selectConstrainedTemplateSurfaces(
  surfaces: readonly MatchSurface[],
  templateRules: readonly BattleTemplateRule[],
) {
  const eventTypes = new Set(templateRules.map((rule) => rule.eventType));

  return surfaces.filter((surface) => {
    if (eventTypes.has("move") && isConstrainedMoveSurface(surface.matchText)) {
      return true;
    }

    if (
      eventTypes.has("switch_in") &&
      (surface.matchText.includes("ゆけ") ||
        surface.matchText.includes("いけ") ||
        surface.matchText.includes("繰り出"))
    ) {
      return true;
    }

    if (
      eventTypes.has("switch_out") &&
      (surface.matchText.includes("戻れ") ||
        surface.matchText.includes("引っこめ") ||
        surface.matchText.includes("ひっこめ"))
    ) {
      return true;
    }

    return false;
  });
}

function inferResolvedActorSide(
  actorName: string,
  surfaces: readonly MatchSurface[],
): BattleEvent["actor"]["side"] {
  const actorMatchText = createOcrMatchText(actorName);

  if (!actorMatchText) {
    return null;
  }

  for (const surface of surfaces) {
    let actorIndex = surface.matchText.indexOf(actorMatchText);

    while (actorIndex >= 0) {
      const prefixStart = Math.max(0, actorIndex - OPPONENT_PREFIX.length);
      const immediatePrefix = surface.matchText.slice(prefixStart, actorIndex);

      if (immediatePrefix === OPPONENT_PREFIX) {
        return "opponent";
      }

      actorIndex = surface.matchText.indexOf(actorMatchText, actorIndex + 1);
    }
  }

  return null;
}

function selectConstrainedTemplateRules(
  matchText: string,
  surfaces: readonly MatchSurface[],
  templateRules: readonly BattleTemplateRule[],
  dictionary: BattleMessageDictionary,
) {
  const surfaceTexts = [
    matchText,
    ...surfaces.map((surface) => surface.matchText),
  ].filter((value, index, values) => value && values.indexOf(value) === index);
  const hasMoveShape = surfaceTexts.some(
    (surfaceText) =>
      surfaceText.includes("の") &&
      (surfaceText.includes(OPPONENT_PREFIX) ||
        findDictionarySpans(surfaceText, dictionary.moves).length > 0 ||
        surfaceText.length <= 24),
  );
  const hasSwitchInShape = surfaceTexts.some(
    (surfaceText) =>
      surfaceText.includes("ゆけ") ||
      surfaceText.includes("いけ") ||
      surfaceText.includes("繰り出"),
  );
  const hasSwitchOutShape = surfaceTexts.some(
    (surfaceText) =>
      surfaceText.includes("戻れ") ||
      surfaceText.includes("引っこめ") ||
      surfaceText.includes("ひっこめ"),
  );

  return templateRules.filter((rule) => {
    if (!rule.id.startsWith("champout_")) {
      return false;
    }

    if (rule.eventType === "move") {
      return hasMoveShape;
    }

    if (rule.eventType === "switch_in") {
      return hasSwitchInShape;
    }

    if (rule.eventType === "switch_out") {
      return hasSwitchOutShape;
    }

    return false;
  });
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
  options: BattleMessageParserOptions = {},
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

  const activeTemplateRules = options.templateRules ?? STANDARD_TEMPLATE_RULES;
  const constrainedTemplateEvent = parseConstrainedTemplateEvent(
    rawText,
    normalizedText,
    matchText,
    ocrConfidence,
    dictionary,
    surfaces,
    activeTemplateRules,
  );

  if (constrainedTemplateEvent.result) {
    return constrainedTemplateEvent.result;
  }

  const templateEvent = parseTemplateEvent(
    rawText,
    normalizedText,
    matchText,
    ocrConfidence,
    dictionary,
    surfaces,
    activeTemplateRules,
  );

  if (templateEvent) {
    return templateEvent;
  }

  const hpLossEvent = parseHpLossLifeCostEvent(
    rawText,
    normalizedText,
    matchText,
    ocrConfidence,
    dictionary,
    surfaces,
  );

  if (hpLossEvent.result) {
    return hpLossEvent.result;
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

  return createUnknownResult(
    rawText,
    normalizedText,
    matchText,
    [
      ...constrainedTemplateEvent.candidateMatches,
      ...hpLossEvent.candidateMatches,
      ...(moveEvent?.candidateMatches ?? []),
    ],
  );
}
