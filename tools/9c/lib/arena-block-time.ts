/**
 * Shared block <-> calendar-time conversion module.
 *
 * Spec doc §6-3 requires this be a SINGLE shared module (not reimplemented per skill),
 * because skills 1/2/3 all need block<->time and re-deriving it three times risks the
 * three copies drifting on what "current block time" means.
 *
 * Data source: Mimir GraphQL only — `blocks(take: 1)` for the current tip and
 * `block(index: Long!)` for historical samples. Two things ruled out headless RPC:
 *  - `ExplorerQuery.blockQuery` (the block-by-index path) exists in the shared GraphQL
 *    schema but is NOT wired to this deployment's query root (introspection confirms
 *    nothing exposes `ExplorerQuery` from the reachable root type) — confirmed 2026-08-30.
 *  - Mimir's indexer lags the headless RPC's `nodeStatus.tip.index` by a handful of
 *    seconds. Feeding a headless-reported tip straight into Mimir's `block(index:)` hit
 *    "Document not found in MongoDB collection" in a live race during development.
 *    Asking Mimir for its own most-recent block instead sidesteps the race and means this
 *    module has exactly one upstream dependency.
 *
 * Margin design (§6-3): "환산 결과는 오차 마진을 항상 동반하며, 마진은 블록 거리에
 * 비례해 커진다... 날짜를 분 단위로 단정하지 않는다." This measures average seconds/block
 * over three windows (~1d/~7d/~30d back from tip) and uses the spread between them as a
 * per-block uncertainty, which is then scaled by the actual block distance being converted.
 * This is NOT a claim of statistical rigor — it is the cheapest signal available (three
 * point samples) that still catches the real failure mode: block time drifting between a
 * quiet period and a busy one. If a future measurement shows the windows agree tightly,
 * the margin naturally shrinks; if they disagree, it grows.
 *
 * Empirical validation (domain owner, 2026-08-30 — see
 * .claude/skills/arena-season-preview/references/date-estimate-backtest.md): backtesting
 * this exact style of trailing-window rate + linear extrapolation against Mimir's actual
 * recorded block timestamps (which ARE the ground truth — no external record needed) found
 * residuals up to ~14 minutes over a 14-18 day horizon at a 100k-block window, ~11 minutes
 * at 50k. This session's own margin numbers for the same two seasons (tens of minutes) were
 * independently in the right range before that backtest existed. Two things NOT to do,
 * confirmed by the same backtest:
 *  - Never substitute a nominal "8 sec/block" for a measured rate. Real rates diverge by
 *    network (Odin ~7.962 s/block, Heimdall ~8.013 s/block) enough that a nominal fallback
 *    would misdate a full season by 90-120 minutes on Odin and ~35 minutes on Heimdall —
 *    an order of magnitude worse than the measured approach's error. This module has no
 *    such fallback and must not grow one silently.
 *  - Don't assume a bigger window is always better — Heimdall's rate is noisier than
 *    Odin's, so very large windows can average over real rate drift rather than reducing
 *    noise. 50k blocks was the reported sweet spot common to both networks.
 */

export interface BlockTimeSample {
  readonly index: number;
  readonly timestamp: Date;
}

/** Exported (not just internal to fetchTip's window sampling) so callers — namely
 *  backtestSeasonDates below — can fetch the ACTUAL recorded timestamp of a specific
 *  block for comparison against an estimate. This value is not itself an estimate; it's
 *  what actually got written on-chain, which is exactly the "ground truth" a date
 *  estimate needs to be checked against (domain owner's insight, 2026-08-30 — no
 *  external record was ever necessary, Mimir already has it). */
export async function fetchBlockTimestampAt(mimirHost: string, index: number): Promise<BlockTimeSample> {
  return fetchBlockTimestamp(mimirHost, index);
}

async function fetchBlockTimestamp(mimirHost: string, index: number): Promise<BlockTimeSample> {
  const res = await fetch(mimirHost, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: `{ block(index: ${index}) { object { index timestamp } } }` }),
  });
  if (!res.ok) throw new Error(`Mimir block(index: ${index}) -> HTTP ${res.status}`);
  const body = (await res.json()) as {
    data?: { block?: { object: { index: number; timestamp: string } } };
    errors?: Array<{ message: string }>;
  };
  if (body.errors?.length) throw new Error(`Mimir block(index: ${index}) error: ${body.errors[0].message}`);
  if (!body.data?.block) throw new Error(`Mimir block(index: ${index}) -> no such block`);
  return { index: body.data.block.object.index, timestamp: new Date(body.data.block.object.timestamp) };
}

/** Deliberately does NOT use the headless RPC's `nodeStatus.tip.index` as the reference
 *  point. Confirmed 2026-08-30: Mimir's indexer lags the headless tip by a handful of
 *  seconds, so a headless tip fed straight into a Mimir `block(index:)` lookup can hit
 *  "Document not found in MongoDB collection" in a race. Mimir's own `blocks(take: 1)`
 *  (most-recent-first, no explicit order arg needed — confirmed by observation) sidesteps
 *  the race entirely and also means this module only needs one upstream (Mimir), not two. */
async function fetchTip(mimirHost: string): Promise<BlockTimeSample> {
  const res = await fetch(mimirHost, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "{ blocks(take: 1) { items { object { index timestamp } } } }" }),
  });
  if (!res.ok) throw new Error(`Mimir blocks(take: 1) -> HTTP ${res.status}`);
  const body = (await res.json()) as {
    data?: { blocks?: { items: Array<{ object: { index: number; timestamp: string } }> } };
    errors?: Array<{ message: string }>;
  };
  if (body.errors?.length) throw new Error(`Mimir blocks(take: 1) error: ${body.errors[0].message}`);
  const item = body.data?.blocks?.items?.[0];
  if (!item) throw new Error("Mimir blocks(take: 1) -> empty result");
  return { index: item.object.index, timestamp: new Date(item.object.timestamp) };
}

export interface BlockTimeModel {
  readonly tip: BlockTimeSample;
  /** Seconds per block, measured independently over ~1d/~7d/~30d windows back from tip. */
  readonly windowsSecPerBlock: { readonly label: string; readonly blocks: number; readonly secPerBlock: number }[];
  /** Best estimate: the longest (30d) window's rate, since it averages over the most blocks. */
  readonly secPerBlock: number;
  /** Per-block uncertainty = max spread between window estimates. Scales linearly with the
   *  distance being converted — see estimateDateForBlock. */
  readonly marginSecPerBlock: number;
}

const WINDOWS = [
  { label: "~1d", blocks: 10_800 },
  { label: "~7d", blocks: 75_600 },
  { label: "~30d", blocks: 324_000 },
] as const;

/** Measures a block-time model. Do this once per run and reuse the result — it's 4 Mimir
 *  round-trips (anchor + 3 historical samples).
 *
 *  @param anchorIndex Normally omitted, which anchors the model at the LIVE tip (via
 *    `blocks(take: 1)`) for normal "what date is this future/past block" use. Pass an
 *    explicit block index to instead anchor the model there — this is what makes
 *    backtestSeasonDates possible: build the model as if run at some point in the past
 *    (using only data available up to that point), then extrapolate forward and compare
 *    to what actually happened, which is a fair test precisely because the target block's
 *    own data never entered the model. */
export async function measureBlockTimeModel(mimirHost: string, anchorIndex?: number): Promise<BlockTimeModel> {
  const tip = anchorIndex === undefined ? await fetchTip(mimirHost) : await fetchBlockTimestamp(mimirHost, anchorIndex);

  const windowsSecPerBlock: BlockTimeModel["windowsSecPerBlock"] = [];
  for (const w of WINDOWS) {
    if (w.blocks >= tip.index) continue; // chain not old enough for this window yet
    const past = await fetchBlockTimestamp(mimirHost, tip.index - w.blocks);
    const secPerBlock = (tip.timestamp.getTime() - past.timestamp.getTime()) / 1000 / w.blocks;
    windowsSecPerBlock.push({ label: w.label, blocks: w.blocks, secPerBlock });
  }
  if (windowsSecPerBlock.length === 0) {
    throw new Error("체인이 모든 측정 구간(최소 1일치 블록)보다 짧습니다 — 블록타임을 측정할 수 없습니다.");
  }

  const longest = windowsSecPerBlock[windowsSecPerBlock.length - 1];
  const rates = windowsSecPerBlock.map((w) => w.secPerBlock);
  const marginSecPerBlock = Math.max(...rates) - Math.min(...rates);

  return { tip, windowsSecPerBlock, secPerBlock: longest.secPerBlock, marginSecPerBlock };
}

export interface DateEstimate {
  readonly estimate: Date;
  /** +/- margin in minutes, scaled by distance from tip — see module doc comment. */
  readonly marginMinutes: number;
}

/** Block -> estimated calendar date, with margin. §6-3: "마진이 임계(예: ±1시간)를 넘으면
 *  리포트에 함께 표기한다" — callers should check marginMinutes and flag loudly past ~60. */
export function estimateDateForBlock(model: BlockTimeModel, targetBlock: number): DateEstimate {
  const blockDistance = targetBlock - model.tip.index;
  const estimate = new Date(model.tip.timestamp.getTime() + blockDistance * model.secPerBlock * 1000);
  const marginMinutes = (Math.abs(blockDistance) * model.marginSecPerBlock) / 60;
  return { estimate, marginMinutes };
}

export interface BlockEstimate {
  readonly estimate: number;
  readonly marginBlocks: number;
}

/** Date -> estimated block index (보조 모드, §5-1 항목 2 — only needed when opening a
 *  season with a gap or otherwise not immediately after the previous one's end block). */
export function estimateBlockForDate(model: BlockTimeModel, targetDate: Date): BlockEstimate {
  const secondsDistance = (targetDate.getTime() - model.tip.timestamp.getTime()) / 1000;
  const blockDistance = secondsDistance / model.secPerBlock;
  const estimate = Math.round(model.tip.index + blockDistance);
  const marginBlocks = Math.abs(blockDistance) * (model.marginSecPerBlock / model.secPerBlock);
  return { estimate, marginBlocks };
}

export interface BacktestResult {
  readonly anchorBlock: number;
  readonly targetBlock: number;
  readonly predicted: Date;
  readonly marginMinutes: number;
  readonly actual: Date;
  /** predicted - actual, in minutes. Positive = predicted too late, negative = too early. */
  readonly residualMinutes: number;
  readonly withinMargin: boolean;
}

/** Anchors a model at `anchorBlock` (using only data available at that point — the
 *  model never sees `targetBlock`'s own timestamp), extrapolates forward to predict
 *  `targetBlock`'s date, then fetches that block's ACTUAL recorded timestamp and reports
 *  the residual. This is the tool-level version of the manual backtest the domain owner
 *  ran (2026-08-30) to validate the estimator against real seasons — see
 *  tools/9c/arena-season-preview.ts's `--verify-season` flag for the CLI surface. */
export async function backtestSeasonDates(
  mimirHost: string,
  anchorBlock: number,
  targetBlock: number,
): Promise<BacktestResult> {
  const model = await measureBlockTimeModel(mimirHost, anchorBlock);
  const { estimate: predicted, marginMinutes } = estimateDateForBlock(model, targetBlock);
  const actualSample = await fetchBlockTimestampAt(mimirHost, targetBlock);
  const residualMinutes = (predicted.getTime() - actualSample.timestamp.getTime()) / 1000 / 60;
  return {
    anchorBlock,
    targetBlock,
    predicted,
    marginMinutes,
    actual: actualSample.timestamp,
    residualMinutes,
    withinMargin: Math.abs(residualMinutes) <= marginMinutes,
  };
}
