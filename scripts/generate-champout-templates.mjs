import fs from "node:fs";
import path from "node:path";

import {
  assertChampoutReference,
  champoutSourceRoot,
  countBy,
  createRule,
  dedupeRules,
  extractOriginalTexts,
  generatedChampoutOutputPath,
  getChampoutSourceCommit,
  getEnabledSources,
  inferEventType,
  isNonLiveText,
  loadChampoutSourceConfig,
  readJson,
  relativeToRepo,
  schemaVersion,
  sourceAllowsLabel,
} from "./champout-tools.mjs";

function getBattleCandidates(extracted, sourceConfig) {
  return extracted
    .filter((item) => sourceAllowsLabel(item, sourceConfig))
    .filter((item) => !isNonLiveText(item, sourceConfig))
    .map((item) => {
      const eventType = inferEventType(item, sourceConfig);
      return eventType ? { item, eventType } : null;
    })
    .filter(Boolean);
}

function generateRulesForSource(sourceConfig, sourceCommit) {
  const filePath = path.join(champoutSourceRoot, sourceConfig.fileName);

  if (!fs.existsSync(filePath)) {
    throw new Error(`${relativeToRepo(filePath)} が見つかりません。`);
  }

  const json = readJson(filePath);
  const extracted = extractOriginalTexts(json, sourceConfig.fileName);
  const candidates = getBattleCandidates(extracted, sourceConfig);
  const fileRules = candidates
    .map(({ item, eventType }) => createRule(item, eventType, sourceCommit, sourceConfig))
    .filter(Boolean);

  return {
    extracted,
    candidates,
    rules: fileRules,
    summary: {
      fileName: sourceConfig.fileName,
      reason: sourceConfig.reason ?? "",
      extractedTextCount: extracted.length,
      battleCandidateCount: candidates.length,
      generatedRuleCount: fileRules.length,
      skippedTextCount: Math.max(0, extracted.length - fileRules.length),
      eventTypeDistribution: countBy(candidates.map(({ eventType }) => eventType)),
    },
  };
}

function generate() {
  assertChampoutReference();
  const config = loadChampoutSourceConfig();
  const enabledSources = getEnabledSources(config);

  if (enabledSources.length === 0) {
    throw new Error("champout source configにenabled sourceがありません。");
  }

  const sourceCommit = getChampoutSourceCommit();
  const allExtracted = [];
  const rules = [];
  const perFile = [];

  for (const sourceConfig of enabledSources) {
    const result = generateRulesForSource(sourceConfig, sourceCommit);

    allExtracted.push(...result.extracted);
    rules.push(...result.rules);
    perFile.push(result.summary);
  }

  const dedupedRules = dedupeRules(rules, config.maxGeneratedRules);
  const sourceFiles = enabledSources.map((source) => source.fileName);
  const pack = {
    schemaVersion,
    generatedAt: new Date(0).toISOString(),
    generator: "scripts/generate-champout-templates.mjs",
    source: {
      name: "projectpokemon/champout",
      root: "others/champout",
      language: config.language,
      license: "MIT",
      sourceCommit,
      noticeFile: "THIRD_PARTY_NOTICES.md",
      configFile: "data/champout/champout-template-sources.ja.json",
      files: sourceFiles,
    },
    stats: {
      sourceFileCount: sourceFiles.length,
      extractedTextCount: allExtracted.length,
      battleCandidateCount: rules.length,
      generatedRuleCount: dedupedRules.length,
      skippedTextCount: Math.max(0, allExtracted.length - dedupedRules.length),
      duplicateRuleCount: Math.max(0, rules.length - dedupedRules.length),
      maxGeneratedRules: config.maxGeneratedRules,
      eventTypeDistribution: countBy(dedupedRules.map((rule) => rule.eventType)),
      perFile,
    },
    rules: dedupedRules,
  };

  fs.mkdirSync(path.dirname(generatedChampoutOutputPath), { recursive: true });
  fs.writeFileSync(generatedChampoutOutputPath, `${JSON.stringify(pack, null, 2)}\n`);

  console.log(`champout source commit: ${sourceCommit}`);
  console.log(`source config: ${pack.source.configFile}`);
  console.log(`source files: ${sourceFiles.join(", ")}`);
  console.log(`extracted strings: ${pack.stats.extractedTextCount}`);
  console.log(`battle candidates: ${pack.stats.battleCandidateCount}`);
  console.log(`generated rules: ${pack.stats.generatedRuleCount}`);
  console.log(`duplicates skipped: ${pack.stats.duplicateRuleCount}`);
  console.log(`output: ${relativeToRepo(generatedChampoutOutputPath)}`);
}

generate();
