import type {
  BattleEvent,
  BattleEventType,
  BattleLogDocument,
  NormalizedRoi,
  OCRLine,
  OCRMessage,
  UnknownEvent,
} from "../core/events/schema";
import {
  DEFAULT_TIMELINE_DUPLICATE_WINDOW_MS,
  createAcceptedEventRecord,
  createConstrainedCandidateRecord,
  createTimelineObservation,
  shouldSuppressTimelineObservation,
  type TimelineAcceptedEventRecord,
  type TimelineConstrainedCandidateRecord,
  type TimelineDeduplicationRecord,
} from "../core/events/timeline";
import {
  getParsedBattleEvents,
  parseBattleMessage,
  type BattleMessageParseResult,
} from "../core/parser/seedParser";
import { normalizedOcrWeightedSimilarity } from "../core/dictionary/fuzzyMatch";
import { createOcrMatchText } from "../core/normalize/ocrText";

const DEFAULT_ROI = { x: 0, y: 0, w: 1, h: 1 } satisfies NormalizedRoi;
const DEFAULT_TOP_LIMIT = 12;
const RECENT_CONTEXT_WINDOW_MS = 2500;

export type RootCause =
  | "ocr_fragment"
  | "near_existing_event"
  | "generated_rule_near_miss"
  | "champout_source_candidate"
  | "dictionary_ocr_gap"
  | "ui_noise"
  | "manual_note_hint"
  | "insufficient_trace";

export type RecommendedAction =
  | "suppress_unknown"
  | "keep_raw_evidence"
  | "add_champout_allowlist"
  | "extend_constrained_decoder"
  | "dictionary_patch"
  | "unknown_gating_patch"
  | "hold_review"
  | "add_export_trace";

export type ProposalKind =
  | "champout_config_patch"
  | "parser_rule_patch"
  | "constrained_decoder_threshold_review"
  | "dictionary_patch"
  | "normalizer_patch"
  | "duplicate_suppression_patch"
  | "unknown_gating_patch"
  | "export_trace_schema_patch"
  | "hold_review";

export interface CoverageCsvHints {
  eventIds?: ReadonlySet<string>;
  unknownIds?: ReadonlySet<string>;
}

export interface ReplayCoverageOptions {
  battleId?: string;
  duplicateWindowMs?: number;
  csvHints?: CoverageCsvHints;
}

export interface ChampoutCoverageEntry {
  fileName: string;
  labelName: string | null;
  eventType: BattleEventType | "unknown_candidate" | "unclassified";
  score?: number;
  sourceStatus: "enabled" | "hold" | "disabled" | "unknown";
  allowedByCurrentConfig: boolean;
  blockedByDenyPattern: boolean;
  requiresPlaceholderPolicy: boolean;
  matchText?: string;
  skeletonMatchText?: string;
}

export interface ChampoutCoverageIndex {
  available: boolean;
  warnings: string[];
  entries: readonly ChampoutCoverageEntry[];
}

export interface CoverageReplayItem {
  ocrId: string;
  timestampMs: number;
  frameIndex: number | null;
  rawText: string;
  normalizedText: string;
  matchText: string;
  ocrConfidence: number | null;
  parseStatus: BattleMessageParseResult["status"];
  candidateMatches: readonly string[];
  acceptedEvents: readonly BattleEvent[];
  suppressedEvents: readonly BattleEvent[];
  unknown: UnknownEvent | null;
  suppressedUnknown: UnknownEvent | null;
  unknownSuppressedAsNoise: boolean;
  duplicateSuppressed: boolean;
  dedupeKeys: readonly string[];
}

export interface ReplayCoverageResult {
  inputOcrMessageCount: number;
  replayParsedEventCount: number;
  replayUnknownCount: number;
  previousExportedEventCount: number;
  previousExportedUnknownCount: number;
  unknownRateBeforeReplay: number;
  unknownRateAfterReplay: number;
  eventTypeDistribution: Record<string, number>;
  duplicateSuppressedCount: number;
  unknownSuppressedAsNoiseCount: number;
  constrainedAcceptedCount: number;
  constrainedReviewCount: number;
  multiEventOcrCount: number;
  coverageDeltaSummary: {
    parsedEventDelta: number;
    unknownDelta: number;
    unknownRateDelta: number;
  };
  replayItems: readonly CoverageReplayItem[];
  acceptedEvents: readonly BattleEvent[];
  unknowns: readonly UnknownEvent[];
}

export interface UnknownCoverageCluster {
  clusterKey: string;
  classification: string;
  count: number;
  weightedLoss: number;
  rootCauses: RootCause[];
  recommendedActions: RecommendedAction[];
  sampleOcrIds: string[];
  sampleTexts: string[];
  averageConfidence: number | null;
  nearestEventTypes: string[];
  champoutCandidates: Array<Omit<ChampoutCoverageEntry, "matchText" | "skeletonMatchText">>;
}

export interface UnknownCoverageProposal {
  proposalId: string;
  kind: ProposalKind;
  risk: "low" | "medium" | "high";
  expectedGain: number;
  evidenceCount: number;
  weightedLoss: number;
  clusterKeys: string[];
  rootCauses: RootCause[];
  recommendedActions: RecommendedAction[];
  targetFiles: string[];
  testSuggestions: string[];
  negativeTestSuggestions: string[];
  notes: string;
}

export interface UnknownCoverageReport {
  schemaVersion: "0.1.0";
  generatedAt: string;
  replay: Omit<ReplayCoverageResult, "replayItems" | "acceptedEvents" | "unknowns">;
  clusters: UnknownCoverageCluster[];
  proposals: UnknownCoverageProposal[];
  warnings: string[];
}

interface ClusterAccumulator {
  clusterKey: string;
  items: CoverageReplayItem[];
  rootCauses: Set<RootCause>;
  recommendedActions: Set<RecommendedAction>;
  champoutCandidates: UnknownCoverageCluster["champoutCandidates"];
  nearestEventTypes: Set<string>;
}

function round(value: number, digits = 4) {
  const factor = 10 ** digits;

  return Math.round(value * factor) / factor;
}

function getMessageTimestamp(message: Partial<OCRMessage>, index: number) {
  return typeof message.timestampMs === "number" ? message.timestampMs : index;
}

function getMessageFrameIndex(message: Partial<OCRMessage>, index: number) {
  return typeof message.frameIndex === "number" ? message.frameIndex : index;
}

function getMessageLines(message: Partial<OCRMessage>): OCRLine[] {
  if (Array.isArray(message.lines) && message.lines.length > 0) {
    return message.lines.map((line) => ({
      text: String(line.text ?? ""),
      confidence: typeof line.confidence === "number" ? line.confidence : null,
      bbox: line.bbox ?? null,
    }));
  }

  return String(message.rawText ?? "")
    .split(/\r?\n/u)
    .filter((text) => text.trim().length > 0)
    .map((text) => ({ text, confidence: message.ocrConfidence ?? null, bbox: null }));
}

function getMessageRoi(message: Partial<OCRMessage>): NormalizedRoi {
  return message.roi ?? DEFAULT_ROI;
}

function pruneDedupes(
  dedupeRecords: TimelineDeduplicationRecord[],
  timestampMs: number,
  windowMs: number,
) {
  return dedupeRecords.filter((record) => timestampMs - record.timestampMs <= windowMs);
}

function pruneConstrainedCandidates(
  candidateRecords: TimelineConstrainedCandidateRecord[],
  timestampMs: number,
) {
  return candidateRecords.filter(
    (record) => timestampMs - record.timestampMs <= RECENT_CONTEXT_WINDOW_MS,
  );
}

function pruneAcceptedRecords(
  acceptedRecords: TimelineAcceptedEventRecord[],
  timestampMs: number,
) {
  return acceptedRecords.filter(
    (record) => timestampMs - record.timestampMs <= RECENT_CONTEXT_WINDOW_MS,
  );
}

function countEventType(
  distribution: Record<string, number>,
  eventType: BattleEventType,
) {
  distribution[eventType] = (distribution[eventType] ?? 0) + 1;
}

function hasCandidatePrefix(candidateMatches: readonly string[], prefix: string) {
  return candidateMatches.some((candidate) => candidate.startsWith(prefix));
}

function isConstrainedAccepted(event: BattleEvent) {
  return [
    event.classification.templateId ?? "",
    event.classification.method,
    ...(event.classification.alternatives ?? []),
  ].some((value) => value.includes("constrained"));
}

function isGeneratedNearMiss(item: CoverageReplayItem) {
  return item.candidateMatches.some(
    (candidate) =>
      candidate.startsWith("constrained-review:") ||
      candidate.startsWith("constrained-candidate;") ||
      candidate.startsWith("partial-template;") ||
      candidate.includes("champout"),
  );
}

function isDictionaryOcrGap(item: CoverageReplayItem) {
  return item.candidateMatches.some(
    (candidate) =>
      candidate.startsWith("span:") ||
      candidate.startsWith("span-relation:") ||
      candidate.startsWith("pokemon:") ||
      candidate.startsWith("move:") ||
      candidate.includes("->"),
  );
}

function isLikelyFragment(matchText: string) {
  if (!matchText) {
    return true;
  }

  if (Array.from(matchText).length <= 5) {
    return true;
  }

  if (/^(?:相手の|味方の)?[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}A-Za-z0-9ー]{2,14}(?:の|は)$/u.test(matchText)) {
    return true;
  }

  return /^(?:砂あらし|天気|フィールド|お茶|茶|ヤバソチャ).{0,4}$/u.test(matchText);
}

function isLikelyUiNoise(item: CoverageReplayItem) {
  if (item.unknownSuppressedAsNoise) {
    return true;
  }

  if (/(?:^|\D)\d{1,2}\s*[:：]\s*\d{2}(?:\D|$)/u.test(item.normalizedText)) {
    return true;
  }

  if (["特性", "持ち物", "もちもの", "味方の"].some((hint) => item.matchText.includes(hint))) {
    return true;
  }

  return false;
}

function getCoverageRate(knownCount: number, unknownCount: number) {
  const total = knownCount + unknownCount;

  return total === 0 ? 0 : unknownCount / total;
}

function createNearestEventTypes(
  item: CoverageReplayItem,
  acceptedEvents: readonly BattleEvent[],
) {
  return acceptedEvents
    .filter((event) => Math.abs(event.timestampMs - item.timestampMs) <= RECENT_CONTEXT_WINDOW_MS)
    .map((event) => `${event.type}:${event.classification.templateId ?? ""}`)
    .slice(0, 4);
}

function createClusterKey(matchText: string) {
  const compact = createOcrMatchText(matchText);

  if (!compact) {
    return "empty";
  }

  return compact.length > 32 ? `${compact.slice(0, 32)}...` : compact;
}

function inferLikelyEventType(item: CoverageReplayItem): BattleEventType | "noise" | "unknown" {
  const text = item.matchText;

  if (text.includes("バツグン") || text.includes("ばつぐん")) {
    return "supereffective";
  }

  if (text.includes("効果") && (text.includes("ない") || text.includes("なし"))) {
    return "immune";
  }

  if (text.includes("たおれ") || text.includes("倒れ") || text.includes("ひんし")) {
    return "faint";
  }

  if (text.includes("うまく決まらなかった") || text.includes("決まらなかった")) {
    return "fail";
  }

  if (text.includes("守り") || text.includes("身を守")) {
    return "protect";
  }

  if (text.includes("上がっ") || text.includes("下がっ")) {
    return "boost";
  }

  if (text.includes("砂あらし") || text.includes("天気")) {
    return "weather_start";
  }

  if (isLikelyUiNoise(item) || isLikelyFragment(text)) {
    return "noise";
  }

  return "unknown";
}

function getEventValue(eventType: BattleEventType | "noise" | "unknown") {
  const values: Record<string, number> = {
    move: 2.2,
    switch_in: 2,
    switch_out: 1.8,
    faint: 2.4,
    status: 1.8,
    status_cure: 1.6,
    supereffective: 1.7,
    immune: 1.7,
    fail: 1.5,
    protect: 1.4,
    damage: 1.4,
    weather_start: 1.3,
    weather_end: 1.3,
    terrain_start: 1.2,
    terrain_end: 1.2,
    side_start: 1.2,
    side_end: 1.2,
    boost: 1.5,
    unboost: 1.5,
    noise: 0.15,
    unknown: 0.75,
  };

  return values[eventType] ?? 0.75;
}

function createWeightedLoss(items: readonly CoverageReplayItem[], rootCauses: Set<RootCause>) {
  return round(items.reduce((total, item) => {
    const eventType = inferLikelyEventType(item);
    const confidence = item.ocrConfidence ?? 0.6;
    const confidenceFactor = Math.max(0.35, Math.min(1.15, 0.45 + confidence));
    const nonDuplicateFactor =
      item.duplicateSuppressed || rootCauses.has("near_existing_event") ? 0.25 : 1;
    const reviewSignalFactor = rootCauses.has("manual_note_hint") ? 1.25 : 1;

    return total + getEventValue(eventType) * confidenceFactor * nonDuplicateFactor * reviewSignalFactor;
  }, 0), 3);
}

function getAverageConfidence(items: readonly CoverageReplayItem[]) {
  const values = items
    .map((item) => item.ocrConfidence)
    .filter((value): value is number => typeof value === "number");

  if (values.length === 0) {
    return null;
  }

  return round(values.reduce((total, value) => total + value, 0) / values.length, 3);
}

function sanitizeChampoutCandidate(
  candidate: ChampoutCoverageEntry,
): Omit<ChampoutCoverageEntry, "matchText" | "skeletonMatchText"> {
  return {
    fileName: candidate.fileName,
    labelName: candidate.labelName,
    eventType: candidate.eventType,
    score: candidate.score,
    sourceStatus: candidate.sourceStatus,
    allowedByCurrentConfig: candidate.allowedByCurrentConfig,
    blockedByDenyPattern: candidate.blockedByDenyPattern,
    requiresPlaceholderPolicy: candidate.requiresPlaceholderPolicy,
  };
}

function scoreChampoutCandidate(
  matchText: string,
  candidate: ChampoutCoverageEntry,
) {
  const skeleton = candidate.skeletonMatchText ?? "";
  const candidateText = candidate.matchText ?? "";

  if (!matchText || (!skeleton && !candidateText)) {
    return 0;
  }

  if (skeleton && (matchText.includes(skeleton) || skeleton.includes(matchText))) {
    return 0.94;
  }

  if (candidateText && (matchText.includes(candidateText) || candidateText.includes(matchText))) {
    return 0.9;
  }

  const skeletonScore = skeleton ? normalizedOcrWeightedSimilarity(matchText, skeleton) : 0;
  const textScore = candidateText ? normalizedOcrWeightedSimilarity(matchText, candidateText) : 0;

  return Math.max(skeletonScore, textScore);
}

function findChampoutCandidates(
  item: CoverageReplayItem,
  champoutIndex: ChampoutCoverageIndex | null | undefined,
) {
  if (!champoutIndex?.available) {
    return [];
  }

  if (isLikelyUiNoise(item) || isLikelyFragment(item.matchText)) {
    return [];
  }

  return champoutIndex.entries
    .map((entry) => ({ ...entry, score: round(scoreChampoutCandidate(item.matchText, entry), 3) }))
    .filter((entry) => (entry.score ?? 0) >= 0.68)
    .sort((left, right) => {
      const sourcePriority = (entry: ChampoutCoverageEntry) =>
        entry.fileName === "btl_set.json" ? 1 : entry.sourceStatus === "enabled" ? 0.8 : 0;

      return (
        sourcePriority(right) - sourcePriority(left) ||
        (right.score ?? 0) - (left.score ?? 0)
      );
    })
    .slice(0, 5);
}

function chooseClassification(rootCauses: Set<RootCause>) {
  if (rootCauses.has("ui_noise")) {
    return "ui_noise";
  }

  if (rootCauses.has("ocr_fragment")) {
    return "ocr_fragment";
  }

  if (rootCauses.has("near_existing_event")) {
    return "near_existing_event";
  }

  if (rootCauses.has("champout_source_candidate")) {
    return "champout_source_candidate";
  }

  if (rootCauses.has("generated_rule_near_miss")) {
    return "generated_rule_near_miss";
  }

  if (rootCauses.has("dictionary_ocr_gap")) {
    return "dictionary_ocr_gap";
  }

  return "unclassified";
}

function addRootCauseActions(
  rootCauses: Set<RootCause>,
  recommendedActions: Set<RecommendedAction>,
) {
  if (rootCauses.has("ui_noise")) {
    recommendedActions.add("unknown_gating_patch");
    recommendedActions.add("keep_raw_evidence");
  }

  if (rootCauses.has("ocr_fragment")) {
    recommendedActions.add("hold_review");
    recommendedActions.add("keep_raw_evidence");
  }

  if (rootCauses.has("near_existing_event")) {
    recommendedActions.add("suppress_unknown");
    recommendedActions.add("keep_raw_evidence");
  }

  if (rootCauses.has("generated_rule_near_miss")) {
    recommendedActions.add("extend_constrained_decoder");
    recommendedActions.add("hold_review");
  }

  if (rootCauses.has("dictionary_ocr_gap")) {
    recommendedActions.add("dictionary_patch");
  }

  if (rootCauses.has("champout_source_candidate")) {
    recommendedActions.add("add_champout_allowlist");
  }

  if (rootCauses.has("insufficient_trace")) {
    recommendedActions.add("add_export_trace");
  }
}

function createClusterAccumulators(
  replay: ReplayCoverageResult,
  champoutIndex: ChampoutCoverageIndex | null | undefined,
) {
  const clusters = new Map<string, ClusterAccumulator>();
  const clusterSourceItems = replay.replayItems.filter(
    (item) => item.unknown || item.suppressedUnknown || item.unknownSuppressedAsNoise,
  );

  for (const item of clusterSourceItems) {
    const clusterKey = createClusterKey(item.matchText);
    const cluster = clusters.get(clusterKey) ?? {
      clusterKey,
      items: [],
      rootCauses: new Set<RootCause>(),
      recommendedActions: new Set<RecommendedAction>(),
      champoutCandidates: [],
      nearestEventTypes: new Set<string>(),
    };
    const champoutCandidates = findChampoutCandidates(item, champoutIndex);

    cluster.items.push(item);

    if (isLikelyUiNoise(item)) {
      cluster.rootCauses.add("ui_noise");
    }

    if (isLikelyFragment(item.matchText)) {
      cluster.rootCauses.add("ocr_fragment");
    }

    if (item.duplicateSuppressed) {
      cluster.rootCauses.add("near_existing_event");
    }

    if (isGeneratedNearMiss(item)) {
      cluster.rootCauses.add("generated_rule_near_miss");
    }

    if (isDictionaryOcrGap(item)) {
      cluster.rootCauses.add("dictionary_ocr_gap");
    }

    if (champoutCandidates.length > 0) {
      cluster.rootCauses.add("champout_source_candidate");
      cluster.champoutCandidates = [
        ...cluster.champoutCandidates,
        ...champoutCandidates.map(sanitizeChampoutCandidate),
      ]
        .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
        .slice(0, 5);
    }

    for (const eventType of createNearestEventTypes(item, replay.acceptedEvents)) {
      cluster.nearestEventTypes.add(eventType);
    }

    clusters.set(clusterKey, cluster);
  }

  for (const cluster of clusters.values()) {
    if (
      cluster.items.length > 0 &&
      cluster.rootCauses.size === 0 &&
      cluster.items.every((item) => item.candidateMatches.length === 0)
    ) {
      cluster.rootCauses.add("insufficient_trace");
    }

    addRootCauseActions(cluster.rootCauses, cluster.recommendedActions);
  }

  return [...clusters.values()];
}

function createUnknownCoverageClusters(
  replay: ReplayCoverageResult,
  champoutIndex: ChampoutCoverageIndex | null | undefined,
) {
  return createClusterAccumulators(replay, champoutIndex)
    .map((cluster) => {
      const uniqueSamples = [...new Set(cluster.items.map((item) => item.normalizedText))]
        .filter(Boolean)
        .slice(0, 3);
      const rootCauses = [...cluster.rootCauses];
      const recommendedActions = [...cluster.recommendedActions];
      const weightedLoss = createWeightedLoss(cluster.items, cluster.rootCauses);

      return {
        clusterKey: cluster.clusterKey,
        classification: chooseClassification(cluster.rootCauses),
        count: cluster.items.length,
        weightedLoss,
        rootCauses,
        recommendedActions,
        sampleOcrIds: cluster.items.map((item) => item.ocrId).slice(0, 6),
        sampleTexts: uniqueSamples,
        averageConfidence: getAverageConfidence(cluster.items),
        nearestEventTypes: [...cluster.nearestEventTypes],
        champoutCandidates: cluster.champoutCandidates,
      } satisfies UnknownCoverageCluster;
    })
    .sort((left, right) => right.weightedLoss - left.weightedLoss || right.count - left.count);
}

function proposalKindForCluster(cluster: UnknownCoverageCluster): ProposalKind {
  if (cluster.rootCauses.includes("champout_source_candidate")) {
    const riskyCandidate = cluster.champoutCandidates.some(
      (candidate) =>
        candidate.requiresPlaceholderPolicy ||
        candidate.blockedByDenyPattern ||
        ["btl_state_syn.json", "btl_condition.json"].includes(candidate.fileName),
    );

    return riskyCandidate ? "hold_review" : "champout_config_patch";
  }

  if (cluster.rootCauses.includes("near_existing_event")) {
    return "duplicate_suppression_patch";
  }

  if (cluster.rootCauses.includes("ui_noise")) {
    return "unknown_gating_patch";
  }

  if (cluster.rootCauses.includes("generated_rule_near_miss")) {
    return "constrained_decoder_threshold_review";
  }

  if (cluster.rootCauses.includes("dictionary_ocr_gap")) {
    return "dictionary_patch";
  }

  if (cluster.rootCauses.includes("insufficient_trace")) {
    return "export_trace_schema_patch";
  }

  return "hold_review";
}

function riskForCluster(cluster: UnknownCoverageCluster, kind: ProposalKind) {
  if (kind === "champout_config_patch") {
    return "low" as const;
  }

  if (kind === "duplicate_suppression_patch" || kind === "unknown_gating_patch") {
    return cluster.rootCauses.includes("ocr_fragment") ? "medium" as const : "low" as const;
  }

  if (kind === "hold_review") {
    return "high" as const;
  }

  return "medium" as const;
}

function targetFilesForCluster(cluster: UnknownCoverageCluster, kind: ProposalKind) {
  const targetFiles = new Set<string>();

  if (kind === "champout_config_patch" || cluster.rootCauses.includes("champout_source_candidate")) {
    targetFiles.add("data/champout/champout-template-sources.ja.json");
    targetFiles.add("scripts/generate-champout-templates.mjs");
  }

  if (kind === "constrained_decoder_threshold_review") {
    targetFiles.add("src/core/templates/constrainedTemplateDecoder.ts");
  }

  if (kind === "dictionary_patch") {
    targetFiles.add("data/dictionaries");
    targetFiles.add("src/core/dictionary");
  }

  if (kind === "duplicate_suppression_patch" || kind === "unknown_gating_patch") {
    targetFiles.add("src/core/events/timeline.ts");
  }

  if (kind === "export_trace_schema_patch") {
    targetFiles.add("src/storage/export.ts");
  }

  targetFiles.add("src/core/parser/seedParser.test.ts");

  return [...targetFiles];
}

function createProposalNotes(cluster: UnknownCoverageCluster, kind: ProposalKind) {
  if (kind === "hold_review" && cluster.champoutCandidates.length > 0) {
    return "champout候補はあるが、placeholder policy不足または説明文リスクがあるため自動追加せず保留。";
  }

  if (kind === "champout_config_patch") {
    return "既存enabled sourceやbtl_set内カテゴリを優先し、allowlistを狭く追加する候補。";
  }

  if (kind === "duplicate_suppression_patch") {
    return "直近2.5秒window内の既存eventに近いunknown。raw evidenceは残してUnknownEventだけ抑制する候補。";
  }

  if (kind === "unknown_gating_patch") {
    return "UI断片またはprefix-only候補。event化ではなくunknown gatingのnegative test対象。";
  }

  if (kind === "export_trace_schema_patch") {
    return "現Battle Log JSONだけでは棄却理由が足りないため、今後のtrace拡張候補。";
  }

  return "安全にevent化できるかは追加fixtureとnegative testで確認する。";
}

function createProposalRecommendedActions(
  cluster: UnknownCoverageCluster,
  kind: ProposalKind,
): RecommendedAction[] {
  if (kind !== "hold_review") {
    return cluster.recommendedActions;
  }

  return [
    ...new Set<RecommendedAction>([
      ...cluster.recommendedActions.filter(
        (action): action is RecommendedAction => action !== "add_champout_allowlist",
      ),
      "hold_review",
    ]),
  ];
}

function createProposalForCluster(
  cluster: UnknownCoverageCluster,
  index: number,
): UnknownCoverageProposal {
  const kind = proposalKindForCluster(cluster);
  const risk = riskForCluster(cluster, kind);
  const firstSample = cluster.sampleTexts[0] ?? cluster.clusterKey;

  return {
    proposalId: `unknown_cov_${String(index + 1).padStart(3, "0")}`,
    kind,
    risk,
    expectedGain: cluster.count,
    evidenceCount: cluster.count,
    weightedLoss: cluster.weightedLoss,
    clusterKeys: [cluster.clusterKey],
    rootCauses: cluster.rootCauses,
    recommendedActions: createProposalRecommendedActions(cluster, kind),
    targetFiles: targetFilesForCluster(cluster, kind),
    testSuggestions: [
      `${firstSample} が現在parser replayでどう扱われるかをfixture化する`,
      "accepted event化する場合はCSV/JSON exportの安定順も確認する",
    ],
    negativeTestSuggestions: [
      "prefix-only、タイマー、特性/持ち物欄、短すぎる欠け文がUnknownEventにならないこと",
      "曖昧なchampout候補はaccepted eventではなくhold_reviewに残ること",
    ],
    notes: createProposalNotes(cluster, kind),
  };
}

function createProposals(clusters: readonly UnknownCoverageCluster[], topLimit: number) {
  const proposals = clusters
    .map(createProposalForCluster)
    .sort((left, right) => {
      const riskOrder = { low: 0, medium: 1, high: 2 };

      return (
        riskOrder[left.risk] - riskOrder[right.risk] ||
        right.weightedLoss - left.weightedLoss ||
        right.evidenceCount - left.evidenceCount
      );
    });

  return proposals.slice(0, topLimit).map((proposal, index) => ({
    ...proposal,
    proposalId: `unknown_cov_${String(index + 1).padStart(3, "0")}`,
  }));
}

export function replayBattleLogCoverage(
  document: Pick<BattleLogDocument, "battle" | "ocrMessages" | "events" | "unknowns"> & {
    manualCorrections?: unknown;
  },
  options: ReplayCoverageOptions = {},
): ReplayCoverageResult {
  const battleId = options.battleId ?? document.battle?.id ?? "battle_replay";
  const duplicateWindowMs = options.duplicateWindowMs ?? DEFAULT_TIMELINE_DUPLICATE_WINDOW_MS;
  const dedupeRecords: TimelineDeduplicationRecord[] = [];
  let constrainedCandidateRecords: TimelineConstrainedCandidateRecord[] = [];
  let acceptedEventRecords: TimelineAcceptedEventRecord[] = [];
  const replayItems: CoverageReplayItem[] = [];
  const acceptedEvents: BattleEvent[] = [];
  const unknowns: UnknownEvent[] = [];
  const eventTypeDistribution: Record<string, number> = {};
  let duplicateSuppressedCount = 0;
  let unknownSuppressedAsNoiseCount = 0;
  let constrainedAcceptedCount = 0;
  let constrainedReviewCount = 0;
  let multiEventOcrCount = 0;

  const messages = [...(document.ocrMessages ?? [])].sort(
    (left, right) =>
      getMessageTimestamp(left, 0) - getMessageTimestamp(right, 0) ||
      String(left.id).localeCompare(String(right.id)),
  );

  messages.forEach((message, index) => {
    const timestampMs = getMessageTimestamp(message, index);
    const frameIndex = getMessageFrameIndex(message, index);
    const rawText = String(message.rawText ?? "");
    const ocrConfidence = typeof message.ocrConfidence === "number" ? message.ocrConfidence : null;
    const lines = getMessageLines(message);
    const parseResult = parseBattleMessage({
      rawText,
      ocrConfidence,
      lines: lines.map((line) => line.text),
    });

    constrainedCandidateRecords = pruneConstrainedCandidates(constrainedCandidateRecords, timestampMs);
    acceptedEventRecords = pruneAcceptedRecords(acceptedEventRecords, timestampMs);

    const observation = createTimelineObservation({
      id: String(message.id ?? `ocr-${index + 1}`),
      battleId,
      rawText,
      parseResult,
      ocrConfidence,
      lines,
      frameIndex,
      timestampMs,
      roi: getMessageRoi(message),
      afterEventId: acceptedEvents.at(-1)?.id ?? null,
      recentConstrainedCandidates: constrainedCandidateRecords,
      recentAcceptedEvents: acceptedEventRecords,
      candidatePromotionWindowMs: RECENT_CONTEXT_WINDOW_MS,
    });
    const parsedEvents = getParsedBattleEvents(parseResult);

    if (parsedEvents.length > 1) {
      multiEventOcrCount += 1;
    }

    if (parseResult.status === "unknown" && hasCandidatePrefix(parseResult.candidateMatches, "constrained-review:")) {
      constrainedReviewCount += 1;
    }

    const acceptedForMessage: BattleEvent[] = [];
    const suppressedEvents: BattleEvent[] = [];
    const messageDedupeRecords = pruneDedupes(dedupeRecords, timestampMs, duplicateWindowMs);

    observation.events.forEach((event, eventIndex) => {
      const dedupe = observation.dedupes[eventIndex] ?? null;
      const duplicate = shouldSuppressTimelineObservation(
        messageDedupeRecords,
        dedupe,
        duplicateWindowMs,
      );

      if (duplicate) {
        duplicateSuppressedCount += 1;
        suppressedEvents.push(event);
      } else {
        acceptedForMessage.push(event);
        acceptedEvents.push(event);
        countEventType(eventTypeDistribution, event.type);

        if (isConstrainedAccepted(event)) {
          constrainedAcceptedCount += 1;
        }

        acceptedEventRecords.push(createAcceptedEventRecord(event));
      }

      if (dedupe) {
        dedupeRecords.push(dedupe);
      }
    });

    let unknown: UnknownEvent | null = null;
    let suppressedUnknown: UnknownEvent | null = null;
    let unknownSuppressedAsNoise = false;
    let duplicateSuppressed = suppressedEvents.length > 0;

    if (observation.unknown) {
      const unknownDedupe = observation.dedupes.find((dedupe) => dedupe.kind === "unknown") ?? null;
      const duplicate = shouldSuppressTimelineObservation(
        messageDedupeRecords,
        unknownDedupe,
        duplicateWindowMs,
      );

      if (duplicate) {
        duplicateSuppressedCount += 1;
        duplicateSuppressed = true;
        suppressedUnknown = observation.unknown;
      } else {
        unknown = observation.unknown;
        unknowns.push(observation.unknown);
      }

      if (unknownDedupe) {
        dedupeRecords.push(unknownDedupe);
      }
    } else if (parseResult.status === "unknown" && observation.events.length === 0) {
      unknownSuppressedAsNoise = true;
      unknownSuppressedAsNoiseCount += 1;
    }

    const constrainedCandidate = createConstrainedCandidateRecord(
      parseResult,
      timestampMs,
      frameIndex,
    );

    if (constrainedCandidate) {
      constrainedCandidateRecords.push(constrainedCandidate);
    }

    replayItems.push({
      ocrId: String(message.id ?? `ocr-${index + 1}`),
      timestampMs,
      frameIndex,
      rawText,
      normalizedText: parseResult.normalizedText,
      matchText: parseResult.matchText,
      ocrConfidence,
      parseStatus: parseResult.status,
      candidateMatches: parseResult.candidateMatches,
      acceptedEvents: acceptedForMessage,
      suppressedEvents,
      unknown,
      suppressedUnknown,
      unknownSuppressedAsNoise,
      duplicateSuppressed,
      dedupeKeys: observation.dedupes.map((dedupe) => dedupe.key),
    });
  });

  const previousExportedEventCount = document.events?.length ?? 0;
  const previousExportedUnknownCount = document.unknowns?.length ?? 0;
  const replayParsedEventCount = acceptedEvents.length;
  const replayUnknownCount = unknowns.length;
  const unknownRateBeforeReplay = getCoverageRate(
    previousExportedEventCount,
    previousExportedUnknownCount,
  );
  const unknownRateAfterReplay = getCoverageRate(replayParsedEventCount, replayUnknownCount);

  return {
    inputOcrMessageCount: messages.length,
    replayParsedEventCount,
    replayUnknownCount,
    previousExportedEventCount,
    previousExportedUnknownCount,
    unknownRateBeforeReplay: round(unknownRateBeforeReplay, 4),
    unknownRateAfterReplay: round(unknownRateAfterReplay, 4),
    eventTypeDistribution,
    duplicateSuppressedCount,
    unknownSuppressedAsNoiseCount,
    constrainedAcceptedCount,
    constrainedReviewCount,
    multiEventOcrCount,
    coverageDeltaSummary: {
      parsedEventDelta: replayParsedEventCount - previousExportedEventCount,
      unknownDelta: replayUnknownCount - previousExportedUnknownCount,
      unknownRateDelta: round(unknownRateAfterReplay - unknownRateBeforeReplay, 4),
    },
    replayItems,
    acceptedEvents,
    unknowns,
  };
}

export function createUnknownCoverageReport(
  replay: ReplayCoverageResult,
  options: {
    champoutIndex?: ChampoutCoverageIndex | null;
    top?: number;
  } = {},
): UnknownCoverageReport {
  const clusters = createUnknownCoverageClusters(replay, options.champoutIndex);
  const topLimit = options.top ?? DEFAULT_TOP_LIMIT;
  const proposals = createProposals(clusters, topLimit);
  const { replayItems: _replayItems, acceptedEvents: _acceptedEvents, unknowns: _unknowns, ...summary } = replay;

  return {
    schemaVersion: "0.1.0",
    generatedAt: "1970-01-01T00:00:00.000Z",
    replay: summary,
    clusters: clusters.slice(0, topLimit),
    proposals,
    warnings: options.champoutIndex?.warnings ? [...options.champoutIndex.warnings] : [],
  };
}
