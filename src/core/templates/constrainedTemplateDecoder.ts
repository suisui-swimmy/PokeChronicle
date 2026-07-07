import { matchDictionaryEntry, normalizedSimilarity } from "../dictionary/fuzzyMatch";
import { createOcrMatchText } from "../normalize/ocrText";
import type { BattleEvent } from "../events/schema";
import type { DictionaryEntry, DictionaryMatch } from "../dictionary/types";
import type { BattleTemplateRule, TemplateMatchSurface } from "./types";

interface ConstrainedTemplateDictionary {
  pokemon: readonly DictionaryEntry[];
  moves: readonly DictionaryEntry[];
  stats?: readonly DictionaryEntry[];
  sessionRosterDictionary?: readonly DictionaryEntry[];
  observedMoveDictionary?: readonly DictionaryEntry[];
}

type PlaceholderKind = "pokemon" | "move" | "target" | "stat" | "text";

type CompiledToken =
  | { type: "literal"; value: string }
  | { type: "placeholder"; kind: PlaceholderKind; raw: string };

interface LiteralResolution {
  value: string;
  matchedText: string;
  start: number;
  end: number;
  score: number;
}

export interface PlaceholderResolution {
  kind: PlaceholderKind;
  raw: string;
  inputText: string;
  matchedText: string;
  value: string | null;
  score: number;
  margin: number;
  method: DictionaryMatch["method"] | "free_text";
  start: number;
  end: number;
  evidence: string;
}

export interface ConstrainedTemplateMatch {
  rule: BattleTemplateRule;
  pattern: string;
  eventType: BattleTemplateRule["eventType"];
  actor: BattleEvent["actor"];
  target: BattleEvent["target"];
  move: string | null;
  confidenceScore: number;
  margin: number;
  accepted: boolean;
  evidence: string;
  identity: string;
  suffixNoise: string | null;
  placeholderResolutions: PlaceholderResolution[];
  literalScore: number;
  dictionaryScore: number;
  surface: TemplateMatchSurface;
}

export interface ConstrainedTemplateDecodeInput {
  surfaces: readonly TemplateMatchSurface[];
  dictionary: ConstrainedTemplateDictionary;
  rules: readonly BattleTemplateRule[];
  ocrConfidence?: number | null;
}

const DEFAULT_MAX_GAP = 4;
const DEFAULT_MAX_TEXT_CAPTURE_LENGTH = 24;
const MAX_LITERAL_LENGTH_DELTA = 2;
const MAX_SEGMENT_LENGTH = 24;
const MAX_BOUNDARY_LOOKAHEAD = 32;
const MIN_LITERAL_SCORE = 0.62;
const MIN_DICTIONARY_SCORE = 0.58;
const MIN_FINAL_SCORE = 0.72;
const MIN_FINAL_SCORE_FOR_DOUBLE_FUZZY = 0.78;
const MIN_MARGIN = 0.04;
const MIN_FUZZY_MARGIN = 0.06;
const MIN_DOUBLE_FUZZY_MARGIN = 0.08;
const MIN_OCR_CONFIDENCE_FOR_DOUBLE_FUZZY = 0.6;
const MIN_OCR_CONFIDENCE_FOR_FUZZY_ACCEPT = 0.65;
const OPPONENT_PREFIX = "相手の";
const MAX_SUFFIX_NOISE_LENGTH = 10;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function parsePlaceholder(rawPlaceholder: string): PlaceholderKind {
  const raw = rawPlaceholder.trim().toLowerCase();

  if (raw === "pokemon" || raw === "actor") {
    return "pokemon";
  }

  if (raw === "move") {
    return "move";
  }

  if (raw === "target") {
    return "target";
  }

  if (raw === "stat") {
    return "stat";
  }

  return "text";
}

export function compileConstrainedTemplatePattern(pattern: string) {
  const tokens: CompiledToken[] = [];
  const placeholderPattern = /\{([^}]+)\}/g;
  let cursor = 0;
  let match: RegExpExecArray | null = null;

  while ((match = placeholderPattern.exec(pattern)) !== null) {
    const literal = createOcrMatchText(pattern.slice(cursor, match.index));

    if (literal) {
      tokens.push({ type: "literal", value: literal });
    }

    tokens.push({
      type: "placeholder",
      kind: parsePlaceholder(match[1]),
      raw: match[1].trim(),
    });
    cursor = match.index + match[0].length;
  }

  const tailLiteral = createOcrMatchText(pattern.slice(cursor));

  if (tailLiteral) {
    tokens.push({ type: "literal", value: tailLiteral });
  }

  return tokens;
}

function getNextLiteral(tokens: readonly CompiledToken[], startIndex: number) {
  return tokens.slice(startIndex + 1).find((token) => token.type === "literal") as
    | Extract<CompiledToken, { type: "literal" }>
    | undefined;
}

function hasLiteralAnchor(text: string, tokens: readonly CompiledToken[]) {
  const literalTokens = tokens.filter(
    (token): token is Extract<CompiledToken, { type: "literal" }> => token.type === "literal",
  );

  if (literalTokens.length === 0) {
    return false;
  }

  const strongLiteralTokens = literalTokens.filter((token) => token.value.length >= 2);

  if (strongLiteralTokens.length > 0) {
    return strongLiteralTokens.some((token) => findBestLiteral(text, token.value, 0, 0) !== null);
  }

  const dictionaryPlaceholderCount = tokens.filter(
    (token) => token.type === "placeholder" && token.kind !== "text",
  ).length;

  return (
    dictionaryPlaceholderCount >= 2 &&
    literalTokens.some((token) => token.value.length > 0 && text.includes(token.value))
  );
}

function findBestLiteral(text: string, literal: string, cursor: number, tokenIndex: number) {
  const maxGap = tokenIndex === 0 ? MAX_BOUNDARY_LOOKAHEAD : DEFAULT_MAX_GAP;
  const minLength = Math.max(1, literal.length - MAX_LITERAL_LENGTH_DELTA);
  const maxLength = literal.length + MAX_LITERAL_LENGTH_DELTA;
  let best: LiteralResolution | null = null;

  for (let start = cursor; start <= Math.min(text.length - 1, cursor + maxGap); start += 1) {
    for (let length = minLength; length <= maxLength; length += 1) {
      const end = start + length;

      if (end > text.length) {
        continue;
      }

      const matchedText = text.slice(start, end);
      const score = normalizedSimilarity(matchedText, literal);

      if (!best || score > best.score || (score === best.score && start < best.start)) {
        best = {
          value: literal,
          matchedText,
          start,
          end,
          score,
        };
      }
    }
  }

  return best && best.score >= MIN_LITERAL_SCORE ? best : null;
}

function findNextLiteralBoundary(
  text: string,
  literal: string,
  cursor: number,
) {
  const boundary = findBestLiteral(text, literal, cursor, 0);

  if (!boundary || boundary.start - cursor > MAX_BOUNDARY_LOOKAHEAD) {
    return null;
  }

  return boundary;
}

function createCandidateSegments(text: string) {
  const cleanText = createOcrMatchText(text).slice(0, MAX_SEGMENT_LENGTH);
  const seen = new Set<string>();
  const segments: Array<{ text: string; start: number; end: number }> = [];

  function addSegment(start: number, end: number) {
    const segmentText = cleanText.slice(start, end);

    if (!segmentText || seen.has(`${start}:${end}:${segmentText}`)) {
      return;
    }

    seen.add(`${start}:${end}:${segmentText}`);
    segments.push({
      text: segmentText,
      start,
      end,
    });
  }

  addSegment(0, cleanText.length);

  for (let start = 1; start < cleanText.length; start += 1) {
    addSegment(start, cleanText.length);
  }

  for (let end = cleanText.length - 1; end > 0; end -= 1) {
    addSegment(0, end);
  }

  if (cleanText.length <= 12) {
    for (let start = 0; start < cleanText.length; start += 1) {
      for (let end = start + 1; end <= cleanText.length; end += 1) {
        addSegment(start, end);
      }
    }
  }

  return segments.sort(
    (left, right) =>
      Math.abs(right.text.length - cleanText.length) -
        Math.abs(left.text.length - cleanText.length) ||
      right.text.length - left.text.length,
  );
}

function formatDictionaryEvidence(kind: PlaceholderKind, match: DictionaryMatch, matchedText: string) {
  const score = match.score === null ? "--" : match.score.toFixed(2);
  const second = match.secondBest ? `:second=${match.secondBest}` : "";

  return `${kind}:${matchedText}->${match.best ?? "none"}:${match.status}:${score}:${match.reason}${second}`;
}

function resolveDictionaryPlaceholder(
  kind: "pokemon" | "move" | "target" | "stat",
  segmentText: string,
  dictionary: ConstrainedTemplateDictionary,
  start: number,
  ocrConfidence: number | null | undefined,
): PlaceholderResolution | null {
  const normalizedSegmentText = createOcrMatchText(segmentText);
  const normalizedSegmentLength = countCharacters(normalizedSegmentText);
  const entries =
    kind === "move"
      ? dictionary.moves
      : kind === "stat"
        ? dictionary.stats ?? []
        : dictionary.pokemon;
  const priorityEntries =
    kind === "move"
      ? dictionary.observedMoveDictionary ?? []
      : kind === "stat"
        ? []
        : dictionary.sessionRosterDictionary ?? [];
  let best:
    | (PlaceholderResolution & { rankingScore: number; secondScore: number | null })
    | null = null;

  for (const segment of createCandidateSegments(segmentText)) {
    const segmentLength = countCharacters(segment.text);

    if (normalizedSegmentLength > 3 && segmentLength < 3) {
      continue;
    }

    const priorityMatch =
      priorityEntries.length > 0
        ? matchDictionaryEntry(segment.text, priorityEntries, {
            acceptScore: 0.52,
            reviewScore: 0.48,
            acceptMargin: 0.02,
            minOcrConfidenceForFuzzy: 0.35,
            ocrConfidence,
            similarity: "ocr_weighted",
          })
        : null;
    const match =
      priorityMatch?.status === "accepted"
        ? priorityMatch
        : matchDictionaryEntry(segment.text, entries, {
            acceptScore: kind === "stat" ? 0.84 : MIN_DICTIONARY_SCORE,
            reviewScore: kind === "stat" ? 0.78 : 0.52,
            acceptMargin: kind === "stat" ? 0.08 : MIN_MARGIN,
            minOcrConfidenceForFuzzy:
              kind === "stat" ? 0.65 : 0.45,
            ocrConfidence,
            similarity: "ocr_weighted",
          });

    if (kind === "stat" && match.status !== "accepted") {
      continue;
    }

    if (!match.best || match.score === null || match.score < MIN_DICTIONARY_SCORE) {
      continue;
    }

    const margin = match.score - (match.secondScore ?? 0);
    const coverageScore = normalizedSegmentLength > 0 ? segmentLength / normalizedSegmentLength : 1;
    const rankingScore =
      match.method === "exact"
        ? 0.92 + Math.min(coverageScore, 1) * 0.08
        : match.score * Math.max(0.4, coverageScore);
    const resolved: PlaceholderResolution & {
      rankingScore: number;
      secondScore: number | null;
    } = {
      kind,
      raw: kind,
      inputText: createOcrMatchText(segmentText),
      matchedText: segment.text,
      value: match.best,
      score: match.score,
      margin,
      method: match.method,
      start: start + segment.start,
      end: start + segment.end,
      evidence: formatDictionaryEvidence(kind, match, segment.text),
      rankingScore,
      secondScore: match.secondScore,
    };

    if (
      !best ||
      resolved.rankingScore > best.rankingScore ||
      (resolved.rankingScore === best.rankingScore && resolved.score > best.score) ||
      (resolved.rankingScore === best.rankingScore &&
        resolved.score === best.score &&
        resolved.margin > best.margin) ||
      (resolved.rankingScore === best.rankingScore &&
        resolved.score === best.score &&
        resolved.margin === best.margin &&
        resolved.matchedText.length > best.matchedText.length)
    ) {
      best = resolved;
    }
  }

  return best;
}

function resolveTextPlaceholder(
  raw: string,
  segmentText: string,
  start: number,
  maxLength: number,
): PlaceholderResolution | null {
  const value = createOcrMatchText(segmentText).slice(0, maxLength);

  if (!value) {
    return null;
  }

  return {
    kind: "text",
    raw,
    inputText: createOcrMatchText(segmentText),
    matchedText: value,
    value,
    score: 0.82,
    margin: 1,
    method: "free_text",
    start,
    end: start + value.length,
    evidence: `text:${value}`,
  };
}

function getPlaceholderSegment(
  text: string,
  cursor: number,
  nextLiteral: Extract<CompiledToken, { type: "literal" }> | undefined,
) {
  if (!nextLiteral) {
    return {
      segmentText: text.slice(cursor),
      nextCursor: text.length,
    };
  }

  const boundary = findNextLiteralBoundary(text, nextLiteral.value, cursor);

  if (!boundary) {
    return null;
  }

  return {
    segmentText: text.slice(cursor, boundary.start),
    nextCursor: boundary.start,
  };
}

function scoreSurfacePriority(priority: number | undefined) {
  return clamp(1 - (priority ?? 0) * 0.015, 0.35, 1);
}

function average(values: readonly number[], fallback: number) {
  if (values.length === 0) {
    return fallback;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isAcceptedCandidate(
  candidate: Omit<ConstrainedTemplateMatch, "accepted" | "evidence">,
  allDictionaryResolutions: readonly PlaceholderResolution[],
  ocrConfidence: number | null | undefined,
) {
  if (candidate.literalScore < MIN_LITERAL_SCORE) {
    return false;
  }

  if (candidate.confidenceScore < MIN_FINAL_SCORE || candidate.margin < MIN_MARGIN) {
    return false;
  }

  const fuzzyDictionaryResolutions = allDictionaryResolutions.filter(
    (resolution) => resolution.method === "fuzzy",
  );

  if (
    fuzzyDictionaryResolutions.length > 0 &&
    (ocrConfidence ?? 0.75) < MIN_OCR_CONFIDENCE_FOR_FUZZY_ACCEPT
  ) {
    return false;
  }

  if (fuzzyDictionaryResolutions.length >= 2) {
    return (
      candidate.confidenceScore >= MIN_FINAL_SCORE_FOR_DOUBLE_FUZZY &&
      (ocrConfidence ?? 0.75) >= MIN_OCR_CONFIDENCE_FOR_DOUBLE_FUZZY &&
      fuzzyDictionaryResolutions.every(
        (resolution) =>
          resolution.score >= 0.62 && resolution.margin >= MIN_DOUBLE_FUZZY_MARGIN,
      )
    );
  }

  if (fuzzyDictionaryResolutions.length === 1) {
    const [fuzzyResolution] = fuzzyDictionaryResolutions;
    const exactDictionaryResolutions = allDictionaryResolutions.filter(
      (resolution) => resolution.method === "exact",
    );
    const hasExactPokemon = exactDictionaryResolutions.some(
      (resolution) => resolution.kind === "pokemon" || resolution.kind === "target",
    );
    const hasExactMove = exactDictionaryResolutions.some(
      (resolution) => resolution.kind === "move",
    );
    const hasStrongSingleSlotSwitch =
      (candidate.eventType === "switch_in" || candidate.eventType === "switch_out") &&
      fuzzyResolution.kind === "pokemon" &&
      fuzzyResolution.score >= 0.78 &&
      fuzzyResolution.margin >= MIN_FUZZY_MARGIN &&
      candidate.literalScore >= 0.62 &&
      candidate.confidenceScore >= 0.7;
    const hasStrongActorMoveShape =
      candidate.eventType === "move" &&
      candidate.literalScore >= 0.62 &&
      candidate.confidenceScore >= 0.7 &&
      fuzzyResolution.score >= 0.62 &&
      ((fuzzyResolution.kind === "move" && hasExactPokemon) ||
        (fuzzyResolution.kind === "pokemon" &&
          hasExactMove &&
          fuzzyResolution.margin >= MIN_FUZZY_MARGIN));

    if (hasStrongSingleSlotSwitch || hasStrongActorMoveShape) {
      return true;
    }

    return fuzzyResolution.margin >= MIN_FUZZY_MARGIN;
  }

  return true;
}

function countCharacters(value: string) {
  return Array.from(value).length;
}

function isTolerableSuffixNoise(value: string) {
  const suffixText = createOcrMatchText(value);

  if (!suffixText) {
    return true;
  }

  return countCharacters(suffixText) <= MAX_SUFFIX_NOISE_LENGTH;
}

function inferSideFromPlaceholderPosition(
  surfaceText: string,
  resolution: PlaceholderResolution | undefined,
) {
  if (!resolution) {
    return null;
  }

  const prefixStart = Math.max(0, resolution.start - OPPONENT_PREFIX.length);
  const immediatePrefix = surfaceText.slice(prefixStart, resolution.start);

  return immediatePrefix === OPPONENT_PREFIX ? "opponent" : null;
}

export function createConstrainedCandidateIdentity(
  candidate: Pick<ConstrainedTemplateMatch, "eventType" | "actor" | "move" | "target" | "rule">,
) {
  return [
    candidate.eventType,
    candidate.actor.name ?? "",
    candidate.actor.side ?? "",
    candidate.move ?? "",
    candidate.target?.name ?? "",
    candidate.target?.side ?? "",
    candidate.rule.id,
  ].join("|");
}

function createEvidence(
  candidate: Omit<ConstrainedTemplateMatch, "accepted" | "evidence">,
) {
  return [
    `constrained:${candidate.rule.id}`,
    `identity=${candidate.identity}`,
    `surface=${candidate.surface.id}`,
    `pattern=${createOcrMatchText(candidate.pattern)}`,
    `score=${candidate.confidenceScore.toFixed(2)}`,
    `margin=${candidate.margin.toFixed(2)}`,
    candidate.suffixNoise ? `suffixNoise=${candidate.suffixNoise}` : null,
    ...candidate.placeholderResolutions.map((resolution) => resolution.evidence),
  ]
    .filter((value): value is string => Boolean(value))
    .join(":");
}

function scoreExplicitSideConstants(
  candidate: Pick<ConstrainedTemplateMatch, "rule">,
) {
  return (
    (candidate.rule.constants?.["actor.side"] ? 1 : 0) +
    (candidate.rule.constants?.["target.side"] ? 1 : 0)
  );
}

function scoreResolvedDictionaryPlaceholders(
  candidate: Pick<ConstrainedTemplateMatch, "placeholderResolutions">,
) {
  return candidate.placeholderResolutions.filter((resolution) => resolution.kind !== "text")
    .length;
}

function tryDecodePattern(
  rule: BattleTemplateRule,
  pattern: string,
  surface: TemplateMatchSurface,
  dictionary: ConstrainedTemplateDictionary,
  ocrConfidence: number | null | undefined,
) {
  const text = surface.matchText;
  const tokens = compileConstrainedTemplatePattern(pattern);

  if (!hasLiteralAnchor(text, tokens)) {
    return null;
  }

  const literalResolutions: LiteralResolution[] = [];
  const placeholderResolutions: PlaceholderResolution[] = [];
  let cursor = 0;

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex];

    if (token.type === "literal") {
      const literal = findBestLiteral(text, token.value, cursor, tokenIndex);

      if (!literal) {
        return null;
      }

      literalResolutions.push(literal);
      cursor = literal.end;
      continue;
    }

    const nextLiteral = getNextLiteral(tokens, tokenIndex);
    const segment = getPlaceholderSegment(text, cursor, nextLiteral);

    if (!segment) {
      return null;
    }

    const maxTextLength = rule.maxTextCaptureLength ?? DEFAULT_MAX_TEXT_CAPTURE_LENGTH;
    const resolution =
      token.kind === "text"
        ? resolveTextPlaceholder(token.raw, segment.segmentText, cursor, maxTextLength)
        : resolveDictionaryPlaceholder(
            token.kind,
            segment.segmentText,
            dictionary,
            cursor,
            ocrConfidence,
          );

    if (!resolution) {
      return null;
    }

    placeholderResolutions.push({ ...resolution, raw: token.raw });
    cursor = nextLiteral ? segment.nextCursor : resolution.end;
  }

  const suffixNoise = createOcrMatchText(text.slice(cursor));

  if (!isTolerableSuffixNoise(suffixNoise)) {
    return null;
  }

  const dictionaryResolutions = placeholderResolutions.filter(
    (resolution) => resolution.kind !== "text",
  );
  const literalScore = average(
    literalResolutions.map((resolution) => resolution.score),
    1,
  );
  const dictionaryScore = average(
    dictionaryResolutions.map((resolution) => resolution.score),
    dictionaryResolutions.length > 0 ? 0 : 0.9,
  );
  const normalizedOcrConfidence =
    ocrConfidence === null || ocrConfidence === undefined ? 0.75 : ocrConfidence;
  const confidenceScore =
    literalScore * 0.35 +
    dictionaryScore * 0.45 +
    normalizedOcrConfidence * 0.15 +
    scoreSurfacePriority(surface.priority) * 0.05;
  const pokemonResolution = placeholderResolutions.find(
    (resolution) => resolution.kind === "pokemon",
  );
  const targetResolution = placeholderResolutions.find(
    (resolution) => resolution.kind === "target",
  );
  const moveResolution = placeholderResolutions.find((resolution) => resolution.kind === "move");
  const actorSide =
    rule.constants?.["actor.side"] ??
    inferSideFromPlaceholderPosition(surface.matchText, pokemonResolution);
  const actor = {
    name: pokemonResolution?.value ?? null,
    side: actorSide,
  };
  const target = targetResolution?.value
    ? {
        name: targetResolution.value,
        side: rule.constants?.["target.side"] ?? null,
      }
    : null;
  const move = moveResolution?.value ?? null;
  const candidate = {
    rule,
    pattern,
    eventType: rule.eventType,
    actor,
    target,
    move,
  };

  return {
    ...candidate,
    confidenceScore,
    margin: 0,
    identity: createConstrainedCandidateIdentity(candidate),
    suffixNoise: suffixNoise || null,
    placeholderResolutions,
    literalScore,
    dictionaryScore,
    surface,
  } satisfies Omit<ConstrainedTemplateMatch, "accepted" | "evidence">;
}

export function decodeConstrainedTemplate({
  surfaces,
  dictionary,
  rules,
  ocrConfidence,
}: ConstrainedTemplateDecodeInput): ConstrainedTemplateMatch | null {
  const candidates: Array<Omit<ConstrainedTemplateMatch, "accepted" | "evidence">> = [];

  for (const rule of rules) {
    for (const pattern of rule.patterns) {
      for (const surface of surfaces) {
        const candidate = tryDecodePattern(rule, pattern, surface, dictionary, ocrConfidence);

        if (candidate) {
          candidates.push(candidate);
        }
      }
    }
  }

  const sortedCandidates = candidates.sort((left, right) => {
    const confidenceDelta = right.confidenceScore - left.confidenceScore;

    if (Math.abs(confidenceDelta) > 0.12) {
      return confidenceDelta;
    }

    return (
      scoreExplicitSideConstants(right) - scoreExplicitSideConstants(left) ||
      scoreResolvedDictionaryPlaceholders(right) - scoreResolvedDictionaryPlaceholders(left) ||
      confidenceDelta ||
      right.literalScore - left.literalScore ||
      right.dictionaryScore - left.dictionaryScore
    );
  });
  if (sortedCandidates.length === 0) {
    return null;
  }

  const evaluatedCandidates = sortedCandidates.map((candidate, index) => {
    const withMargin = {
      ...candidate,
      margin: candidate.confidenceScore - (sortedCandidates[index + 1]?.confidenceScore ?? 0),
    };
    const dictionaryResolutions = withMargin.placeholderResolutions.filter(
      (resolution) => resolution.kind !== "text",
    );

    return {
      ...withMargin,
      accepted: isAcceptedCandidate(withMargin, dictionaryResolutions, ocrConfidence),
    };
  });
  const best =
    evaluatedCandidates.find((candidate) => candidate.accepted) ?? evaluatedCandidates[0];

  return {
    ...best,
    evidence: createEvidence(best),
  };
}
