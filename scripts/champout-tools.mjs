import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(__dirname, "..");
export const champoutRoot = path.join(repoRoot, "others", "champout");
export const champoutSourceRoot = path.join(champoutRoot, "rom-txt", "jpn");
export const generatedChampoutOutputPath = path.join(
  repoRoot,
  "data",
  "generated",
  "champout-event-rules.ja.json",
);
export const champoutSourceConfigPath = path.join(
  repoRoot,
  "data",
  "champout",
  "champout-template-sources.ja.json",
);

export const schemaVersion = "0.1.0";
export const defaultMaxGeneratedRules = 600;
export const dedupeSeparator = "\u001f";

export const actorEventTypes = new Set([
  "move",
  "switch_out",
  "switch_in",
  "faint",
  "damage",
  "heal",
  "status",
  "status_cure",
  "boost",
  "unboost",
  "protect",
  "miss",
  "fail",
  "item",
  "ability",
  "activate",
]);

const defaultLabelDenyPattern = /INFO|TUTORIAL|HELP|SELECT|POKESELECT|RECEPTION|BUTTON|UI/i;
const defaultNonLiveTextHints = [
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
  "プレミアム",
  "購入",
  "ランキング",
  "シーズン",
  "バトルパス",
];

export function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

export function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

export function relativeToRepo(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/");
}

export function assertChampoutReference() {
  const licensePath = path.join(champoutRoot, "LICENSE");
  const readmePath = path.join(champoutRoot, "README.md");
  const sourceRootExists = fs.existsSync(champoutSourceRoot);

  if (!fs.existsSync(licensePath)) {
    throw new Error("others/champout/LICENSE が見つかりません。ローカル参照用champout checkoutを配置してください。");
  }

  const licenseText = readText(licensePath);

  if (!licenseText.includes("MIT License")) {
    throw new Error("others/champout/LICENSE がMIT Licenseではありません。");
  }

  if (!fs.existsSync(readmePath)) {
    throw new Error("others/champout/README.md が見つかりません。");
  }

  if (!sourceRootExists) {
    throw new Error("others/champout/rom-txt/jpn が見つかりません。");
  }
}

function readHeadCommitFromGitFiles(gitDir) {
  const headText = readText(path.join(gitDir, "HEAD")).trim();

  if (/^[0-9a-f]{40}$/i.test(headText)) {
    return headText;
  }

  const refMatch = headText.match(/^ref:\s+(.+)$/);

  if (!refMatch) {
    return null;
  }

  const refPath = path.join(gitDir, ...refMatch[1].split("/"));

  if (fs.existsSync(refPath)) {
    return readText(refPath).trim();
  }

  const packedRefsPath = path.join(gitDir, "packed-refs");

  if (!fs.existsSync(packedRefsPath)) {
    return null;
  }

  const packedLine = readText(packedRefsPath)
    .split(/\r?\n/g)
    .find((line) => line.endsWith(` ${refMatch[1]}`));

  return packedLine?.split(" ")[0] ?? null;
}

export function getChampoutSourceCommit() {
  try {
    const commit = execFileSync("git", ["-C", champoutRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (/^[0-9a-f]{40}$/i.test(commit)) {
      return commit;
    }
  } catch {
    // Fall back to read-only .git files when Git refuses the local checkout owner.
  }

  const gitDir = path.join(champoutRoot, ".git");
  const commit = fs.existsSync(gitDir) ? readHeadCommitFromGitFiles(gitDir) : null;

  if (!commit || !/^[0-9a-f]{40}$/i.test(commit)) {
    throw new Error("others/champout のsource commitを特定できません。");
  }

  return commit;
}

export function normalizeOcrText(rawText) {
  return rawText
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("")
    .replace(/[！]/g, "!")
    .replace(/[／/｜|]/g, "!")
    .replace(/!+/g, "!")
    .replace(/[？]/g, "?")
    .replace(/[。｡]/g, "。")
    .replace(/[、､]/g, "、")
    .replace(/[…]+/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

export function createOcrMatchText(rawText) {
  return normalizeOcrText(rawText)
    .replace(/[!！?？。、,.・･/／\\|｜…:：;；"'`´_＿\[\]（）(){}「」『』<>＜＞]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function hasJapaneseText(text) {
  return /[ぁ-んァ-ヶ一-龯]/.test(text);
}

export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractOriginalTexts(json, fileName) {
  const extracted = [];

  function visit(node, keyPath = "", labelName = null) {
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${keyPath}[${index}]`, labelName));
      return;
    }

    if (!isRecord(node)) {
      return;
    }

    const nextLabelName = typeof node.LabelName === "string" ? node.LabelName : labelName;

    if (typeof node.OriginalText === "string") {
      const text = normalizeOcrText(node.OriginalText);
      const matchText = createOcrMatchText(text);

      if (
        text.length >= 2 &&
        text.length <= 140 &&
        matchText.length >= 3 &&
        hasJapaneseText(text)
      ) {
        extracted.push({
          fileName,
          keyPath: keyPath ? `${keyPath}.OriginalText` : "OriginalText",
          labelName: nextLabelName,
          text,
        });
      }
    }

    for (const [key, child] of Object.entries(node)) {
      if (key === "OriginalText") {
        continue;
      }

      visit(child, keyPath ? `${keyPath}.${key}` : key, nextLabelName);
    }
  }

  visit(json);
  return extracted;
}

export function createRegex(pattern) {
  return new RegExp(pattern);
}

export function matchesAnyPattern(value, patterns = []) {
  return patterns.some((pattern) => createRegex(pattern).test(value));
}

export function sourceAllowsLabel(extracted, sourceConfig = {}) {
  const labelName = extracted.labelName ?? "";

  if (
    sourceConfig.labelAllowPatterns?.length > 0 &&
    !matchesAnyPattern(labelName, sourceConfig.labelAllowPatterns)
  ) {
    return false;
  }

  if (matchesAnyPattern(labelName, sourceConfig.labelDenyPatterns ?? [])) {
    return false;
  }

  return true;
}

export function isNonLiveText(extracted, sourceConfig = {}) {
  const text = extracted.text;
  const labelName = extracted.labelName ?? "";
  const textDenyHints = [
    ...defaultNonLiveTextHints,
    ...(sourceConfig.textDenyHints ?? []),
  ];

  return (
    defaultLabelDenyPattern.test(labelName) ||
    matchesAnyPattern(labelName, sourceConfig.labelDenyPatterns ?? []) ||
    textDenyHints.some((hint) => text.includes(hint))
  );
}

function eventTypeRuleMatches(rule, extracted) {
  const when = rule.when ?? {};
  const matchText = createOcrMatchText(extracted.text);

  if (when.fileName && when.fileName !== extracted.fileName) {
    return false;
  }

  if (
    when.labelPatterns?.length > 0 &&
    !matchesAnyPattern(extracted.labelName ?? "", when.labelPatterns)
  ) {
    return false;
  }

  if (
    when.textIncludes?.length > 0 &&
    !when.textIncludes.some((hint) => extracted.text.includes(hint))
  ) {
    return false;
  }

  if (
    when.matchTextIncludes?.length > 0 &&
    !when.matchTextIncludes.some((hint) => matchText.includes(createOcrMatchText(hint)))
  ) {
    return false;
  }

  return true;
}

export function inferEventType(extracted, sourceConfig = {}) {
  const configuredRule = (sourceConfig.eventTypeRules ?? []).find((rule) =>
    eventTypeRuleMatches(rule, extracted),
  );

  if (configuredRule?.eventType) {
    return configuredRule.eventType;
  }

  const fileName = extracted.fileName.toLowerCase();
  const labelName = extracted.labelName ?? "";
  const matchText = createOcrMatchText(extracted.text);

  if (fileName === "btl_attack_syn.json" || /^ATKMSG_/i.test(labelName)) {
    return "move";
  }

  if (
    matchText.includes("勝負に勝った") ||
    matchText.includes("勝負に負けた") ||
    matchText.includes("勝負は引き分け") ||
    matchText.includes("降参が選ばれました") ||
    matchText.includes("対戦を終了します")
  ) {
    return "battle_end";
  }

  if (matchText.includes("効果は") && matchText.includes("バツグン")) {
    return "supereffective";
  }

  if (matchText.includes("効果は") && matchText.includes("いまひとつ")) {
    return "resisted";
  }

  if (matchText.includes("効果がない") || matchText.includes("効果はない")) {
    return "immune";
  }

  if (matchText.includes("急所")) {
    return "critical";
  }

  if (matchText.includes("ゆけっ") || matchText.includes("いけっ") || matchText.includes("繰り出した")) {
    return "switch_in";
  }

  if (matchText.includes("引っこめ") || matchText.includes("ひっこめ") || matchText.includes("戻れ")) {
    return "switch_out";
  }

  if (matchText.includes("倒れ") || matchText.includes("たおれ") || matchText.includes("ひんし")) {
    return "faint";
  }

  if (matchText.includes("外れた") || matchText.includes("あたらなかった")) {
    return "miss";
  }

  if (
    matchText.includes("失敗") ||
    matchText.includes("うまく決まらなかった") ||
    matchText.includes("残りポイントがなかった") ||
    matchText.includes("だせない") ||
    matchText.includes("足りなかった")
  ) {
    return "fail";
  }

  if (matchText.includes("身を守") || matchText.includes("守っている") || matchText.includes("守られた")) {
    return "protect";
  }

  if (matchText.includes("上がった") || matchText.includes("強くなった")) {
    return "boost";
  }

  if (matchText.includes("下がった")) {
    return "unboost";
  }

  if (
    matchText.includes("日差しが元に戻った") ||
    matchText.includes("雨が上がった") ||
    matchText.includes("砂あらしがおさまった") ||
    matchText.includes("砂あらしが止んだ") ||
    matchText.includes("雪が止んだ") ||
    matchText.includes("天候の影響がなくなった") ||
    matchText.includes("天気は普通に戻った")
  ) {
    return "weather_end";
  }

  if (
    matchText.includes("日差しが強くなった") ||
    matchText.includes("雨が降り始めた") ||
    matchText.includes("砂あらしが吹き始めた") ||
    matchText.includes("雪が降り始めた")
  ) {
    return "weather_start";
  }

  if (matchText.includes("フィールド") && (matchText.includes("消えた") || matchText.includes("なくなった"))) {
    return "terrain_end";
  }

  if (matchText.includes("フィールド") || matchText.includes("足下が不思議な感じになった")) {
    return "terrain_start";
  }

  if (
    matchText.includes("リフレクター") ||
    matchText.includes("ひかりのかべ") ||
    matchText.includes("オーロラベール") ||
    matchText.includes("神秘のベール") ||
    matchText.includes("追い風") ||
    matchText.includes("まきびし") ||
    matchText.includes("どくびし") ||
    matchText.includes("ステルスロック")
  ) {
    return matchText.includes("なくなった") ||
      matchText.includes("止んだ") ||
      matchText.includes("消え去った")
      ? "side_end"
      : "side_start";
  }

  if (
    matchText.includes("トリックルーム") ||
    matchText.includes("ワンダールーム") ||
    matchText.includes("マジックルーム") ||
    matchText.includes("じゅうりょく") ||
    matchText.includes("時空") ||
    matchText.includes("空間")
  ) {
    return matchText.includes("元に戻った") ||
      matchText.includes("解除") ||
      matchText.includes("なくなる")
      ? "field_end"
      : "field_start";
  }

  if (matchText.includes("特性")) {
    return "ability";
  }

  if (matchText.includes("道具") || matchText.includes("持ち物") || matchText.includes("きのみ")) {
    return "item";
  }

  if (matchText.includes("発動")) {
    return "activate";
  }

  if (matchText.includes("HP") || matchText.includes("体力") || matchText.includes("回復")) {
    return "heal";
  }

  if (matchText.includes("ダメージ") || matchText.includes("反動") || matchText.includes("削られ") || matchText.includes("自分を攻撃した")) {
    return "damage";
  }

  if (matchText.includes("治った") || matchText.includes("なおった")) {
    return "status_cure";
  }

  if (
    matchText.includes("状態になった") ||
    matchText.includes("混乱") ||
    matchText.includes("まひ") ||
    matchText.includes("やけど") ||
    matchText.includes("どく") ||
    matchText.includes("ねむり") ||
    matchText.includes("こおり")
  ) {
    return "status";
  }

  return null;
}

function policyTokenToPlaceholder(token) {
  if (token === "pokemon" || token === "move" || token === "target" || token === "text") {
    return `{${token}}`;
  }

  return null;
}

function findPlaceholderPolicy(extracted, eventType, sourceConfig = {}) {
  const policy = sourceConfig.placeholderPolicy;

  if (!policy) {
    return null;
  }

  const labelPolicy = (policy.byLabelPattern ?? []).find((entry) =>
    matchesAnyPattern(extracted.labelName ?? "", [entry.pattern]),
  );

  if (labelPolicy?.slots) {
    return labelPolicy.slots;
  }

  if (policy.byEventType?.[eventType]) {
    return policy.byEventType[eventType];
  }

  return policy.default ?? null;
}

function placeholderForIndex(index, eventType, normalizedText, labelName) {
  if (eventType === "move") {
    return index === 0 ? "{pokemon}" : index === 1 ? "{move}" : "{text}";
  }

  if (eventType === "switch_in") {
    if (/PutSingle_Player|PutDouble_Player/i.test(labelName ?? "")) {
      return index === 0 ? "{text}" : index === 1 ? "{pokemon}" : index === 2 ? "{target}" : "{text}";
    }

    return index === 0 ? "{pokemon}" : index === 1 ? "{target}" : "{text}";
  }

  if (eventType === "switch_out" && normalizedText.includes("引っこめた")) {
    return index === 0 ? "{text}" : index === 1 ? "{pokemon}" : "{text}";
  }

  if (actorEventTypes.has(eventType) && index === 0) {
    return "{pokemon}";
  }

  return "{text}";
}

export function replacePlaceholders(text, eventType, extracted, sourceConfig = {}) {
  const policySlots = findPlaceholderPolicy(extracted, eventType, sourceConfig);

  return text.replace(/\{\s*(\d+)\s*\}/g, (_, rawIndex) => {
    const index = Number(rawIndex);
    const policyPlaceholder = policySlots
      ? policyTokenToPlaceholder(policySlots[index] ?? policySlots[policySlots.length - 1])
      : null;

    return (
      policyPlaceholder ??
      placeholderForIndex(index, eventType, text, extracted.labelName)
    );
  });
}

export function patternLiteralLength(pattern) {
  return createOcrMatchText(pattern)
    .replaceAll("pokemon", "")
    .replaceAll("target", "")
    .replaceAll("move", "")
    .replaceAll("text", "").length;
}

export function allowsShortLiteralPattern(pattern, eventType) {
  if (eventType === "move") {
    return pattern.includes("{pokemon}") && pattern.includes("{move}") && pattern.includes("の");
  }

  if (eventType === "switch_out") {
    return createOcrMatchText(pattern).includes("戻れ");
  }

  return false;
}

export function hashRuleId(source) {
  let hash = 2166136261;

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

export function createRuleId(extracted, eventType, pattern) {
  return `champout_${eventType}_${hashRuleId(
    [extracted.fileName, extracted.keyPath, extracted.labelName ?? "", eventType, pattern].join(
      dedupeSeparator,
    ),
  )}`;
}

export function inferSideConstants(extracted, pattern) {
  const labelName = extracted.labelName ?? "";
  const matchText = createOcrMatchText(pattern);

  if (matchText.startsWith("相手の") || /_E(?:_|$)|ATKMSG_E_/i.test(labelName)) {
    return { "actor.side": "opponent" };
  }

  return undefined;
}

export function createRule(extracted, eventType, sourceCommit, sourceConfig = {}) {
  const pattern = replacePlaceholders(extracted.text, eventType, extracted, sourceConfig);

  if (patternLiteralLength(pattern) < 3 && !allowsShortLiteralPattern(pattern, eventType)) {
    return null;
  }

  const constants = inferSideConstants(extracted, pattern);

  return {
    id: createRuleId(extracted, eventType, pattern),
    eventType,
    priority: eventType === "move" ? 58 : 50,
    patterns: [pattern],
    ...(constants ? { constants } : {}),
    maxGap: sourceConfig.maxGap ?? 4,
    maxTextCaptureLength: sourceConfig.maxTextCaptureLength ?? 18,
    confidence: sourceConfig.confidence ?? 0.84,
    source: {
      fileName: extracted.fileName,
      keyPath: extracted.keyPath,
      labelName: extracted.labelName,
      originalText: extracted.text,
      sourceCommit,
    },
  };
}

export function dedupeRules(rules, maxGeneratedRules = defaultMaxGeneratedRules) {
  const seen = new Set();
  const deduped = [];

  for (const rule of rules) {
    const key = [
      rule.eventType,
      rule.patterns.join("|"),
      rule.constants?.["actor.side"] ?? "",
      rule.constants?.["target.side"] ?? "",
    ].join(dedupeSeparator);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(rule);

    if (deduped.length >= maxGeneratedRules) {
      break;
    }
  }

  return deduped;
}

export function countBy(values) {
  const counts = {};

  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function getLabelPrefix(labelName) {
  if (!labelName) {
    return "none";
  }

  const parts = labelName.split("_").filter(Boolean);
  return parts.slice(0, Math.min(parts.length, 3)).join("_") || labelName;
}

export function getPlaceholderPattern(text) {
  const matches = [...text.matchAll(/\{\s*(\d+)\s*\}/g)].map((match) => `{${match[1]}}`);
  return matches.length > 0 ? matches.join(" ") : "none";
}

export function loadChampoutSourceConfig() {
  if (!fs.existsSync(champoutSourceConfigPath)) {
    throw new Error(`${relativeToRepo(champoutSourceConfigPath)} が見つかりません。`);
  }

  const config = readJson(champoutSourceConfigPath);

  if (config.schemaVersion !== schemaVersion) {
    throw new Error(`champout source config schemaVersion ${config.schemaVersion} は未対応です。`);
  }

  if (!Array.isArray(config.sources)) {
    throw new Error("champout source configのsourcesが配列ではありません。");
  }

  return {
    ...config,
    maxGeneratedRules: config.maxGeneratedRules ?? defaultMaxGeneratedRules,
  };
}

export function getEnabledSources(config) {
  return config.sources.filter((source) => source.status === "enabled");
}
