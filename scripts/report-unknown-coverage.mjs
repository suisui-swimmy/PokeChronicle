#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import {
  assertChampoutReference,
  champoutRoot,
  champoutSourceRoot,
  createOcrMatchText,
  extractOriginalTexts,
  getChampoutSourceCommit,
  inferEventType,
  isNonLiveText,
  loadChampoutSourceConfig,
  matchesAnyPattern,
  readJson,
  repoRoot,
} from "./champout-tools.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const isDirectRun = process.argv[1] ? path.resolve(process.argv[1]) === scriptPath : false;
const coreEntryPath = path.join(repoRoot, "src", "tools", "unknownCoverageCore.ts");
const proposalFileName = "unknown-coverage-proposals.json";
const reviewIndexSourceFileNames = ["btl_set.json", "btl_std.json"];

function usage() {
  return [
    "Usage:",
    "  npm run report:unknown-coverage -- <battle-log.json> [--unknowns unknowns.csv] [--events events.csv] [--top 12] [--json] [--write-proposals tmp/unknown-proposals]",
  ].join("\n");
}

function parseCliArgs(argv) {
  const options = {
    battleLogPath: null,
    unknownsCsvPath: null,
    eventsCsvPath: null,
    top: 12,
    json: false,
    writeProposalsDir: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--help" || value === "-h") {
      options.help = true;
      continue;
    }

    if (value === "--unknowns") {
      options.unknownsCsvPath = argv[++index] ?? null;
      continue;
    }

    if (value === "--events") {
      options.eventsCsvPath = argv[++index] ?? null;
      continue;
    }

    if (value === "--top") {
      options.top = Number(argv[++index] ?? 12);
      continue;
    }

    if (value === "--json") {
      options.json = true;
      continue;
    }

    if (value === "--write-proposals") {
      options.writeProposalsDir = argv[++index] ?? null;
      continue;
    }

    if (value.startsWith("--")) {
      throw new Error(`Unknown option: ${value}\n${usage()}`);
    }

    if (!options.battleLogPath) {
      options.battleLogPath = value;
      continue;
    }

    throw new Error(`Unexpected positional argument: ${value}\n${usage()}`);
  }

  if (!Number.isFinite(options.top) || options.top <= 0) {
    throw new Error("--top は正の数で指定してください。");
  }

  return options;
}

async function loadCoverageCore() {
  const outfile = path.join(
    os.tmpdir(),
    `pokechronicle-unknown-coverage-core-${process.pid}-${Date.now()}.mjs`,
  );

  await build({
    entryPoints: [coreEntryPath],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "silent",
    sourcemap: false,
  });

  return import(pathToFileURL(outfile).href);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (character === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (character === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && next === "\n") {
        index += 1;
      }

      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += character;
  }

  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((header) => header.trim());

  return rows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );
}

function loadCsvHints(options) {
  const warnings = [];
  const eventIds = new Set();
  const unknownIds = new Set();
  const load = (filePath, target, label) => {
    if (!filePath) {
      return 0;
    }

    try {
      const rows = parseCsv(fs.readFileSync(filePath, "utf8"));

      for (const row of rows) {
        const id = row.id || row.eventId || row.unknownId;

        if (id) {
          target.add(id);
        }
      }

      return rows.length;
    } catch (error) {
      warnings.push(`${label} CSVを読めませんでした: ${error.message}`);
      return 0;
    }
  };

  const unknownCsvRowCount = load(options.unknownsCsvPath, unknownIds, "unknowns");
  const eventCsvRowCount = load(options.eventsCsvPath, eventIds, "events");

  return {
    warnings,
    summary: {
      unknownCsvRowCount,
      eventCsvRowCount,
      matchedUnknownIdCount: unknownIds.size,
      matchedEventIdCount: eventIds.size,
    },
    csvHints: { eventIds, unknownIds },
  };
}

function getSourceStatus(sourceConfig) {
  return ["enabled", "hold", "disabled"].includes(sourceConfig?.status)
    ? sourceConfig.status
    : "review_index";
}

function isBlockedByCurrentAllowlist(extracted, sourceConfig = {}) {
  return (
    sourceConfig.labelAllowPatterns?.length > 0 &&
    !matchesAnyPattern(extracted.labelName ?? "", sourceConfig.labelAllowPatterns)
  );
}

function isBlockedByDenyPattern(extracted, sourceConfig = {}) {
  return isNonLiveText(extracted, {
    ...sourceConfig,
    labelAllowPatterns: [],
  });
}

function getCandidateSourceStatus(configStatus, allowedByCurrentConfig) {
  if (allowedByCurrentConfig) {
    return "enabled";
  }

  if (configStatus === "hold" || configStatus === "disabled") {
    return configStatus;
  }

  return "review_index";
}

function getPlaceholderCount(text) {
  return (text.match(/\{\s*\d+\s*\}/g) ?? []).length;
}

function requiresPlaceholderPolicy(extracted, sourceConfig = {}, allowedByCurrentConfig = false) {
  const labelName = extracted.labelName ?? "";
  const placeholderCount = getPlaceholderCount(extracted.text);

  if (placeholderCount === 0) {
    return false;
  }

  if (allowedByCurrentConfig && sourceConfig.placeholderPolicy) {
    return false;
  }

  return (
    /Rank(?:up|down)Lv/i.test(labelName) ||
    (extracted.fileName === "btl_set.json" && !allowedByCurrentConfig) ||
    (placeholderCount > 1 && /上がった|下がった|ぐーん|がくっと/u.test(extracted.text)) ||
    !sourceConfig.placeholderPolicy
  );
}

function isRiskyPlaceholderCandidate(extracted, allowedByCurrentConfig) {
  if (allowedByCurrentConfig) {
    return false;
  }

  const labelName = extracted.labelName ?? "";
  const placeholderCount = getPlaceholderCount(extracted.text);

  return (
    placeholderCount >= 2 ||
    /Rank(?:up|down)Lv[123]_[2-5]_/i.test(labelName) ||
    /_(?:PP|EE)_syn$/i.test(labelName)
  );
}

function createCandidateRiskHints({
  sourceStatus,
  allowedByCurrentConfig,
  blockedByCurrentConfig,
  blockedByDenyPattern,
  requiresPlaceholderPolicy,
  riskyPlaceholder,
}) {
  return [
    sourceStatus === "review_index" ? "review_index_only" : null,
    !allowedByCurrentConfig && blockedByCurrentConfig ? "blocked_by_current_config" : null,
    blockedByDenyPattern ? "blocked_by_deny_pattern" : null,
    requiresPlaceholderPolicy ? "placeholder_policy_required" : null,
    riskyPlaceholder ? "risky_placeholder" : null,
  ].filter(Boolean);
}

function createCandidateNotes({
  sourceStatus,
  blockedByCurrentConfig,
  blockedByDenyPattern,
  requiresPlaceholderPolicy,
  riskyPlaceholder,
}) {
  if (blockedByDenyPattern) {
    return "deny/text denyに該当するためactive化は保留。";
  }

  if (requiresPlaceholderPolicy || riskyPlaceholder) {
    return "placeholderの意味が未確定のためreviewで確認する候補。";
  }

  if (blockedByCurrentConfig || sourceStatus === "review_index") {
    return "現在のactive allowlist外のreview/index候補。";
  }

  return "";
}

export function loadChampoutCoverageIndex() {
  const warnings = [];

  if (!fs.existsSync(champoutRoot) || !fs.existsSync(champoutSourceRoot)) {
    return {
      available: false,
      warnings: [
        "others/champout がないため、champout source照合はskipしました。replay/parser coverageは継続しています。",
      ],
      entries: [],
    };
  }

  try {
    assertChampoutReference();
    getChampoutSourceCommit();
  } catch (error) {
    return {
      available: false,
      warnings: [`champout参照を検証できないためsource照合をskipしました: ${error.message}`],
      entries: [],
    };
  }

  const sourceConfig = loadChampoutSourceConfig();
  const configByFileName = new Map(sourceConfig.sources.map((source) => [source.fileName, source]));
  const files = reviewIndexSourceFileNames.filter((fileName) => {
    const exists = fs.existsSync(path.join(champoutSourceRoot, fileName));

    if (!exists) {
      warnings.push(`${fileName} が見つからないため、review/index candidate照合から除外しました。`);
    }

    return exists;
  });
  const entries = [];

  for (const fileName of files) {
    const filePath = path.join(champoutSourceRoot, fileName);
    const fileSourceConfig = configByFileName.get(fileName) ?? {};
    const configStatus = getSourceStatus(fileSourceConfig);
    const extractedTexts = extractOriginalTexts(readJson(filePath), fileName);

    for (const extracted of extractedTexts) {
      const blockedByCurrentAllowlist = isBlockedByCurrentAllowlist(
        extracted,
        fileSourceConfig,
      );
      const blockedByDenyPattern = isBlockedByDenyPattern(extracted, fileSourceConfig);
      const blockedByCurrentConfig = configStatus !== "enabled" || blockedByCurrentAllowlist;
      const allowedByCurrentConfig =
        configStatus === "enabled" && !blockedByCurrentConfig && !blockedByDenyPattern;
      const sourceStatus = getCandidateSourceStatus(configStatus, allowedByCurrentConfig);
      const needsPlaceholderPolicy = requiresPlaceholderPolicy(
        extracted,
        fileSourceConfig,
        allowedByCurrentConfig,
      );
      const riskyPlaceholder = isRiskyPlaceholderCandidate(
        extracted,
        allowedByCurrentConfig,
      );
      const riskHints = createCandidateRiskHints({
        sourceStatus,
        allowedByCurrentConfig,
        blockedByCurrentConfig,
        blockedByDenyPattern,
        requiresPlaceholderPolicy: needsPlaceholderPolicy,
        riskyPlaceholder,
      });
      const matchText = createOcrMatchText(extracted.text);
      const skeletonMatchText = createOcrMatchText(
        extracted.text.replace(/\{\s*\d+\s*\}/g, ""),
      );

      entries.push({
        fileName,
        labelName: extracted.labelName,
        eventType: inferEventType(extracted, fileSourceConfig) ?? "unclassified",
        sourceStatus,
        allowedByCurrentConfig,
        blockedByCurrentConfig,
        blockedByDenyPattern,
        requiresPlaceholderPolicy: needsPlaceholderPolicy,
        riskHints,
        notes: createCandidateNotes({
          sourceStatus,
          blockedByCurrentConfig,
          blockedByDenyPattern,
          requiresPlaceholderPolicy: needsPlaceholderPolicy,
          riskyPlaceholder,
        }),
        matchText,
        skeletonMatchText,
      });
    }
  }

  return { available: true, warnings, entries };
}

function readBattleLog(filePath) {
  if (!filePath) {
    throw new Error(`Battle Log JSONを指定してください。\n${usage()}`);
  }

  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Battle Log JSONが見つかりません: ${filePath}`);
  }

  const document = JSON.parse(fs.readFileSync(absolutePath, "utf8"));

  if (!Array.isArray(document.ocrMessages)) {
    throw new Error("Battle Log JSONに ocrMessages 配列がありません。");
  }

  return { absolutePath, document };
}

function withCliMetadata(report, options, battleLogPath, csvSummary) {
  return {
    ...report,
    input: {
      battleLogFileName: path.basename(battleLogPath),
      top: options.top,
      csv: csvSummary,
    },
  };
}

function writeProposals(report, outputDir) {
  if (!outputDir) {
    return null;
  }

  const absoluteDir = path.resolve(outputDir);
  fs.mkdirSync(absoluteDir, { recursive: true });
  const outputPath = path.join(absoluteDir, proposalFileName);
  fs.writeFileSync(
    outputPath,
    `${JSON.stringify({
      schemaVersion: report.schemaVersion,
      generatedAt: report.generatedAt,
      proposals: report.proposals,
    }, null, 2)}\n`,
    "utf8",
  );

  return outputPath;
}

function printHumanReport(report, proposalOutputPath) {
  const replay = report.replay;

  console.log("Unknown Coverage Report");
  console.log("=======================");
  console.log(`Battle Log: ${report.input.battleLogFileName}`);
  console.log(`OCR messages: ${replay.inputOcrMessageCount}`);
  console.log(`Replay events: ${replay.replayParsedEventCount}`);
  console.log(`Replay unknowns: ${replay.replayUnknownCount}`);
  console.log(`Previous events/unknowns: ${replay.previousExportedEventCount}/${replay.previousExportedUnknownCount}`);
  console.log(`Unknown rate before/after: ${replay.unknownRateBeforeReplay} -> ${replay.unknownRateAfterReplay}`);
  console.log(`Duplicate suppressed: ${replay.duplicateSuppressedCount}`);
  console.log(`Unknown suppressed as noise: ${replay.unknownSuppressedAsNoiseCount}`);
  console.log(`Constrained accepted/review: ${replay.constrainedAcceptedCount}/${replay.constrainedReviewCount}`);
  console.log(`Multi-event OCR: ${replay.multiEventOcrCount}`);
  console.log("");

  if (report.warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of report.warnings) {
      console.log(`- ${warning}`);
    }
    console.log("");
  }

  console.log("Event type distribution:");
  console.table(replay.eventTypeDistribution);

  console.log("Top clusters:");
  console.table(
    report.clusters.map((cluster) => ({
      key: cluster.clusterKey,
      count: cluster.count,
      weightedLoss: cluster.weightedLoss,
      classification: cluster.classification,
      rootCauses: cluster.rootCauses.join(","),
      actions: cluster.recommendedActions.join(","),
    })),
  );

  console.log("Proposals:");
  console.table(
    report.proposals.map((proposal) => ({
      id: proposal.proposalId,
      kind: proposal.kind,
      risk: proposal.risk,
      gain: proposal.expectedGain,
      weightedLoss: proposal.weightedLoss,
      clusters: proposal.clusterKeys.join(","),
    })),
  );

  if (proposalOutputPath) {
    console.log(`Proposal JSON written: ${proposalOutputPath}`);
  }
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);

  if (options.help) {
    console.log(usage());
    return 0;
  }

  const { absolutePath, document } = readBattleLog(options.battleLogPath);
  const csv = loadCsvHints(options);
  const champoutIndex = loadChampoutCoverageIndex();
  const core = await loadCoverageCore();
  const replay = core.replayBattleLogCoverage(document, { csvHints: csv.csvHints });
  const report = withCliMetadata(
    core.createUnknownCoverageReport(replay, {
      champoutIndex,
      top: options.top,
    }),
    options,
    absolutePath,
    csv.summary,
  );

  report.warnings = [...report.warnings, ...csv.warnings];

  const proposalOutputPath = writeProposals(report, options.writeProposalsDir);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReport(report, proposalOutputPath);
  }

  return 0;
}

if (isDirectRun) {
  runCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
