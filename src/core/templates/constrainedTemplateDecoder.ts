import { matchDictionaryEntry, normalizedSimilarity } from "../dictionary/fuzzyMatch";
import { createOcrMatchText } from "../normalize/ocrText";
import type { BattleEvent } from "../events/schema";
import type { DictionaryEntry, DictionaryMatch } from "../dictionary/types";
import type { BattleTemplateRule, TemplateMatchSurface } from "./types";

interface ConstrainedTemplateDictionary {
  pokemon: readonly DictionaryEntry[];
  moves: readonly DictionaryEntry[];
}

type PlaceholderKind = "pokemon" | "move" | "target" | "text";

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
  kind: "pokemon" | "move" | "target",
  segmentText: string,
  dictionary: ConstrainedTemplateDictionary,
  start: number,
  ocrConfidence: number | null | undefined,
): PlaceholderResolution | null {
  const entries = kind === "move" ? dictionary.moves : dictionary.pokemon;
  let best: (PlaceholderResolution & { secondScore: number | null }) | null = null;

  for (const segment of createCandidateSegments(segmentText)) {
    const match = matchDictionaryEntry(segment.text, entries, {
      acceptScore: MIN_DICTIONARY_SCORE,
      reviewScore: 0.52,
      acceptMargin: MIN_MARGIN,
      minOcrConfidenceForFuzzy: 0.45,
      ocrConfidence,
    });

    if (!match.best || match.score === null || match.score < MIN_DICTIONARY_SCORE) {
      continue;
    }

    const margin = match.score - (match.secondScore ?? 0);
    const resolved: PlaceholderResolution & { secondScore: number | null } = {
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
      secondScore: match.secondScore,
    };

    if (
      !best ||
      resolved.score > best.score ||
      (resolved.score === best.score && resolved.margin > best.margin) ||
      (resolved.score === best.score && resolved.margin === best.margin && resolved.matchedText.length > best.matchedText.length)
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
    return fuzzyDictionaryResolutions[0].margin >= MIN_FUZZY_MARGIN;
  }

  return true;
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

function createEvidence(
  candidate: Omit<ConstrainedTemplateMatch, "accepted" | "evidence">,
) {
  return [
    `constrained:${candidate.rule.id}`,
    `surface=${candidate.surface.id}`,
    `pattern=${createOcrMatchText(candidate.pattern)}`,
    `score=${candidate.confidenceScore.toFixed(2)}`,
    `margin=${candidate.margin.toFixed(2)}`,
    ...candidate.placeholderResolutions.map((resolution) => resolution.evidence),
  ].join(":");
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
    cursor = segment.nextCursor;
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

  return {
    rule,
    pattern,
    eventType: rule.eventType,
    actor: {
      name: pokemonResolution?.value ?? null,
      side: actorSide,
    },
    target: targetResolution?.value
      ? {
          name: targetResolution.value,
          side: rule.constants?.["target.side"] ?? null,
        }
      : null,
    move: moveResolution?.value ?? null,
    confidenceScore,
    margin: 0,
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

  const sortedCandidates = candidates.sort(
    (left, right) =>
      right.confidenceScore - left.confidenceScore ||
      right.literalScore - left.literalScore ||
      right.dictionaryScore - left.dictionaryScore,
  );
  const best = sortedCandidates[0];

  if (!best) {
    return null;
  }

  const margin = best.confidenceScore - (sortedCandidates[1]?.confidenceScore ?? 0);
  const withMargin = {
    ...best,
    margin,
  };
  const dictionaryResolutions = withMargin.placeholderResolutions.filter(
    (resolution) => resolution.kind !== "text",
  );
  const accepted = isAcceptedCandidate(withMargin, dictionaryResolutions, ocrConfidence);

  return {
    ...withMargin,
    accepted,
    evidence: createEvidence(withMargin),
  };
}
