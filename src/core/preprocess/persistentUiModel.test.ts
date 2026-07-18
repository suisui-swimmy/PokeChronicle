import { describe, expect, it } from "vitest";
import type { MessageVisualSignature } from "./messagePresenceDetection";
import {
  advancePersistentUiModel,
  createInitialPersistentUiModelState,
  DEFAULT_PERSISTENT_UI_CONFIG,
  isPersistentUiDominant,
  type PersistentUiConfig,
  type PersistentUiModelState,
} from "./persistentUiModel";

const TEST_CONFIG: PersistentUiConfig = {
  ...DEFAULT_PERSISTENT_UI_CONFIG,
  gridColumns: 8,
  gridRows: 4,
};

function createSignature(
  occupiedCells: readonly number[],
  config: PersistentUiConfig = TEST_CONFIG,
): MessageVisualSignature {
  const cellCount = config.gridColumns * config.gridRows;
  const occupancyGrid = Array.from({ length: cellCount }, () => 0);

  occupiedCells.forEach((cellIndex) => {
    if (cellIndex >= 0 && cellIndex < cellCount) {
      occupancyGrid[cellIndex] = 1;
    }
  });

  return {
    fingerprint: {
      columns: 16,
      rows: 8,
      cells: Array.from({ length: 16 * 8 }, () => 0),
      foregroundPixelRatio: occupiedCells.length / Math.max(1, cellCount),
    },
    occupancyGrid,
    gridColumns: config.gridColumns,
    gridRows: config.gridRows,
    foregroundBounds: null,
    lineBandCount: 1,
    foregroundCellCount: occupancyGrid.filter((cell) => cell > 0).length,
  };
}

function advanceMany(
  state: PersistentUiModelState,
  signatures: readonly MessageVisualSignature[],
  config: PersistentUiConfig = TEST_CONFIG,
) {
  let result: ReturnType<typeof advancePersistentUiModel> | null = null;
  let currentState = state;

  for (const signature of signatures) {
    result = advancePersistentUiModel(
      currentState,
      signature,
      config,
    );
    currentState = result.state;
  }

  return result ?? advancePersistentUiModel(state, null, config);
}

describe("persistent UI model", () => {
  it("identifies UI that remains in the rolling three-second window", () => {
    const staticUi = createSignature([2, 3, 4, 5, 10, 11, 12, 13]);
    const signatures = Array.from(
      { length: TEST_CONFIG.historySamples },
      () => staticUi,
    );
    let state = createInitialPersistentUiModelState();
    let result = advancePersistentUiModel(state, signatures[0], TEST_CONFIG);

    for (const signature of signatures.slice(1)) {
      result = advancePersistentUiModel(result.state, signature, TEST_CONFIG);
    }

    expect(TEST_CONFIG.historySamples).toBe(36);
    expect(result.analysis.historySampleCount).toBe(36);
    expect(result.analysis.isWarmedUp).toBe(true);
    expect(result.analysis.persistentUiOverlapRatio).toBe(1);
    expect(result.analysis.dynamicForegroundRatio).toBe(0);
    expect(isPersistentUiDominant(result.analysis, TEST_CONFIG)).toBe(true);
  });

  it("keeps changing digits in the same mostly-static region suppressible", () => {
    const stableRegion = [2, 3, 4, 5, 10, 11, 12, 13];
    const digitA = createSignature([...stableRegion, 18, 19]);
    const digitB = createSignature([...stableRegion, 20, 21]);
    const signatures = Array.from(
      { length: TEST_CONFIG.historySamples },
      (_, index) => (index % 2 === 0 ? digitA : digitB),
    );
    let state = createInitialPersistentUiModelState();
    let result = advancePersistentUiModel(state, signatures[0], TEST_CONFIG);

    for (const signature of signatures.slice(1)) {
      result = advancePersistentUiModel(result.state, signature, TEST_CONFIG);
    }

    expect(result.analysis.persistentUiOverlapRatio).toBeCloseTo(0.8);
    expect(result.analysis.dynamicForegroundRatio).toBeCloseTo(0.2);
    expect(isPersistentUiDominant(result.analysis, TEST_CONFIG)).toBe(true);
  });

  it("does not suppress a dynamic message overlaying persistent UI", () => {
    const persistentCells = [2, 3, 4, 5, 10, 11, 12, 13];
    const staticUi = createSignature(persistentCells);
    const warmup = Array.from(
      { length: TEST_CONFIG.historySamples },
      () => staticUi,
    );
    const warmed = advanceMany(
      createInitialPersistentUiModelState(),
      warmup,
      TEST_CONFIG,
    );
    const dynamicOverlay = createSignature([
      ...persistentCells,
      16,
      17,
      18,
      19,
      20,
      21,
      22,
      23,
      24,
      25,
      26,
      27,
    ]);
    const overlaid = advancePersistentUiModel(
      warmed.state,
      dynamicOverlay,
      TEST_CONFIG,
    );

    expect(overlaid.analysis.persistentUiOverlapRatio).toBeCloseTo(0.4);
    expect(overlaid.analysis.dynamicForegroundRatio).toBeCloseTo(0.6);
    expect(isPersistentUiDominant(overlaid.analysis, TEST_CONFIG)).toBe(false);
  });

  it("reset discards learned persistent UI", () => {
    const staticUi = createSignature([2, 3, 4, 5, 10, 11, 12, 13]);
    const warmed = advanceMany(
      createInitialPersistentUiModelState(),
      Array.from({ length: TEST_CONFIG.historySamples }, () => staticUi),
      TEST_CONFIG,
    );

    expect(isPersistentUiDominant(warmed.analysis, TEST_CONFIG)).toBe(true);

    const resetState = createInitialPersistentUiModelState();
    const afterReset = advancePersistentUiModel(
      resetState,
      staticUi,
      TEST_CONFIG,
    );

    expect(afterReset.analysis.historySampleCount).toBe(1);
    expect(afterReset.analysis.isWarmedUp).toBe(false);
    expect(afterReset.analysis.persistentUiOverlapRatio).toBe(0);
    expect(afterReset.analysis.dynamicForegroundRatio).toBe(1);
    expect(isPersistentUiDominant(afterReset.analysis, TEST_CONFIG)).toBe(false);
  });

  it("bounds history and ages cells from older samples out of the model", () => {
    const oldUi = createSignature([2]);
    const currentUi = createSignature([21]);
    const result = advanceMany(
      createInitialPersistentUiModelState(),
      [
        ...Array.from({ length: 64 }, () => oldUi),
        ...Array.from(
          { length: TEST_CONFIG.historySamples },
          () => currentUi,
        ),
      ],
      TEST_CONFIG,
    );

    expect(result.state.occupancyHistory).toHaveLength(
      TEST_CONFIG.historySamples,
    );
    expect(result.state.occupancyHistory.every((grid) => grid[2] === 0)).toBe(
      true,
    );
    expect(result.state.occupancyHistory.every((grid) => grid[21] === 1)).toBe(
      true,
    );
    expect(result.analysis.persistentCells[2]).toBe(0);
    expect(result.analysis.persistentCells[21]).toBe(1);
  });
});
