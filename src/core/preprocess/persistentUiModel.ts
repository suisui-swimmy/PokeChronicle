import type { MessageVisualSignature } from "./messagePresenceDetection";

export interface PersistentUiConfig {
  gridColumns: number;
  gridRows: number;
  historySamples: number;
  minimumHistorySamples: number;
  occupiedSampleRatio: number;
  maximumTransitionRatio: number;
  suppressionOverlapRatio: number;
  minimumDynamicForegroundRatio: number;
}

export const DEFAULT_PERSISTENT_UI_CONFIG: Readonly<PersistentUiConfig> = {
  gridColumns: 32,
  gridRows: 12,
  historySamples: 36,
  minimumHistorySamples: 6,
  occupiedSampleRatio: 0.8,
  maximumTransitionRatio: 0.2,
  suppressionOverlapRatio: 0.7,
  minimumDynamicForegroundRatio: 0.3,
};

export interface PersistentUiModelState {
  occupancyHistory: number[][];
}

export interface PersistentUiSampleAnalysis {
  persistentCells: number[];
  persistentUiOverlapRatio: number;
  dynamicForegroundRatio: number;
  historySampleCount: number;
  isWarmedUp: boolean;
}

export interface PersistentUiAdvanceResult {
  state: PersistentUiModelState;
  analysis: PersistentUiSampleAnalysis;
}

function createEmptyGrid(config: PersistentUiConfig) {
  return Array.from(
    { length: Math.max(1, config.gridColumns * config.gridRows) },
    () => 0,
  );
}

function normalizeOccupancyGrid(
  signature: MessageVisualSignature | null,
  config: PersistentUiConfig,
) {
  const cellCount = Math.max(1, config.gridColumns * config.gridRows);

  if (
    !signature ||
    signature.gridColumns !== config.gridColumns ||
    signature.gridRows !== config.gridRows ||
    signature.occupancyGrid.length !== cellCount
  ) {
    return createEmptyGrid(config);
  }

  return signature.occupancyGrid.map((value) => (value > 0 ? 1 : 0));
}

export function createInitialPersistentUiModelState(): PersistentUiModelState {
  return {
    occupancyHistory: [],
  };
}

function createPersistentCells(
  history: readonly (readonly number[])[],
  config: PersistentUiConfig,
) {
  const cellCount = Math.max(1, config.gridColumns * config.gridRows);

  if (history.length < config.minimumHistorySamples) {
    return Array.from({ length: cellCount }, () => 0);
  }

  return Array.from({ length: cellCount }, (_, cellIndex) => {
    let occupiedCount = 0;
    let transitionCount = 0;
    let previous = history[0]?.[cellIndex] ?? 0;

    for (let sampleIndex = 0; sampleIndex < history.length; sampleIndex += 1) {
      const occupied = (history[sampleIndex]?.[cellIndex] ?? 0) > 0 ? 1 : 0;

      occupiedCount += occupied;
      if (sampleIndex > 0 && occupied !== previous) {
        transitionCount += 1;
      }
      previous = occupied;
    }

    const occupiedRatio = occupiedCount / history.length;
    const transitionRatio =
      history.length <= 1 ? 0 : transitionCount / (history.length - 1);

    return occupiedRatio >= config.occupiedSampleRatio &&
      transitionRatio <= config.maximumTransitionRatio
      ? 1
      : 0;
  });
}

export function advancePersistentUiModel(
  state: PersistentUiModelState,
  signature: MessageVisualSignature | null,
  config: PersistentUiConfig = DEFAULT_PERSISTENT_UI_CONFIG,
): PersistentUiAdvanceResult {
  const occupancy = normalizeOccupancyGrid(signature, config);
  const occupancyHistory = [...state.occupancyHistory, occupancy].slice(
    -Math.max(1, config.historySamples),
  );
  const persistentCells = createPersistentCells(occupancyHistory, config);
  let foregroundCellCount = 0;
  let persistentForegroundCellCount = 0;

  occupancy.forEach((occupied, index) => {
    if (!occupied) {
      return;
    }

    foregroundCellCount += 1;
    persistentForegroundCellCount += persistentCells[index] > 0 ? 1 : 0;
  });

  const persistentUiOverlapRatio =
    foregroundCellCount === 0
      ? 0
      : persistentForegroundCellCount / foregroundCellCount;

  return {
    state: {
      occupancyHistory,
    },
    analysis: {
      persistentCells,
      persistentUiOverlapRatio,
      dynamicForegroundRatio:
        foregroundCellCount === 0 ? 0 : 1 - persistentUiOverlapRatio,
      historySampleCount: occupancyHistory.length,
      isWarmedUp: occupancyHistory.length >= config.minimumHistorySamples,
    },
  };
}

export function isPersistentUiDominant(
  analysis: Pick<
    PersistentUiSampleAnalysis,
    "persistentUiOverlapRatio" | "dynamicForegroundRatio" | "isWarmedUp"
  >,
  config: PersistentUiConfig = DEFAULT_PERSISTENT_UI_CONFIG,
) {
  return (
    analysis.isWarmedUp &&
    analysis.persistentUiOverlapRatio >= config.suppressionOverlapRatio &&
    analysis.dynamicForegroundRatio < config.minimumDynamicForegroundRatio
  );
}
