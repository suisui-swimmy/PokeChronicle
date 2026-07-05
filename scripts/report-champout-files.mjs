import fs from "node:fs";
import path from "node:path";

import {
  assertChampoutReference,
  champoutSourceRoot,
  countBy,
  extractOriginalTexts,
  getChampoutSourceCommit,
  getLabelPrefix,
  getPlaceholderPattern,
  inferEventType,
  isNonLiveText,
  loadChampoutSourceConfig,
  readJson,
  relativeToRepo,
  sourceAllowsLabel,
} from "./champout-tools.mjs";

const priorityEventTypes = new Set([
  "status",
  "status_cure",
  "faint",
  "immune",
  "unboost",
]);

const riskyFileNamePattern =
  /app|data|detail|rank|top|tournament|pokelist|pokeselect|preparation|reception|result|set|state_syn|target|team|tutorial/i;

function getBtlJsonFiles() {
  return fs
    .readdirSync(champoutSourceRoot)
    .filter((fileName) => /^btl_.*\.json$/i.test(fileName))
    .sort((left, right) => left.localeCompare(right));
}

function getSourceConfigByFileName() {
  try {
    const config = loadChampoutSourceConfig();
    return new Map(config.sources.map((source) => [source.fileName, source]));
  } catch {
    return new Map();
  }
}

function mergeReportSourceConfig(fileName, configByFileName) {
  const configured = configByFileName.get(fileName) ?? {};

  return {
    fileName,
    status: configured.status ?? "unconfigured",
    reason: configured.reason ?? "",
    labelAllowPatterns: configured.labelAllowPatterns ?? [],
    labelDenyPatterns: configured.labelDenyPatterns ?? [],
    textDenyHints: configured.textDenyHints ?? [],
    eventTypeRules: configured.eventTypeRules ?? [],
    placeholderPolicy: configured.placeholderPolicy,
  };
}

function createRiskHints(input) {
  const {
    fileName,
    extractedTextCount,
    battleCandidateCount,
    nonLiveTextCount,
    eventTypeDistribution,
    sourceStatus,
  } = input;
  const riskHints = [];
  const unclassifiedCount = eventTypeDistribution.unclassified ?? 0;
  const nonLiveRate = extractedTextCount > 0 ? nonLiveTextCount / extractedTextCount : 1;
  const candidateRate = extractedTextCount > 0 ? battleCandidateCount / extractedTextCount : 0;

  if (sourceStatus === "enabled") {
    riskHints.push("already_enabled");
  }

  if (riskyFileNamePattern.test(fileName)) {
    riskHints.push("ui_or_data_file_name");
  }

  if (extractedTextCount === 0) {
    riskHints.push("no_original_text");
  }

  if (nonLiveRate >= 0.4) {
    riskHints.push("many_non_live_texts");
  }

  if (candidateRate < 0.1) {
    riskHints.push("few_battle_candidates");
  }

  if (unclassifiedCount > battleCandidateCount) {
    riskHints.push("many_unclassified_messages");
  }

  if (battleCandidateCount > 250) {
    riskHints.push("too_many_candidates_for_one_step");
  }

  return riskHints;
}

function chooseRecommendation(input) {
  const { battleCandidateCount, eventTypeDistribution, riskHints } = input;
  const hasPriorityEvent = [...priorityEventTypes].some(
    (eventType) => (eventTypeDistribution[eventType] ?? 0) > 0,
  );

  if (riskHints.includes("already_enabled")) {
    return {
      recommendation: "hold",
      recommendedReason: "すでに標準packへenabled済みです。",
    };
  }

  if (
    riskHints.includes("ui_or_data_file_name") ||
    riskHints.includes("many_non_live_texts") ||
    riskHints.includes("too_many_candidates_for_one_step")
  ) {
    return {
      recommendation: "risky",
      recommendedReason: "UI/データ用途または候補過多の可能性があり、今回の1ファイル追加には不向きです。",
    };
  }

  if (battleCandidateCount > 0 && hasPriorityEvent) {
    return {
      recommendation: "usable",
      recommendedReason: "優先event typeを含み、候補数が小さめなので追加検証しやすいです。",
    };
  }

  if (battleCandidateCount > 0) {
    return {
      recommendation: "hold",
      recommendedReason: "battle候補はありますが、今回優先のevent typeへの効果は限定的です。",
    };
  }

  return {
    recommendation: "hold",
    recommendedReason: "安全にevent化できる候補が少ないため保留です。",
  };
}

function createFileReport(fileName, configByFileName) {
  const sourceConfig = mergeReportSourceConfig(fileName, configByFileName);
  const filePath = path.join(champoutSourceRoot, fileName);
  const json = readJson(filePath);
  const extracted = extractOriginalTexts(json, fileName);
  const originalTextCount = extracted.length;
  const allowedByLabel = extracted.filter((item) => sourceAllowsLabel(item, sourceConfig));
  const nonLiveTextCount = allowedByLabel.filter((item) =>
    isNonLiveText(item, sourceConfig),
  ).length;
  const liveTexts = allowedByLabel.filter((item) => !isNonLiveText(item, sourceConfig));
  const inferredEventTypes = liveTexts.map(
    (item) => inferEventType(item, sourceConfig) ?? "unclassified",
  );
  const battleCandidateCount = inferredEventTypes.filter(
    (eventType) => eventType !== "unclassified",
  ).length;
  const eventTypeDistribution = countBy(inferredEventTypes);
  const labelPrefixDistribution = countBy(
    extracted.map((item) => getLabelPrefix(item.labelName)),
  );
  const placeholderPatternDistribution = countBy(
    extracted.map((item) => getPlaceholderPattern(item.text)),
  );
  const riskHints = createRiskHints({
    fileName,
    extractedTextCount: extracted.length,
    battleCandidateCount,
    nonLiveTextCount,
    eventTypeDistribution,
    sourceStatus: sourceConfig.status,
  });
  const recommendation = chooseRecommendation({
    battleCandidateCount,
    eventTypeDistribution,
    riskHints,
  });

  return {
    fileName,
    sourceStatus: sourceConfig.status,
    extractedTextCount: extracted.length,
    originalTextCount,
    battleCandidateCount,
    nonLiveTextCount,
    placeholderPatternDistribution,
    labelPrefixDistribution,
    eventTypeDistribution,
    riskHints,
    ...recommendation,
  };
}

function sortTopCandidates(reports) {
  return [...reports].sort((left, right) => {
    const leftUsable = left.recommendation === "usable" ? 1 : 0;
    const rightUsable = right.recommendation === "usable" ? 1 : 0;
    const leftPriorityCount = [...priorityEventTypes].reduce(
      (sum, eventType) => sum + (left.eventTypeDistribution[eventType] ?? 0),
      0,
    );
    const rightPriorityCount = [...priorityEventTypes].reduce(
      (sum, eventType) => sum + (right.eventTypeDistribution[eventType] ?? 0),
      0,
    );

    return (
      rightUsable - leftUsable ||
      rightPriorityCount - leftPriorityCount ||
      right.battleCandidateCount - left.battleCandidateCount ||
      left.fileName.localeCompare(right.fileName)
    );
  });
}

function printConsoleSummary(report) {
  console.log(`champout source commit: ${report.sourceCommit}`);
  console.log(`scanned files: ${report.files.length}`);
  console.log("");
  console.log("Top candidates:");
  console.table(
    sortTopCandidates(report.files)
      .slice(0, 8)
      .map((file) => ({
        fileName: file.fileName,
        status: file.sourceStatus,
        recommendation: file.recommendation,
        extracted: file.extractedTextCount,
        candidates: file.battleCandidateCount,
        eventTypes: Object.entries(file.eventTypeDistribution)
          .filter(([eventType]) => eventType !== "unclassified")
          .map(([eventType, count]) => `${eventType}:${count}`)
          .join(", "),
        riskHints: file.riskHints.join(", "),
      })),
  );
  console.log("");
  console.log("Full report JSON follows. It intentionally omits raw OriginalText values.");
  console.log(JSON.stringify(report, null, 2));
}

function createReport() {
  assertChampoutReference();
  const sourceCommit = getChampoutSourceCommit();
  const configByFileName = getSourceConfigByFileName();
  const files = getBtlJsonFiles().map((fileName) =>
    createFileReport(fileName, configByFileName),
  );

  return {
    schemaVersion: "0.1.0",
    generatedAt: new Date(0).toISOString(),
    source: "projectpokemon/champout",
    sourceCommit,
    sourceRoot: relativeToRepo(champoutSourceRoot),
    files,
  };
}

printConsoleSummary(createReport());
