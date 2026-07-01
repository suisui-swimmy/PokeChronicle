import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const champoutRoot = path.join(repoRoot, "others", "champout");
const sourceRoot = path.join(champoutRoot, "rom-txt", "jpn");
const outputPath = path.join(repoRoot, "data", "generated", "champout-event-rules.ja.json");
const sourceFiles = ["btl_attack_syn.json", "btl_std.json"];
const schemaVersion = "0.1.0";
const maxGeneratedRules = 600;
const dedupeSeparator = "\u001f";

const actorEventTypes = new Set([
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

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function assertChampoutLicense() {
  const licensePath = path.join(champoutRoot, "LICENSE");
  const readmePath = path.join(champoutRoot, "README.md");

  if (!fs.existsSync(licensePath)) {
    throw new Error("others/champout/LICENSE が見つかりません。");
  }

  const licenseText = readText(licensePath);

  if (!licenseText.includes("MIT License")) {
    throw new Error("others/champout/LICENSE がMIT Licenseではありません。");
  }

  if (!fs.existsSync(readmePath)) {
    throw new Error("others/champout/README.md が見つかりません。");
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

function getChampoutSourceCommit() {
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

function normalizeOcrText(rawText) {
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

function createOcrMatchText(rawText) {
  return normalizeOcrText(rawText)
    .replace(/[!！?？。、,.・･/／\\|｜…:：;；"'`´_＿\[\]（）(){}「」『』<>＜＞]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function hasJapaneseText(text) {
  return /[ぁ-んァ-ヶ一-龯]/.test(text);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractOriginalTexts(json, fileName) {
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

function isNonLiveText(extracted) {
  const text = extracted.text;
  const labelName = extracted.labelName ?? "";

  return (
    /INFO|TUTORIAL|HELP|SELECT|POKESELECT|RECEPTION|BUTTON|UI/i.test(labelName) ||
    [
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
    ].some((hint) => text.includes(hint))
  );
}

function inferEventType(extracted) {
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

  if (matchText.includes("状態になった") || matchText.includes("混乱")) {
    return "status";
  }

  if (matchText.includes("治った")) {
    return "status_cure";
  }

  return null;
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

function replacePlaceholders(text, eventType, labelName) {
  return text.replace(/\{\s*(\d+)\s*\}/g, (_, rawIndex) =>
    placeholderForIndex(Number(rawIndex), eventType, text, labelName),
  );
}

function patternLiteralLength(pattern) {
  return createOcrMatchText(pattern)
    .replaceAll("pokemon", "")
    .replaceAll("target", "")
    .replaceAll("move", "")
    .replaceAll("text", "").length;
}

function hashRuleId(source) {
  let hash = 2166136261;

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function createRuleId(extracted, eventType, pattern) {
  return `champout_${eventType}_${hashRuleId(
    [extracted.fileName, extracted.keyPath, extracted.labelName ?? "", eventType, pattern].join(
      dedupeSeparator,
    ),
  )}`;
}

function inferSideConstants(extracted, pattern) {
  const labelName = extracted.labelName ?? "";
  const matchText = createOcrMatchText(pattern);

  if (matchText.startsWith("相手の") || /_E(?:_|$)|ATKMSG_E_/i.test(labelName)) {
    return { "actor.side": "opponent" };
  }

  return undefined;
}

function createRule(extracted, eventType, sourceCommit) {
  const pattern = replacePlaceholders(extracted.text, eventType, extracted.labelName);

  if (patternLiteralLength(pattern) < 3) {
    return null;
  }

  const constants = inferSideConstants(extracted, pattern);

  return {
    id: createRuleId(extracted, eventType, pattern),
    eventType,
    priority: eventType === "move" ? 58 : 50,
    patterns: [pattern],
    ...(constants ? { constants } : {}),
    maxGap: 4,
    maxTextCaptureLength: 18,
    confidence: 0.84,
    source: {
      fileName: extracted.fileName,
      keyPath: extracted.keyPath,
      labelName: extracted.labelName,
      originalText: extracted.text,
      sourceCommit,
    },
  };
}

function dedupeRules(rules) {
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

function generate() {
  assertChampoutLicense();
  const sourceCommit = getChampoutSourceCommit();
  const allExtracted = [];
  const rules = [];
  const perFile = [];

  for (const fileName of sourceFiles) {
    const filePath = path.join(sourceRoot, fileName);

    if (!fs.existsSync(filePath)) {
      throw new Error(`${filePath} が見つかりません。`);
    }

    const json = JSON.parse(readText(filePath));
    const extracted = extractOriginalTexts(json, fileName);
    const candidates = extracted
      .filter((item) => !isNonLiveText(item))
      .map((item) => {
        const eventType = inferEventType(item);
        return eventType ? { item, eventType } : null;
      })
      .filter(Boolean);
    const fileRules = candidates
      .map(({ item, eventType }) => createRule(item, eventType, sourceCommit))
      .filter(Boolean);

    perFile.push({
      fileName,
      extractedTextCount: extracted.length,
      battleCandidateCount: candidates.length,
      generatedRuleCount: fileRules.length,
      skippedTextCount: Math.max(0, extracted.length - fileRules.length),
    });
    allExtracted.push(...extracted);
    rules.push(...fileRules);
  }

  const dedupedRules = dedupeRules(rules);
  const pack = {
    schemaVersion,
    generatedAt: new Date(0).toISOString(),
    generator: "scripts/generate-champout-templates.mjs",
    source: {
      name: "projectpokemon/champout",
      root: "others/champout",
      language: "jpn",
      license: "MIT",
      sourceCommit,
      noticeFile: "THIRD_PARTY_NOTICES.md",
      files: sourceFiles,
    },
    stats: {
      sourceFileCount: sourceFiles.length,
      extractedTextCount: allExtracted.length,
      battleCandidateCount: rules.length,
      generatedRuleCount: dedupedRules.length,
      skippedTextCount: Math.max(0, allExtracted.length - dedupedRules.length),
      duplicateRuleCount: Math.max(0, rules.length - dedupedRules.length),
      maxGeneratedRules,
      perFile,
    },
    rules: dedupedRules,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(pack, null, 2)}\n`);

  console.log(`champout source commit: ${sourceCommit}`);
  console.log(`source files: ${sourceFiles.join(", ")}`);
  console.log(`extracted strings: ${pack.stats.extractedTextCount}`);
  console.log(`battle candidates: ${pack.stats.battleCandidateCount}`);
  console.log(`generated rules: ${pack.stats.generatedRuleCount}`);
  console.log(`duplicates skipped: ${pack.stats.duplicateRuleCount}`);
  console.log(`output: ${path.relative(repoRoot, outputPath)}`);
}

generate();
