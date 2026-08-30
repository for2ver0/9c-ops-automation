/**
 * Unit tests for the pure estimation math only (measureBlockTimeModel needs live Mimir
 * access and is exercised manually via tools/9c/arena-season-preview.ts against real
 * chain data instead — see that file's usage notes).
 */
import { describe, expect, test } from "bun:test";
import { estimateBlockForDate, estimateDateForBlock, type BlockTimeModel } from "./arena-block-time";

// A model with a round secPerBlock and zero margin, so the expected outputs are exact
// numbers rather than floating-point-approximate ranges.
const CLEAN_MODEL: BlockTimeModel = {
  tip: { index: 1_000_000, timestamp: new Date("2026-08-30T00:00:00.000Z") },
  windowsSecPerBlock: [{ label: "~1d", blocks: 10_800, secPerBlock: 8 }],
  secPerBlock: 8,
  marginSecPerBlock: 0,
};

describe("estimateDateForBlock", () => {
  test("a block exactly at tip returns tip's own timestamp with zero margin", () => {
    const est = estimateDateForBlock(CLEAN_MODEL, 1_000_000);
    expect(est.estimate.getTime()).toBe(CLEAN_MODEL.tip.timestamp.getTime());
    expect(est.marginMinutes).toBe(0);
  });

  test("a future block (higher index) estimates a later date", () => {
    // 450 blocks * 8 sec/block = 3600 sec = 1 hour later
    const est = estimateDateForBlock(CLEAN_MODEL, 1_000_450);
    expect(est.estimate.toISOString()).toBe("2026-08-30T01:00:00.000Z");
  });

  test("a past block (lower index) estimates an earlier date", () => {
    // 450 blocks earlier = 1 hour earlier
    const est = estimateDateForBlock(CLEAN_MODEL, 999_550);
    expect(est.estimate.toISOString()).toBe("2026-08-29T23:00:00.000Z");
  });

  test("margin scales linearly with block distance, not with direction", () => {
    const model: BlockTimeModel = { ...CLEAN_MODEL, marginSecPerBlock: 0.01 };
    const future = estimateDateForBlock(model, model.tip.index + 6000); // 6000 blocks away
    const past = estimateDateForBlock(model, model.tip.index - 6000); // also 6000 blocks away
    // 6000 blocks * 0.01 sec/block = 60 sec = 1 minute
    expect(future.marginMinutes).toBeCloseTo(1, 6);
    expect(past.marginMinutes).toBeCloseTo(1, 6);
  });
});

describe("estimateBlockForDate", () => {
  test("round-trips with estimateDateForBlock for a clean (zero-margin) model", () => {
    const targetDate = new Date("2026-09-05T12:00:00.000Z"); // 6.5 days after tip
    const blockEst = estimateBlockForDate(CLEAN_MODEL, targetDate);
    const dateEst = estimateDateForBlock(CLEAN_MODEL, blockEst.estimate);
    // Rounding to the nearest whole block introduces at most one block's worth of drift
    // (8 seconds), so allow that much slack rather than demanding an exact match.
    expect(Math.abs(dateEst.estimate.getTime() - targetDate.getTime())).toBeLessThanOrEqual(8000);
  });

  test("a date before the tip estimates a block below tip.index", () => {
    const targetDate = new Date("2026-08-25T00:00:00.000Z"); // 5 days before tip
    const est = estimateBlockForDate(CLEAN_MODEL, targetDate);
    expect(est.estimate).toBeLessThan(CLEAN_MODEL.tip.index);
  });
});
