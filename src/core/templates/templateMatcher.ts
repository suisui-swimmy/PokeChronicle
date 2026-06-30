import { findDictionarySpans, type DictionarySpan } from "../dictionary/spanMatch";
import type { DictionaryEntry } from "../dictionary/types";
import { createOcrMatchText } from "../normalize/ocrText";
import type { BattleTemplateRule, TemplateMatch, TemplateMatchSurface } from "./types";

interface TemplateDictionary {
  pokemon: readonly DictionaryEntry[];
  moves: readonly DictionaryEntry[];
}

type PlaceholderKind = "pokemon" | "move" | "text";
type CaptureSlot = "actor" | "target" | "move" | "text";

type CompiledTemplateToken =
  | { type: "literal"; value: string }
  | { type: "placeholder"; kind: PlaceholderKind; slot: CaptureSlot; raw: string };

interface TemplateMatchState {
  cursor: number;
  gapPenalty: number;
  actorName: string | null;
  targetName: string | null;
  moveName: string | null;
  textCaptures: readonly string[];
}

const PLACEHOLDER_PATTERN = /\{([^}]+)\}/g;
const DEFAULT_MAX_GAP = 3;
const DEFAULT_MAX_TEXT_CAPTURE_LENGTH = 14;
const DEFAULT_TEMPLATE_CONFIDENCE = 0.92;
const MAX_BRANCHES_PER_TOKEN = 12;

function dedupe<T>(values: readonly T[]) {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function parsePlaceholder(rawPlaceholder: string): CompiledTemplateToken {
  const raw = rawPlaceholder.trim().toLowerCase();

  if (raw === "pokemon" || raw === "actor") {
    return { type: "placeholder", kind: "pokemon", slot: "actor", raw };
  }

  if (raw === "target") {
    return { type: "placeholder", kind: "pokemon", slot: "target", raw };
  }

  if (raw === "move") {
    return { type: "placeholder", kind: "move", slot: "move", raw };
  }

  return { type: "placeholder", kind: "text", slot: "text", raw };
}

export function compileTemplatePattern(pattern: string) {
  const tokens: CompiledTemplateToken[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null = null;

  while ((match = PLACEHOLDER_PATTERN.exec(pattern)) !== null) {
    const literal = createOcrMatchText(pattern.slice(cursor, match.index));

    if (literal) {
      tokens.push({ type: "literal", value: literal });
    }

    tokens.push(parsePlaceholder(match[1]));
    cursor = match.index + match[0].length;
  }

  const tailLiteral = createOcrMatchText(pattern.slice(cursor));

  if (tailLiteral) {
    tokens.push({ type: "literal", value: tailLiteral });
  }

  return tokens;
}

function updateCapture(
  state: TemplateMatchState,
  token: Extract<CompiledTemplateToken, { type: "placeholder" }>,
  value: string,
): TemplateMatchState {
  if (token.slot === "actor") {
    return { ...state, actorName: value };
  }

  if (token.slot === "target") {
    return { ...state, targetName: value };
  }

  if (token.slot === "move") {
    return { ...state, moveName: value };
  }

  return {
    ...state,
    textCaptures: [...state.textCaptures, value],
  };
}

function isGapAllowed(tokenIndex: number, gap: number, maxGap: number) {
  return tokenIndex === 0 || gap <= maxGap;
}

function createGapPenalty(tokenIndex: number, gap: number) {
  return tokenIndex === 0 ? 0 : gap * 0.03;
}

function findDictionaryTokenSpans(
  token: Extract<CompiledTemplateToken, { type: "placeholder" }>,
  text: string,
  dictionary: TemplateDictionary,
) {
  if (token.kind === "pokemon") {
    return findDictionarySpans(text, dictionary.pokemon);
  }

  if (token.kind === "move") {
    return findDictionarySpans(text, dictionary.moves);
  }

  return [];
}

function matchLiteralToken(
  text: string,
  token: Extract<CompiledTemplateToken, { type: "literal" }>,
  state: TemplateMatchState,
  tokenIndex: number,
  maxGap: number,
) {
  const nextStates: TemplateMatchState[] = [];
  let start = text.indexOf(token.value, state.cursor);

  while (start >= 0 && nextStates.length < MAX_BRANCHES_PER_TOKEN) {
    const gap = start - state.cursor;

    if (isGapAllowed(tokenIndex, gap, maxGap)) {
      nextStates.push({
        ...state,
        cursor: start + token.value.length,
        gapPenalty: state.gapPenalty + createGapPenalty(tokenIndex, gap),
      });
    }

    start = text.indexOf(token.value, start + 1);
  }

  return nextStates;
}

function matchDictionaryToken(
  text: string,
  token: Extract<CompiledTemplateToken, { type: "placeholder" }>,
  state: TemplateMatchState,
  tokenIndex: number,
  maxGap: number,
  dictionary: TemplateDictionary,
) {
  const nextStates: TemplateMatchState[] = [];
  const spans = findDictionaryTokenSpans(token, text, dictionary);

  for (const span of spans) {
    if (span.start < state.cursor) {
      continue;
    }

    const gap = span.start - state.cursor;

    if (!isGapAllowed(tokenIndex, gap, maxGap)) {
      continue;
    }

    nextStates.push({
      ...updateCapture(state, token, span.entry.label),
      cursor: span.end,
      gapPenalty: state.gapPenalty + createGapPenalty(tokenIndex, gap),
    });

    if (nextStates.length >= MAX_BRANCHES_PER_TOKEN) {
      break;
    }
  }

  return nextStates;
}

function matchTextToken(
  text: string,
  token: Extract<CompiledTemplateToken, { type: "placeholder" }>,
  state: TemplateMatchState,
  maxTextCaptureLength: number,
) {
  const nextStates: TemplateMatchState[] = [];
  const maxEnd = Math.min(text.length, state.cursor + maxTextCaptureLength);

  for (let end = state.cursor + 1; end <= maxEnd; end += 1) {
    nextStates.push({
      ...updateCapture(state, token, text.slice(state.cursor, end)),
      cursor: end,
    });
  }

  return nextStates;
}

function matchTokens(
  text: string,
  tokens: readonly CompiledTemplateToken[],
  dictionary: TemplateDictionary,
  rule: BattleTemplateRule,
) {
  const maxGap = rule.maxGap ?? DEFAULT_MAX_GAP;
  const maxTextCaptureLength =
    rule.maxTextCaptureLength ?? DEFAULT_MAX_TEXT_CAPTURE_LENGTH;
  let states: TemplateMatchState[] = [
    {
      cursor: 0,
      gapPenalty: 0,
      actorName: null,
      targetName: null,
      moveName: null,
      textCaptures: [],
    },
  ];

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex];
    const nextStates = states.flatMap((state) => {
      if (token.type === "literal") {
        return matchLiteralToken(text, token, state, tokenIndex, maxGap);
      }

      if (token.kind === "text") {
        return matchTextToken(text, token, state, maxTextCaptureLength);
      }

      return matchDictionaryToken(text, token, state, tokenIndex, maxGap, dictionary);
    });

    states = nextStates
      .sort((left, right) => left.gapPenalty - right.gapPenalty || left.cursor - right.cursor)
      .slice(0, MAX_BRANCHES_PER_TOKEN);

    if (states.length === 0) {
      break;
    }
  }

  return states;
}

function formatTextCaptures(values: readonly string[]) {
  const captures = dedupe(values).filter(Boolean);

  if (captures.length === 0) {
    return "";
  }

  return `text=${captures.join(",")}`;
}

function createEvidence(
  rule: BattleTemplateRule,
  pattern: string,
  surface: TemplateMatchSurface,
  state: TemplateMatchState,
) {
  return [
    `template:${rule.id}`,
    `surface=${surface.id}`,
    `pattern=${createOcrMatchText(pattern)}`,
    state.actorName ? `actor=${state.actorName}` : null,
    state.targetName ? `target=${state.targetName}` : null,
    state.moveName ? `move=${state.moveName}` : null,
    formatTextCaptures(state.textCaptures) || null,
  ]
    .filter(Boolean)
    .join(":");
}

function createTemplateMatch(
  rule: BattleTemplateRule,
  pattern: string,
  surface: TemplateMatchSurface,
  state: TemplateMatchState,
): TemplateMatch {
  const confidence = Math.max(
    0.55,
    (rule.confidence ?? DEFAULT_TEMPLATE_CONFIDENCE) - state.gapPenalty,
  );

  return {
    rule,
    pattern,
    surface,
    actor: {
      name: state.actorName,
      side: rule.constants?.["actor.side"] ?? null,
    },
    target: state.targetName
      ? {
          name: state.targetName,
          side: rule.constants?.["target.side"] ?? null,
        }
      : null,
    move: state.moveName,
    confidenceScore: confidence,
    evidence: createEvidence(rule, pattern, surface, state),
  };
}

export function matchTemplateRules(
  surfaces: readonly TemplateMatchSurface[],
  dictionary: TemplateDictionary,
  rules: readonly BattleTemplateRule[],
) {
  const matches: TemplateMatch[] = [];

  for (const rule of rules) {
    for (const pattern of rule.patterns) {
      const tokens = compileTemplatePattern(pattern);

      if (tokens.length === 0) {
        continue;
      }

      for (const surface of surfaces) {
        const states = matchTokens(surface.matchText, tokens, dictionary, rule);

        for (const state of states) {
          matches.push(createTemplateMatch(rule, pattern, surface, state));
        }
      }
    }
  }

  return matches.sort(
    (left, right) =>
      right.rule.priority - left.rule.priority ||
      right.confidenceScore - left.confidenceScore ||
      (left.surface.priority ?? 0) - (right.surface.priority ?? 0),
  )[0] ?? null;
}

export type { DictionarySpan };
