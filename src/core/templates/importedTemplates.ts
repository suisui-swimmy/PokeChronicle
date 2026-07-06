import type { BattleEventType } from "../events/schema";
import { createOcrMatchText, normalizeOcrText } from "../normalize/ocrText";
import type { BattleTemplateRule } from "./types";

export const TEMPLATE_IMPORT_SCHEMA_VERSION = "0.1.0" as const;
export const TEMPLATE_IMPORT_APP_VERSION = "0.1.0";

export interface TemplateImportFileInput {
  name: string;
  text: string;
}

export interface ImportedTemplateSourceSummary {
  fileName: string;
  extractedTextCount: number;
  battleCandidateCount: number;
  generatedRuleCount: number;
  skippedTextCount: number;
  sourceCommit: string | null;
}

export interface ImportedTemplateCollection {
  schemaVersion: typeof TEMPLATE_IMPORT_SCHEMA_VERSION;
  appVersion: string;
  id: string;
  importedAt: string;
  sourceCommit: string | null;
  sources: ImportedTemplateSourceSummary[];
  stats: {
    sourceFileCount: number;
    extractedTextCount: number;
    battleCandidateCount: number;
    generatedRuleCount: number;
    skippedTextCount: number;
  };
  rules: BattleTemplateRule[];
}

export type TemplateImportResult =
  | { ok: true; collection: ImportedTemplateCollection; warnings: string[] }
  | { ok: false; error: string };

interface ExtractedTemplateText {
  fileName: string;
  keyPath: string;
  labelName: string | null;
  text: string;
}

interface RuleCandidate {
  extracted: ExtractedTemplateText;
  normalizedText: string;
  eventType: BattleEventType;
}

const MAX_SOURCE_TEXT_LENGTH = 120;
const MAX_IMPORT_RULES = 800;
const JAPANESE_TEXT_PATTERN = /[ぁ-んァ-ヶ一-龯]/;
const NUMBERED_PLACEHOLDER_PATTERN = /\{\s*(\d+)\s*\}/g;
const BATTLE_FILE_PATTERN = /(^|[\\/])(btl_|battle)|^btl_|btl_/i;
const BATTLE_LABEL_PATTERN = /^(BTL|ATKMSG|WAZA_BTL|BATTLE)[A-Z0-9_]*|_BTL_/i;
const INFO_LABEL_PATTERN = /(?:^|_)INFO(?:_|$)|TUTORIAL|HELP|SELECT|POKESELECT|RECEPTION/i;
const DEDUPE_SEPARATOR = "\u001f";

const BATTLE_TEXT_KEYWORDS = [
  "相手",
  "効果",
  "急所",
  "倒れ",
  "たおれ",
  "ひんし",
  "ゆけっ",
  "いけっ",
  "引っこめ",
  "ひっこめ",
  "もどれ",
  "戻れ",
  "ダメージ",
  "反動",
  "削られ",
  "HP",
  "回復",
  "フィールド",
  "天気",
  "雨",
  "あめ",
  "雪",
  "砂あらし",
  "日差し",
  "特性",
  "道具",
  "ブーストエナジー",
  "発動",
  "外れ",
  "失敗",
  "守った",
  "まもる",
  "上がった",
  "下がった",
];

const NON_LIVE_TEXT_HINTS = [
  "確率",
  "ボタン",
  "選択",
  "選ぶ",
  "一覧",
  "説明",
  "ルール",
  "チュートリアル",
  "受付",
  "トレーニング",
];

const ACTOR_EVENT_TYPES = new Set<BattleEventType>([
  "move",
  "switch_out",
  "switch_in",
  "faint",
  "damage",
  "heal",
  "status",
  "status_cure",
  "flinch",
  "boost",
  "unboost",
  "protect",
  "miss",
  "fail",
  "item",
  "ability",
  "activate",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTemplateSourceText(text: string) {
  return normalizeOcrText(text)
    .replace(/[ \t\u3000]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hasUsableJapaneseText(text: string) {
  const normalizedText = normalizeTemplateSourceText(text);
  const matchText = createOcrMatchText(normalizedText);

  return (
    normalizedText.length >= 2 &&
    normalizedText.length <= MAX_SOURCE_TEXT_LENGTH &&
    matchText.length >= 3 &&
    JAPANESE_TEXT_PATTERN.test(normalizedText)
  );
}

function extractStringsFromJson(value: unknown, fileName: string) {
  const extracted: ExtractedTemplateText[] = [];

  function visit(node: unknown, keyPath: string, labelName: string | null) {
    if (typeof node === "string") {
      if (hasUsableJapaneseText(node)) {
        extracted.push({
          fileName,
          keyPath,
          labelName,
          text: normalizeTemplateSourceText(node),
        });
      }
      return;
    }

    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${keyPath}[${index}]`, labelName));
      return;
    }

    if (!isRecord(node)) {
      return;
    }

    const nextLabelName =
      typeof node.LabelName === "string" ? node.LabelName : labelName;

    Object.entries(node).forEach(([key, child]) => {
      visit(child, keyPath ? `${keyPath}.${key}` : key, nextLabelName);
    });
  }

  visit(value, "", null);

  return extracted;
}

function isBattleRelatedText(extracted: ExtractedTemplateText) {
  if (extracted.labelName && INFO_LABEL_PATTERN.test(extracted.labelName)) {
    return false;
  }

  if (NON_LIVE_TEXT_HINTS.some((hint) => extracted.text.includes(hint))) {
    return false;
  }

  if (BATTLE_FILE_PATTERN.test(extracted.fileName)) {
    return true;
  }

  if (extracted.labelName && BATTLE_LABEL_PATTERN.test(extracted.labelName)) {
    return true;
  }

  return BATTLE_TEXT_KEYWORDS.some((keyword) => extracted.text.includes(keyword));
}

function inferEventType(extracted: ExtractedTemplateText): BattleEventType | null {
  const fileName = extracted.fileName.toLowerCase();
  const labelName = extracted.labelName ?? "";
  const matchText = createOcrMatchText(extracted.text);

  if (fileName.includes("btl_attack") || /^ATKMSG_/i.test(labelName)) {
    return "move";
  }

  if (matchText.includes("効果はバツグン")) {
    return "supereffective";
  }

  if (matchText.includes("効果はいまひとつ")) {
    return "resisted";
  }

  if (matchText.includes("効果がない") || matchText.includes("効果はない")) {
    return "immune";
  }

  if (matchText.includes("急所")) {
    return "critical";
  }

  if (matchText.includes("ゆけっ") || matchText.includes("いけっ")) {
    return "switch_in";
  }

  if (matchText.includes("引っこめ") || matchText.includes("ひっこめ") || matchText.includes("戻れ")) {
    return "switch_out";
  }

  if (matchText.includes("倒れ") || matchText.includes("たおれ") || matchText.includes("ひんし")) {
    return "faint";
  }

  if (matchText.includes("ひるんで") && matchText.includes("技がだせない")) {
    return "flinch";
  }

  if (matchText.includes("外れた") || matchText.includes("あたらなかった")) {
    return "miss";
  }

  if (matchText.includes("失敗") || matchText.includes("うまく決まらない")) {
    return "fail";
  }

  if (matchText.includes("行動がはやくなった")) {
    return "item";
  }

  if (matchText.includes("身を守った") || matchText.includes("守られた")) {
    return "protect";
  }

  if (matchText.includes("上がった")) {
    return "boost";
  }

  if (matchText.includes("下がった")) {
    return "unboost";
  }

  if (
    matchText.includes("雨が上がった") ||
    matchText.includes("砂あらしが止んだ") ||
    matchText.includes("雪が止んだ") ||
    matchText.includes("天気は普通に戻った")
  ) {
    return "weather_end";
  }

  if (
    matchText.includes("雨") ||
    matchText.includes("あめ") ||
    matchText.includes("降りはじめた") ||
    matchText.includes("降り始めた") ||
    matchText.includes("砂あらし") ||
    matchText.includes("雪") ||
    matchText.includes("日差し")
  ) {
    return "weather_start";
  }

  if (matchText.includes("フィールド") && (matchText.includes("消えた") || matchText.includes("なくなった"))) {
    return "terrain_end";
  }

  if (matchText.includes("フィールド")) {
    return "terrain_start";
  }

  if (matchText.includes("特性")) {
    return "ability";
  }

  if (
    matchText.includes("道具") ||
    matchText.includes("ブーストエナジー") ||
    matchText.includes("たべのこし") ||
    matchText.includes("もちもの")
  ) {
    return "item";
  }

  if (matchText.includes("HP") || matchText.includes("体力") || matchText.includes("回復")) {
    return "heal";
  }

  if (matchText.includes("ダメージ") || matchText.includes("反動") || matchText.includes("削られ")) {
    return "damage";
  }

  if (matchText.includes("状態になった")) {
    return "status";
  }

  if (matchText.includes("治った")) {
    return "status_cure";
  }

  return null;
}

function replacePlaceholders(text: string, eventType: BattleEventType) {
  return text.replace(NUMBERED_PLACEHOLDER_PATTERN, (_, rawIndex: string) => {
    const index = Number(rawIndex);

    if (eventType === "move") {
      if (index === 0) {
        return "{pokemon}";
      }

      if (index === 1) {
        return "{move}";
      }
    }

    if (ACTOR_EVENT_TYPES.has(eventType) && index === 0) {
      return "{pokemon}";
    }

    return "{text}";
  });
}

function createRuleId(candidate: RuleCandidate, pattern: string) {
  const source = [
    candidate.extracted.fileName,
    candidate.extracted.keyPath,
    candidate.eventType,
    pattern,
  ].join(DEDUPER);
  let hash = 2166136261;

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `champout_${candidate.eventType}_${(hash >>> 0).toString(36)}`;
}

const DEDUPER = DEDUPE_SEPARATOR;

function inferActorSide(extracted: ExtractedTemplateText, pattern: string) {
  const labelName = extracted.labelName ?? "";
  const matchText = createOcrMatchText(pattern);

  if (matchText.startsWith("相手の") || /^ATKMSG_E_/i.test(labelName) || /_E_/i.test(labelName)) {
    return "opponent" as const;
  }

  return null;
}

function createRuleFromCandidate(candidate: RuleCandidate): BattleTemplateRule | null {
  const pattern = replacePlaceholders(candidate.normalizedText, candidate.eventType);
  const matchText = createOcrMatchText(pattern);

  if (matchText.replaceAll("{pokemon}", "").replaceAll("{move}", "").replaceAll("{text}", "").length < 3) {
    return null;
  }

  const actorSide = inferActorSide(candidate.extracted, pattern);

  return {
    id: createRuleId(candidate, pattern),
    eventType: candidate.eventType,
    priority: candidate.eventType === "move" ? 48 : 42,
    patterns: [pattern],
    constants: actorSide ? { "actor.side": actorSide } : undefined,
    maxGap: 4,
    maxTextCaptureLength: 18,
    confidence: 0.86,
    source: {
      fileName: candidate.extracted.fileName,
      keyPath: candidate.extracted.keyPath,
      labelName: candidate.extracted.labelName,
      originalText: candidate.extracted.text,
      sourceCommit: null,
    },
  };
}

function dedupeRules(rules: readonly BattleTemplateRule[]) {
  const seen = new Set<string>();
  const deduped: BattleTemplateRule[] = [];

  for (const rule of rules) {
    const key = [
      rule.eventType,
      rule.patterns.join("|"),
      rule.constants?.["actor.side"] ?? "",
    ].join(DEDUPER);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(rule);

    if (deduped.length >= MAX_IMPORT_RULES) {
      break;
    }
  }

  return deduped;
}

function createCollection(
  sources: ImportedTemplateSourceSummary[],
  rules: readonly BattleTemplateRule[],
  importedAt: Date,
): ImportedTemplateCollection {
  const importedAtIso = importedAt.toISOString();
  const stats = sources.reduce(
    (current, source) => ({
      sourceFileCount: current.sourceFileCount + 1,
      extractedTextCount: current.extractedTextCount + source.extractedTextCount,
      battleCandidateCount: current.battleCandidateCount + source.battleCandidateCount,
      generatedRuleCount: current.generatedRuleCount + source.generatedRuleCount,
      skippedTextCount: current.skippedTextCount + source.skippedTextCount,
    }),
    {
      sourceFileCount: 0,
      extractedTextCount: 0,
      battleCandidateCount: 0,
      generatedRuleCount: 0,
      skippedTextCount: 0,
    },
  );

  return {
    schemaVersion: TEMPLATE_IMPORT_SCHEMA_VERSION,
    appVersion: TEMPLATE_IMPORT_APP_VERSION,
    id: `template_import_${importedAtIso.replace(/[:.]/g, "-")}`,
    importedAt: importedAtIso,
    sourceCommit: null,
    sources,
    stats: {
      ...stats,
      generatedRuleCount: rules.length,
    },
    rules: [...rules],
  };
}

export function createImportedTemplateCollectionFromJsonFiles(
  files: readonly TemplateImportFileInput[],
  importedAt = new Date(),
): TemplateImportResult {
  const warnings: string[] = [];
  const sourceSummaries: ImportedTemplateSourceSummary[] = [];
  const allRules: BattleTemplateRule[] = [];

  if (files.length === 0) {
    return { ok: false, error: "JSONファイルが選択されていません。" };
  }

  for (const file of files) {
    let parsed: unknown;

    try {
      parsed = JSON.parse(file.text);
    } catch {
      warnings.push(`${file.name}: JSONとして読めなかったためスキップしました。`);
      continue;
    }

    const extracted = extractStringsFromJson(parsed, file.name);
    const battleCandidates = extracted
      .filter(isBattleRelatedText)
      .map((item): RuleCandidate | null => {
        const eventType = inferEventType(item);

        if (!eventType) {
          return null;
        }

        return {
          extracted: item,
          normalizedText: item.text,
          eventType,
        };
      })
      .filter((item): item is RuleCandidate => item !== null);
    const rules = battleCandidates
      .map(createRuleFromCandidate)
      .filter((rule): rule is BattleTemplateRule => rule !== null);

    sourceSummaries.push({
      fileName: file.name,
      extractedTextCount: extracted.length,
      battleCandidateCount: battleCandidates.length,
      generatedRuleCount: rules.length,
      skippedTextCount: Math.max(0, extracted.length - rules.length),
      sourceCommit: null,
    });
    allRules.push(...rules);
  }

  const rules = dedupeRules(allRules);

  if (sourceSummaries.length === 0) {
    return { ok: false, error: "読み込めるJSONがありませんでした。" };
  }

  if (rules.length === 0) {
    warnings.push("分類に使えるbattle template ruleは生成されませんでした。");
  }

  if (allRules.length > rules.length) {
    warnings.push(`${allRules.length - rules.length}件の重複templateをまとめました。`);
  }

  if (allRules.length > MAX_IMPORT_RULES) {
    warnings.push(`template ruleは上限${MAX_IMPORT_RULES}件まで読み込みました。`);
  }

  return {
    ok: true,
    collection: createCollection(sourceSummaries, rules, importedAt),
    warnings,
  };
}

export function serializeImportedTemplateCollection(collection: ImportedTemplateCollection) {
  return `${JSON.stringify(collection, null, 2)}\n`;
}

export function parseImportedTemplateCollectionJson(text: string): TemplateImportResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "JSONとして読めません。" };
  }

  if (!isRecord(parsed) || parsed.schemaVersion !== TEMPLATE_IMPORT_SCHEMA_VERSION) {
    return { ok: false, error: "対応していないTemplate Import形式です。" };
  }

  if (!Array.isArray(parsed.rules) || !Array.isArray(parsed.sources)) {
    return { ok: false, error: "Template Importのrules/sourcesが不正です。" };
  }

  return {
    ok: true,
    collection: parsed as unknown as ImportedTemplateCollection,
    warnings: [],
  };
}
