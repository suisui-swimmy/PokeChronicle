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
import {
  decodeConstrainedTemplate,
  type ConstrainedTemplateMatch,
} from "../templates/constrainedTemplateDecoder";
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
  sessionRosterDictionary?: readonly DictionaryEntry[];
  observedMoveDictionary?: readonly DictionaryEntry[];
}

export interface BattleMessageParserOptions {
  templateRules?: readonly BattleTemplateRule[];
  sessionRosterDictionary?: readonly DictionaryEntry[];
  observedMoveDictionary?: readonly DictionaryEntry[];
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
  events?: readonly ParsedBattleEvent[];
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

export function getParsedBattleEvents(result: BattleMessageParseResult) {
  return result.status === "event" ? [...(result.events ?? [result.event])] : [];
}

const DEFAULT_ACTOR = { name: null, side: null } satisfies BattleEvent["actor"];
const OPPONENT_PREFIX = "相手の";
const MAX_INLINE_GAP_NOISE = 4;
const MAX_CANDIDATE_MATCHES = 16;
const RELAXED_STRONG_ACTOR_MOVE_OPTIONS = {
  acceptScore: 0.72,
  reviewScore: 0.68,
  acceptMargin: 0.12,
  minOcrConfidenceForFuzzy: 0.68,
  similarity: "ocr_weighted",
} as const;
const RELAXED_STRONG_MOVE_ACTOR_OPTIONS = {
  acceptScore: 0.62,
  reviewScore: 0.58,
  acceptMargin: 0.1,
  minOcrConfidenceForFuzzy: 0.72,
  similarity: "ocr_weighted",
} as const;
const RELAXED_HP_LOSS_ACTOR_OPTIONS = {
  acceptScore: 0.8,
  reviewScore: 0.72,
  acceptMargin: 0.08,
  minOcrConfidenceForFuzzy: 0.65,
  similarity: "ocr_weighted",
} as const;
const SESSION_POKEMON_MATCH_OPTIONS = {
  acceptScore: 0.62,
  reviewScore: 0.54,
  acceptMargin: 0.02,
  minOcrConfidenceForFuzzy: 0.35,
  similarity: "ocr_weighted",
} as const;
const SESSION_MOVE_MATCH_OPTIONS = {
  acceptScore: 0.6,
  reviewScore: 0.52,
  acceptMargin: 0.02,
  minOcrConfidenceForFuzzy: 0.35,
  similarity: "ocr_weighted",
} as const;
const OCR_WEIGHTED_GLOBAL_POKEMON_OPTIONS = {
  acceptScore: 0.78,
  reviewScore: 0.7,
  acceptMargin: 0.06,
  minOcrConfidenceForFuzzy: 0.55,
  similarity: "ocr_weighted",
} as const;
const RELAXED_SWITCH_IN_POKEMON_OPTIONS = {
  acceptScore: 0.68,
  reviewScore: 0.62,
  acceptMargin: 0.03,
  minOcrConfidenceForFuzzy: 0.5,
  similarity: "ocr_weighted",
} as const;
const OCR_WEIGHTED_GLOBAL_MOVE_OPTIONS = {
  acceptScore: 0.78,
  reviewScore: 0.7,
  acceptMargin: 0.06,
  minOcrConfidenceForFuzzy: 0.55,
  similarity: "ocr_weighted",
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

function createRuntimeDictionary(
  dictionary: BattleMessageDictionary,
  options: BattleMessageParserOptions,
): BattleMessageDictionary {
  return {
    ...dictionary,
    sessionRosterDictionary:
      options.sessionRosterDictionary ?? dictionary.sessionRosterDictionary ?? [],
    observedMoveDictionary:
      options.observedMoveDictionary ?? dictionary.observedMoveDictionary ?? [],
  };
}

function matchPrioritizedDictionaryEntry(
  input: string,
  kind: "pokemon" | "move",
  priorityEntries: readonly DictionaryEntry[],
  fallbackEntries: readonly DictionaryEntry[],
  ocrConfidence: number | null | undefined,
  priorityOptions: Parameters<typeof matchDictionaryEntry>[2],
  fallbackOptions: Parameters<typeof matchDictionaryEntry>[2],
) {
  const candidateMatches: string[] = [];

  if (priorityEntries.length > 0) {
    const priorityMatch = matchDictionaryEntry(input, priorityEntries, {
      ...priorityOptions,
      ocrConfidence,
    });

    pushUniqueCandidate(candidateMatches, `session:${formatDictionaryCandidate(kind, priorityMatch)}`);

    if (priorityMatch.status === "accepted") {
      return { match: priorityMatch, candidateMatches };
    }
  }

  const fallbackMatch = matchDictionaryEntry(input, fallbackEntries, {
    ...fallbackOptions,
    ocrConfidence,
  });
  pushUniqueCandidate(candidateMatches, `global:${formatDictionaryCandidate(kind, fallbackMatch)}`);

  return { match: fallbackMatch, candidateMatches };
}

function matchPokemonEntry(
  input: string,
  dictionary: BattleMessageDictionary,
  ocrConfidence: number | null | undefined,
  fallbackOptions: Parameters<typeof matchDictionaryEntry>[2] = OCR_WEIGHTED_GLOBAL_POKEMON_OPTIONS,
) {
  return matchPrioritizedDictionaryEntry(
    input,
    "pokemon",
    dictionary.sessionRosterDictionary ?? [],
    dictionary.pokemon,
    ocrConfidence,
    SESSION_POKEMON_MATCH_OPTIONS,
    fallbackOptions,
  );
}

function matchMoveEntry(
  input: string,
  dictionary: BattleMessageDictionary,
  ocrConfidence: number | null | undefined,
  fallbackOptions: Parameters<typeof matchDictionaryEntry>[2] = OCR_WEIGHTED_GLOBAL_MOVE_OPTIONS,
) {
  return matchPrioritizedDictionaryEntry(
    input,
    "move",
    dictionary.observedMoveDictionary ?? [],
    dictionary.moves,
    ocrConfidence,
    SESSION_MOVE_MATCH_OPTIONS,
    fallbackOptions,
  );
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

function countCharacters(value: string) {
  return Array.from(value).length;
}

function looksLikeShortSuffixNoise(value: string) {
  const matchText = createOcrMatchText(value);

  if (!matchText) {
    return true;
  }

  return countCharacters(matchText) <= 10;
}

function createTerminatorTrimmedTexts(text: string) {
  const normalizedText = normalizeOcrText(text);
  const variants: string[] = [];

  for (let index = 0; index < normalizedText.length; index += 1) {
    if (normalizedText[index] !== "!") {
      continue;
    }

    const prefix = normalizedText.slice(0, index + 1).trim();
    const suffix = normalizedText.slice(index + 1).trim();

    if (!prefix || !suffix || !looksLikeShortSuffixNoise(suffix)) {
      continue;
    }

    variants.push(prefix);
  }

  return variants;
}

function createSuffixTrimmedTexts(text: string) {
  const normalizedText = normalizeOcrText(text);
  const variants: string[] = [];
  const trailingChunkMatch = normalizedText.match(/^(.+?)[\s　]+([A-Za-z0-9ぁ-んァ-ヶー一-龯]{1,10})$/u);

  if (!trailingChunkMatch) {
    return variants;
  }

  const [, prefix, suffix] = trailingChunkMatch;

  if (prefix && suffix && looksLikeShortSuffixNoise(suffix)) {
    variants.push(prefix.trim());
  }

  return variants;
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
    for (const [variantIndex, variantText] of createTerminatorTrimmedTexts(surface.text).entries()) {
      addSurface(
        createSurface(
          `${surface.id}:terminator:${variantIndex + 1}`,
          variantText,
          surface.priority + 30 + variantIndex,
        ),
      );
    }

    for (const [variantIndex, variantText] of createSuffixTrimmedTexts(surface.text).entries()) {
      addSurface(
        createSurface(
          `${surface.id}:suffix-trimmed:${variantIndex + 1}`,
          variantText,
          surface.priority + 34 + variantIndex,
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

function createContextEventWithParticipant(input: {
  type: BattleEventType;
  normalizedText: string;
  matchText: string;
  rawText: string;
  ocrConfidence: number | null | undefined;
  templateId: string;
  actor?: BattleEvent["actor"];
  target?: BattleEvent["target"];
  participantMatch: DictionaryMatch;
}): EventParseResult {
  const participantCandidate = formatDictionaryCandidate("pokemon", input.participantMatch);

  return {
    status: "event",
    rawText: input.rawText,
    normalizedText: input.normalizedText,
    matchText: input.matchText,
    event: {
      type: input.type,
      actor: input.actor ?? DEFAULT_ACTOR,
      move: null,
      target: input.target ?? null,
      confidence: combineConfidence(input.ocrConfidence, [input.participantMatch.score ?? 1]),
      classification: createClassification(
        input.participantMatch.method === "fuzzy" ? "fuzzy_dictionary" : "seed_rule",
        input.templateId,
        [participantCandidate],
      ),
    },
    candidateMatches: [input.templateId, participantCandidate],
  };
}

function cleanupParticipantCandidate(rawText: string) {
  let side: BattleEvent["actor"]["side"] = null;
  let candidate = rawText;
  const opponentIndex = candidate.lastIndexOf(OPPONENT_PREFIX);

  if (opponentIndex >= 0) {
    side = "opponent";
    candidate = candidate.slice(opponentIndex + OPPONENT_PREFIX.length);
  }

  for (const separator of ["と", "、", ","]) {
    const separatorIndex = candidate.lastIndexOf(separator);

    if (separatorIndex >= 0) {
      candidate = candidate.slice(separatorIndex + separator.length);
    }
  }

  candidate = candidate
    .replace(/^[^ぁ-んァ-ヶー一-龯A-Za-z0-9]+/u, "")
    .replace(/[^ぁ-んァ-ヶー一-龯A-Za-z0-9]+$/u, "");

  if (countCharacters(candidate) < 2 || countCharacters(candidate) > 14) {
    return null;
  }

  return { candidate, side };
}

function extractParticipantBeforeMarker(
  surfaceText: string,
  patternText: string,
  marker: "に" | "は" | "の",
) {
  const patternIndex = surfaceText.indexOf(patternText);

  if (patternIndex <= 0) {
    return null;
  }

  const prefix = surfaceText.slice(0, patternIndex);
  const markerIndex = prefix.lastIndexOf(marker);

  if (markerIndex <= 0) {
    return null;
  }

  return cleanupParticipantCandidate(prefix.slice(0, markerIndex));
}

function extractContextParticipant(
  type: BattleEventType,
  patterns: readonly string[],
  surfaceMatchTexts: readonly string[],
  dictionary: BattleMessageDictionary,
  ocrConfidence: number | null | undefined,
) {
  const marker =
    type === "supereffective" || type === "resisted" || type === "immune"
      ? "に"
      : type === "boost" || type === "unboost"
        ? "の"
        : "は";

  for (const pattern of patterns) {
    const patternText = createOcrMatchText(pattern);

    if (!patternText) {
      continue;
    }

    for (const surfaceText of surfaceMatchTexts) {
      const participant = extractParticipantBeforeMarker(surfaceText, patternText, marker);

      if (!participant) {
        continue;
      }

      const { match, candidateMatches } = matchPokemonEntry(
        participant.candidate,
        dictionary,
        ocrConfidence,
      );

      if (match.status === "accepted") {
        return {
          match,
          candidateMatches,
          side: participant.side,
        };
      }
    }
  }

  return null;
}

function parseContextEvent(
  rawText: string,
  normalizedText: string,
  matchText: string,
  ocrConfidence: number | null | undefined,
  surfaces: readonly MatchSurface[],
  dictionary: BattleMessageDictionary,
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
    [
      "unboost",
      "stat_unboost",
      [
        "下がった",
        "下かった",
        "下がっだ",
        "がくっと下がった",
        "攻撃ががくっと下がった",
        "防御ががくっと下がった",
        "特攻ががくっと下がった",
        "特防ががくっと下がった",
        "素早さががくっと下がった",
      ],
    ],
    ["miss", "move_miss", ["外れた", "あたらなかった"]],
    ["fail", "move_fail", ["失敗", "うまく決まらない"]],
    ["protect", "protect_block", ["身を守った", "守られた"]],
    [
      "protect",
      "protect_stance",
      ["守りの体勢に入った", "宝りの体勢に入った"],
    ],
    ["faint", "faint", ["倒れた", "たおれた", "たおれだ", "だたおれだ", "ひんし"]],
    ["switch_out", "switch_out", ["引っこめた", "ひっこめた"]],
    ["side_end", "tailwind_end", ["追い風が止んだ", "追い風か止んだ"]],
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
      const participant = extractContextParticipant(
        type,
        patterns,
        surfaceMatchTexts,
        dictionary,
        ocrConfidence,
      );

      if (participant) {
        const participantField =
          type === "supereffective" || type === "resisted" || type === "immune"
            ? {
                target: {
                  name: participant.match.best,
                  side: participant.side,
                },
              }
            : {
                actor: {
                  name: participant.match.best,
                  side: participant.side,
                },
              };

        return createContextEventWithParticipant({
          type,
          normalizedText,
          matchText,
          rawText,
          ocrConfidence,
          templateId,
          participantMatch: participant.match,
          ...participantField,
        });
      }

      return createSimpleEvent(type, normalizedText, matchText, rawText, ocrConfidence, templateId);
    }
  }

  return null;
}

function parseSwitchInCallFallback(
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

  if (
    !surfaceMatchTexts.some(
      (surfaceText) => surfaceText.startsWith("ゆけっ") || surfaceText.startsWith("いけっ"),
    )
  ) {
    return null;
  }

  return createSimpleEvent(
    "switch_in",
    normalizedText,
    matchText,
    rawText,
    ocrConfidence,
    "switch_in_call",
  );
}

interface SwitchInPokemonResolution {
  segmentText: string;
  match: DictionaryMatch;
  candidateMatches: string[];
}

interface DoubleSwitchInCandidate {
  templateId: string;
  side: BattleEvent["actor"]["side"];
  segments: string[];
  evidence: string;
}

function createExactPokemonSpanMatch(segmentText: string, span: DictionarySpan): DictionaryMatch {
  return {
    input: segmentText,
    normalizedInput: createOcrMatchText(segmentText),
    best: span.entry.label,
    bestEntry: span.entry,
    score: 1,
    secondBest: null,
    secondScore: null,
    status: "accepted",
    method: "exact",
    reason: "exact-span",
  };
}

function createPokemonSpanDictionary(dictionary: BattleMessageDictionary) {
  const entries: DictionaryEntry[] = [];
  const seen = new Set<string>();

  for (const entry of [
    ...(dictionary.sessionRosterDictionary ?? []),
    ...dictionary.pokemon,
  ]) {
    if (seen.has(entry.id)) {
      continue;
    }

    seen.add(entry.id);
    entries.push(entry);
  }

  return entries;
}

function cleanupSwitchInSegment(value: string) {
  const stripped = createOcrMatchText(value)
    .replace(/^(?:ゆけ|いけ)[っつ]?/u, "")
    .replace(/^(?:がんばれ|出てこい)/u, "");

  if (countCharacters(stripped) < 2 || countCharacters(stripped) > 22) {
    return null;
  }

  return stripped;
}

function createSwitchInSegmentVariants(segmentText: string) {
  const variants = [
    segmentText,
    segmentText
      .replace(/フ[オォ]+/gu, "フォ")
      .replace(/[オォ]{2,}/gu, "オ")
      .replace(/グ(?=クシ)/gu, ""),
  ];

  return variants.filter((variant, index, values) => variant && values.indexOf(variant) === index);
}

function resolveSwitchInPokemon(
  segmentText: string,
  dictionary: BattleMessageDictionary,
  ocrConfidence: number | null | undefined,
): SwitchInPokemonResolution | null {
  const cleanedSegment = cleanupSwitchInSegment(segmentText);

  if (!cleanedSegment) {
    return null;
  }

  const segmentVariants = createSwitchInSegmentVariants(cleanedSegment);
  const spanDictionary = createPokemonSpanDictionary(dictionary);

  for (const variant of segmentVariants) {
    const spans = findDictionarySpans(variant, spanDictionary);
    const exactSpan = spans[spans.length - 1];

    if (!exactSpan) {
      continue;
    }

    const match = createExactPokemonSpanMatch(variant, exactSpan);

    return {
      segmentText: variant,
      match,
      candidateMatches: [
        ...(variant !== cleanedSegment ? [`switch-in-normalized:${cleanedSegment}->${variant}`] : []),
        `switch-in-span:pokemon=${exactSpan.entry.label}:range=${exactSpan.start}-${exactSpan.end}`,
        formatDictionaryCandidate("pokemon", match),
      ],
    };
  }

  const fuzzyCandidateMatches: string[] = [];

  for (const variant of segmentVariants) {
    const { match, candidateMatches } = matchPokemonEntry(
      variant,
      dictionary,
      ocrConfidence,
      RELAXED_SWITCH_IN_POKEMON_OPTIONS,
    );

    candidateMatches.forEach((candidate) =>
      pushUniqueCandidate(
        fuzzyCandidateMatches,
        variant === cleanedSegment ? candidate : `switch-in-normalized:${cleanedSegment}->${variant}:${candidate}`,
      ),
    );

    if (match.status !== "accepted") {
      continue;
    }

    return {
      segmentText: variant,
      match,
      candidateMatches: fuzzyCandidateMatches,
    };
  }

  return null;
}

function collectOwnDoubleSwitchInCandidates(
  rawText: string,
  lines: readonly string[] | undefined,
): DoubleSwitchInCandidate | null {
  const sourceLines = getSourceLines(rawText, lines);
  const normalizedParts = sourceLines.flatMap((line) => line.split("!"));
  const hasCallShape = sourceLines.some((line) => {
    const lineMatchText = createOcrMatchText(line);

    return /^(?:ゆけ|いけ)[っつ]?/u.test(lineMatchText);
  });

  if (!hasCallShape) {
    return null;
  }

  const segments = normalizedParts
    .map((part) => cleanupSwitchInSegment(part))
    .filter((part): part is string => Boolean(part));

  const uniqueSegments = segments.filter(
    (segment, index, values) => values.indexOf(segment) === index,
  );

  if (uniqueSegments.length !== 2) {
    return null;
  }

  return {
    templateId: "switch_in_double_call",
    side: null,
    segments: uniqueSegments,
    evidence: "double-switch-in:call",
  };
}

function collectTrainerDoubleSwitchInCandidates(
  matchText: string,
  surfaces: readonly MatchSurface[],
): DoubleSwitchInCandidate | null {
  const surfaceMatchTexts = [
    matchText,
    ...surfaces.map((surface) => surface.matchText),
  ].filter((value, index, values) => value && values.indexOf(value) === index);

  for (const surfaceText of surfaceMatchTexts) {
    if (!surfaceText.includes("繰り出") || !surfaceText.includes("と")) {
      continue;
    }

    const sendIndex = surfaceText.indexOf("を繰り出");

    if (sendIndex <= 0) {
      continue;
    }

    const prefix = surfaceText.slice(0, sendIndex);
    const subjectIndex = prefix.lastIndexOf("は");

    if (subjectIndex < 0) {
      continue;
    }

    const body = prefix.slice(subjectIndex + 1);
    const segments = body
      .split("と")
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (segments.length !== 2) {
      continue;
    }

    return {
      templateId: "switch_in_double_trainer",
      side: surfaceText.startsWith(OPPONENT_PREFIX) ? "opponent" : null,
      segments,
      evidence: "double-switch-in:trainer-send",
    };
  }

  return null;
}

function createDoubleSwitchInResult(
  rawText: string,
  normalizedText: string,
  matchText: string,
  ocrConfidence: number | null | undefined,
  candidate: DoubleSwitchInCandidate,
  resolutions: readonly SwitchInPokemonResolution[],
): EventParseResult {
  const method: ClassificationMethod = resolutions.some(
    (resolution) => resolution.match.method === "fuzzy",
  )
    ? "fuzzy_dictionary"
    : "template_dictionary";
  const sharedCandidateMatches = [
    candidate.evidence,
    ...resolutions.flatMap((resolution) => resolution.candidateMatches),
  ];
  const events = resolutions.map((resolution, index): ParsedBattleEvent => ({
    type: "switch_in",
    actor: {
      name: resolution.match.best,
      side: candidate.side,
    },
    move: null,
    target: null,
    confidence: combineConfidence(ocrConfidence, [resolution.match.score ?? 1]),
    classification: createClassification(
      method,
      candidate.templateId,
      [
        candidate.evidence,
        `slot=${index + 1}:pokemon=${resolution.match.best}:segment=${resolution.segmentText}`,
        ...resolution.candidateMatches,
      ],
    ),
  }));

  return {
    status: "event",
    rawText,
    normalizedText,
    matchText,
    event: events[0],
    events,
    candidateMatches: sharedCandidateMatches,
  };
}

function parseDoubleSwitchInEvent(
  rawText: string,
  normalizedText: string,
  matchText: string,
  ocrConfidence: number | null | undefined,
  lines: readonly string[] | undefined,
  surfaces: readonly MatchSurface[],
  dictionary: BattleMessageDictionary,
) {
  const candidate =
    collectOwnDoubleSwitchInCandidates(rawText, lines) ??
    collectTrainerDoubleSwitchInCandidates(matchText, surfaces);

  if (!candidate) {
    return null;
  }

  const resolutions = candidate.segments.map((segment) =>
    resolveSwitchInPokemon(segment, dictionary, ocrConfidence),
  );

  if (resolutions.some((resolution) => !resolution)) {
    return null;
  }

  const acceptedResolutions = resolutions.filter(
    (resolution): resolution is SwitchInPokemonResolution => resolution !== null,
  );
  const pokemonNames = acceptedResolutions.map((resolution) => resolution.match.best);

  if (
    acceptedResolutions.length !== 2 ||
    pokemonNames.some((name) => !name) ||
    new Set(pokemonNames).size !== 2
  ) {
    return null;
  }

  return createDoubleSwitchInResult(
    rawText,
    normalizedText,
    matchText,
    ocrConfidence,
    candidate,
    acceptedResolutions,
  );
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

    const { match: actorMatch, candidateMatches: actorCandidates } = matchPokemonEntry(
      actorText,
      dictionary,
      ocrConfidence,
      RELAXED_HP_LOSS_ACTOR_OPTIONS,
    );

    actorCandidates.forEach((candidate) => pushUniqueCandidate(candidateMatches, candidate));

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
    const strictPokemonResult = matchPokemonEntry(part.actorText, dictionary, ocrConfidence);
    let pokemonMatch = strictPokemonResult.match;
    const strictMoveResult = matchMoveEntry(part.moveText, dictionary, ocrConfidence);
    const strictMoveMatch = strictMoveResult.match;
    let moveMatch = strictMoveMatch;
    const partCandidates = [
      ...strictPokemonResult.candidateMatches,
      ...strictMoveResult.candidateMatches,
    ];

    if (
      pokemonMatch.status === "accepted" &&
      (pokemonMatch.method === "exact" || (pokemonMatch.score ?? 0) >= 0.9) &&
      strictMoveMatch.status !== "accepted"
    ) {
      const relaxedMoveResult = matchMoveEntry(
        part.moveText,
        dictionary,
        ocrConfidence,
        RELAXED_STRONG_ACTOR_MOVE_OPTIONS,
      );
      const relaxedMoveMatch = relaxedMoveResult.match;
      relaxedMoveResult.candidateMatches.forEach((candidate) =>
        pushUniqueCandidate(partCandidates, `strong-actor:${candidate}`),
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
      const relaxedPokemonResult = matchPokemonEntry(
        part.actorText,
        dictionary,
        ocrConfidence,
        RELAXED_STRONG_MOVE_ACTOR_OPTIONS,
      );
      const relaxedPokemonMatch = relaxedPokemonResult.match;
      relaxedPokemonResult.candidateMatches.forEach((candidate) =>
        pushUniqueCandidate(partCandidates, `strong-move:${candidate}`),
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
  const target =
    templateMatch.target?.name && !templateMatch.target.side
      ? {
          ...templateMatch.target,
          side:
            inferResolvedActorSide(templateMatch.target.name, surfaces) ??
            templateMatch.target.side,
        }
      : templateMatch.target;

  return {
    status: "event",
    rawText,
    normalizedText,
    matchText,
    event: {
      type: templateMatch.rule.eventType,
      actor,
      move: templateMatch.move,
      target,
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

function encodeCandidateValue(value: string | null | undefined) {
  return encodeURIComponent(value ?? "");
}

function formatConstrainedCandidateMatch(match: ConstrainedTemplateMatch) {
  return [
    "constrained-candidate",
    `identity=${encodeCandidateValue(match.identity)}`,
    `eventType=${encodeCandidateValue(match.eventType)}`,
    `actorName=${encodeCandidateValue(match.actor.name)}`,
    `actorSide=${encodeCandidateValue(match.actor.side)}`,
    `move=${encodeCandidateValue(match.move)}`,
    `targetName=${encodeCandidateValue(match.target?.name)}`,
    `targetSide=${encodeCandidateValue(match.target?.side)}`,
    `templateId=${encodeCandidateValue(match.rule.id)}`,
    `score=${match.confidenceScore.toFixed(3)}`,
  ].join(";");
}

function formatPartialTemplateCandidate(input: {
  eventType: BattleEventType;
  actorName: string | null;
  actorSide: BattleEvent["actor"]["side"];
  templateId: string;
  surfaceId: string;
}) {
  return [
    "partial-template",
    `eventType=${encodeCandidateValue(input.eventType)}`,
    `actorName=${encodeCandidateValue(input.actorName)}`,
    `actorSide=${encodeCandidateValue(input.actorSide)}`,
    `templateId=${encodeCandidateValue(input.templateId)}`,
    `surface=${encodeCandidateValue(input.surfaceId)}`,
  ].join(";");
}

function detectPartialTemplateCandidates(
  surfaces: readonly MatchSurface[],
  dictionary: BattleMessageDictionary,
  ocrConfidence: number | null | undefined,
) {
  const candidateMatches: string[] = [];

  for (const surface of surfaces) {
    if (!surface.matchText.endsWith("の")) {
      continue;
    }

    const side = surface.matchText.startsWith(OPPONENT_PREFIX) ? "opponent" : null;
    const actorText = (side === "opponent"
      ? surface.matchText.slice(OPPONENT_PREFIX.length)
      : surface.matchText
    ).slice(0, -1);

    if (countCharacters(actorText) < 2 || countCharacters(actorText) > 12) {
      continue;
    }

    const { match, candidateMatches: pokemonCandidates } = matchPokemonEntry(
      actorText,
      dictionary,
      ocrConfidence,
    );
    pokemonCandidates.forEach((candidate) =>
      pushUniqueCandidate(candidateMatches, `partial-template:${candidate}`),
    );

    if (match.status !== "accepted") {
      continue;
    }

    pushUniqueCandidate(
      candidateMatches,
      formatPartialTemplateCandidate({
        eventType: "move",
        actorName: match.best,
        actorSide: side,
        templateId: side === "opponent" ? "champout_move_1pbrfiv" : "champout_move_1oj9w2v",
        surfaceId: surface.id,
      }),
    );
  }

  return candidateMatches;
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
      candidateMatches: [
        `constrained-review:${constrainedMatch.evidence}`,
        formatConstrainedCandidateMatch(constrainedMatch),
      ],
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
  const target =
    constrainedMatch.target?.name && !constrainedMatch.target.side
      ? {
          ...constrainedMatch.target,
          side:
            inferResolvedActorSide(constrainedMatch.target.name, surfaces) ??
            constrainedMatch.target.side,
        }
      : constrainedMatch.target;

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
        target,
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

function includesAny(value: string, needles: readonly string[]) {
  return needles.some((needle) => value.includes(needle));
}

function isConstrainedFaintSurface(surfaceText: string) {
  return includesAny(surfaceText, [
    "倒れ",
    "たおれ",
    "たおあれ",
    "だおれ",
    "おれだ",
    "ひんし",
  ]);
}

function isConstrainedSupereffectiveSurface(surfaceText: string) {
  return (
    surfaceText.includes("効果") &&
    includesAny(surfaceText, ["バツ", "パツ", "バウツ", "バッグ", "パッグ", "バック", "グン"])
  );
}

function hasEffectTargetSurfaceShape(surfaceText: string) {
  const effectIndex = surfaceText.indexOf("効果");

  if (effectIndex <= 0) {
    return false;
  }

  const beforeEffect = surfaceText.slice(0, effectIndex);

  return beforeEffect.endsWith("に") && beforeEffect.length >= 3;
}

function isConstrainedFailSurface(surfaceText: string) {
  return (
    (surfaceText.includes("失敗") ||
      surfaceText.includes("しかし") ||
      surfaceText.includes("うまく") ||
      surfaceText.includes("うまぐ") ||
      surfaceText.includes("うま")) &&
    includesAny(surfaceText, ["決ま", "きま"]) &&
    includesAny(surfaceText, ["なかった", "なかつた"])
  );
}

function isConstrainedFlinchSurface(surfaceText: string) {
  return (
    includesAny(surfaceText, ["ひるん", "技がだせない", "技かだせない"]) &&
    includesAny(surfaceText, ["だせない", "出せない"])
  );
}

function isConstrainedItemPrioritySurface(surfaceText: string) {
  return (
    includesAny(surfaceText, ["行動がはやく", "行動かはやく", "行動が早く"]) &&
    includesAny(surfaceText, ["なった", "なつた"])
  );
}

function isConstrainedRedirectionSurface(surfaceText: string) {
  return (
    surfaceText.includes("注目の的") ||
    (surfaceText.includes("注目") && surfaceText.includes("なった")) ||
    (surfaceText.includes("的") && surfaceText.includes("なった"))
  );
}

function isConstrainedActivateSurface(surfaceText: string) {
  return (
    (surfaceText.includes("メガ") && includesAny(surfaceText, ["シンカ", "シン力", "シソカ"])) ||
    (surfaceText.includes("お茶") && surfaceText.includes("飲"))
  );
}

function isConstrainedDamageSurface(surfaceText: string) {
  return surfaceText.includes("砂あらし") && includesAny(surfaceText, ["襲", "おそう"]);
}

function isConstrainedStatusCureSurface(surfaceText: string) {
  return includesAny(surfaceText, [
    "治った",
    "なおった",
    "回復した",
    "なくなった",
    "溶けた",
    "覚ました",
    "とれた",
    "解けた",
  ]);
}

function isConstrainedStatusSurface(surfaceText: string) {
  return includesAny(surfaceText, [
    "状態",
    "まひ",
    "麻痺",
    "やけど",
    "毒",
    "どく",
    "眠",
    "ねむ",
    "こおり",
    "凍",
    "混乱",
    "メロメロ",
  ]);
}

function isConstrainedImmuneSurface(surfaceText: string) {
  return (
    surfaceText.includes("効果がない") ||
    surfaceText.includes("効果はない") ||
    (surfaceText.includes("効果") && surfaceText.includes("ない"))
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

    if (eventTypes.has("faint") && isConstrainedFaintSurface(surface.matchText)) {
      return true;
    }

    if (
      eventTypes.has("status_cure") &&
      isConstrainedStatusCureSurface(surface.matchText)
    ) {
      return true;
    }

    if (eventTypes.has("status") && isConstrainedStatusSurface(surface.matchText)) {
      return true;
    }

    if (eventTypes.has("immune") && isConstrainedImmuneSurface(surface.matchText)) {
      return true;
    }

    if (
      eventTypes.has("supereffective") &&
      isConstrainedSupereffectiveSurface(surface.matchText)
    ) {
      return true;
    }

    if (eventTypes.has("fail") && isConstrainedFailSurface(surface.matchText)) {
      return true;
    }

    if (eventTypes.has("flinch") && isConstrainedFlinchSurface(surface.matchText)) {
      return true;
    }

    if (eventTypes.has("item") && isConstrainedItemPrioritySurface(surface.matchText)) {
      return true;
    }

    if (
      eventTypes.has("redirection") &&
      isConstrainedRedirectionSurface(surface.matchText)
    ) {
      return true;
    }

    if (eventTypes.has("activate") && isConstrainedActivateSurface(surface.matchText)) {
      return true;
    }

    if (eventTypes.has("damage") && isConstrainedDamageSurface(surface.matchText)) {
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
  const hasFaintShape = surfaceTexts.some(isConstrainedFaintSurface);
  const hasStatusCureShape = surfaceTexts.some(isConstrainedStatusCureSurface);
  const hasStatusShape = surfaceTexts.some(isConstrainedStatusSurface);
  const hasImmuneShape = surfaceTexts.some(isConstrainedImmuneSurface);
  const hasSupereffectiveShape = surfaceTexts.some(isConstrainedSupereffectiveSurface);
  const hasSupereffectiveTargetShape = surfaceTexts.some(hasEffectTargetSurfaceShape);
  const hasFailShape = surfaceTexts.some(isConstrainedFailSurface);
  const hasFlinchShape = surfaceTexts.some(isConstrainedFlinchSurface);
  const hasItemPriorityShape = surfaceTexts.some(isConstrainedItemPrioritySurface);
  const hasRedirectionShape = surfaceTexts.some(isConstrainedRedirectionSurface);
  const hasActivateShape = surfaceTexts.some(isConstrainedActivateSurface);
  const hasDamageShape = surfaceTexts.some(isConstrainedDamageSurface);

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

    if (rule.eventType === "faint") {
      return hasFaintShape;
    }

    if (rule.eventType === "status_cure") {
      return hasStatusCureShape;
    }

    if (rule.eventType === "status") {
      return hasStatusShape;
    }

    if (rule.eventType === "immune") {
      return hasImmuneShape;
    }

    if (rule.eventType === "supereffective") {
      return (
        hasSupereffectiveShape &&
        (!hasSupereffectiveTargetShape ||
          rule.patterns.some((pattern) => pattern.includes("{target}")))
      );
    }

    if (rule.eventType === "fail") {
      return hasFailShape;
    }

    if (rule.eventType === "flinch") {
      return hasFlinchShape;
    }

    if (rule.eventType === "item") {
      return hasItemPriorityShape;
    }

    if (rule.eventType === "redirection") {
      return hasRedirectionShape;
    }

    if (rule.eventType === "activate") {
      return hasActivateShape;
    }

    if (rule.eventType === "damage") {
      return hasDamageShape;
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
  const runtimeDictionary = createRuntimeDictionary(dictionary, options);
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
    runtimeDictionary,
  );

  if (contextEvent) {
    return contextEvent;
  }

  const doubleSwitchInEvent = parseDoubleSwitchInEvent(
    rawText,
    normalizedText,
    matchText,
    ocrConfidence,
    lines,
    surfaces,
    runtimeDictionary,
  );

  if (doubleSwitchInEvent) {
    return doubleSwitchInEvent;
  }

  const activeTemplateRules = options.templateRules ?? STANDARD_TEMPLATE_RULES;
  const constrainedTemplateEvent = parseConstrainedTemplateEvent(
    rawText,
    normalizedText,
    matchText,
    ocrConfidence,
    runtimeDictionary,
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
    runtimeDictionary,
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
    runtimeDictionary,
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
    runtimeDictionary,
    surfaces,
  );

  if (moveEvent?.result) {
    return moveEvent.result;
  }

  const switchInCallFallback = parseSwitchInCallFallback(
    rawText,
    normalizedText,
    matchText,
    ocrConfidence,
    surfaces,
  );

  if (switchInCallFallback) {
    return switchInCallFallback;
  }

  const partialTemplateCandidates = detectPartialTemplateCandidates(
    surfaces,
    runtimeDictionary,
    ocrConfidence,
  );

  return createUnknownResult(
    rawText,
    normalizedText,
    matchText,
    [
      ...constrainedTemplateEvent.candidateMatches,
      ...hpLossEvent.candidateMatches,
      ...(moveEvent?.candidateMatches ?? []),
      ...partialTemplateCandidates,
    ],
  );
}
