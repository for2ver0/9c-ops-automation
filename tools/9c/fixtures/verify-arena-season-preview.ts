#!/usr/bin/env bun
/**
 * Regression check for arena-season-preview — runs the CLI against live chain data
 * (needs Mimir + ArenaService reachability) for five preview scenarios plus two
 * date-estimate backtests:
 *
 *   1-2. real-season reproduction (spec §6-4(a)): Odin S39 and Heimdall CS9's actual 9
 *      inputs (fetched live from /seasons id=40 on each network, 2026-08-30) must
 *      reproduce their real recorded end blocks EXACTLY (19412023 / 10892380) and every
 *      invariant must come back OK — these are real, already-registered seasons using
 *      their real production policy ids, so nothing here should ever WARN.
 *   3. control (negative case): a clean, contiguous, correctly-configured HYPOTHETICAL
 *      season -> every invariant must be OK. Included per the same principle as
 *      tools/9c/fixtures/verify-arena-reward-table.ts's mutation-test control case — if
 *      this script only checked that bad inputs trigger WARN, a CLI that WARNs on
 *      everything unconditionally would pass every "positive" case below undetected.
 *   4. synthetic positive case A (spec §6-4): policy id swapped for the wrong arena type
 *      -> must be caught as WARN.
 *   5. synthetic positive case B (spec §6-4): start block moved earlier, creating a gap
 *      with the previous season -> must be caught as WARN.
 *   6-7. date-estimate backtests (see references/date-estimate-backtest.md): --verify-season
 *      on the same two real seasons must reproduce their actual recorded end-block
 *      timestamps and land within the model's own stated margin.
 *
 * exit 0 = all seven checks behaved as expected / 1 = a check didn't fire (or fired) as
 * expected.
 */
import { $ } from "bun";

interface Scenario {
  readonly label: string;
  readonly args: string[];
  /** invariant ids that MUST be present with ok:true */
  readonly expectOk: string[];
  /** invariant ids that MUST be present with ok:false (level WARN) */
  readonly expectWarn: string[];
  /** exact end block the CLI's computed.endBlock must equal, if known independently. */
  readonly expectEndBlock?: number;
}

// Odin season 45 (OFF_SEASON) actually ends at block 20,265,223 (live, confirmed
// 2026-08-30) — these scenarios build on that as "the previous season".
const PREV_SEASON_END = 20_265_223;

const SCENARIOS: Scenario[] = [
  {
    // Real production season, 9 inputs fetched live from odin-arena.9c.gg/seasons id=40
    // (2026-08-30) — real policy ids (4/4), real gap (contiguous with season 39), real
    // Total Prize (400000, matches the SEASON baseline). Nothing here should ever WARN.
    label: "real reproduction: Odin S39 (spec §6-4(a))",
    args: [
      "--network", "odin", "--season-group-id", "39", "--arena-type", "SEASON",
      "--season-start-block", "19260824",
      "--round-interval", "10800", "--round-count", "14",
      "--required-medal-count", "0", "--total-prize", "400000",
      "--battle-policy-id", "4", "--refresh-policy-id", "4",
    ],
    expectOk: ["gap", "round-interval-baseline", "battle-policy-fingerprint", "refresh-policy-fingerprint", "total-prize-baseline"],
    expectWarn: [],
    expectEndBlock: 19_412_023,
  },
  {
    // Real production season, 9 inputs fetched live from heimdall-arena.9c.gg/seasons
    // id=40 (2026-08-30) — real policy ids (6/6), real Total Prize (500000, matches the
    // CHAMPIONSHIP baseline).
    label: "real reproduction: Heimdall CS9 (spec §6-4(a))",
    args: [
      "--network", "heimdall", "--season-group-id", "9", "--arena-type", "CHAMPIONSHIP",
      "--season-start-block", "10741181",
      "--round-interval", "10800", "--round-count", "14",
      "--required-medal-count", "0", "--total-prize", "500000",
      "--battle-policy-id", "6", "--refresh-policy-id", "6",
    ],
    expectOk: ["gap", "round-interval-baseline", "battle-policy-fingerprint", "refresh-policy-fingerprint", "total-prize-baseline"],
    expectWarn: [],
    expectEndBlock: 10_892_380,
  },
  {
    label: "control (clean, contiguous, correct policy+prize)",
    args: [
      "--network", "odin", "--season-group-id", "46", "--arena-type", "SEASON",
      "--season-start-block", String(PREV_SEASON_END + 1),
      "--round-interval", "10800", "--round-count", "14",
      "--required-medal-count", "0", "--total-prize", "400000",
      "--battle-policy-id", "4", "--refresh-policy-id", "4",
    ],
    expectOk: ["gap", "round-interval-baseline", "battle-policy-fingerprint", "refresh-policy-fingerprint", "total-prize-baseline"],
    expectWarn: [],
  },
  {
    label: "synthetic A: policy id swapped for the wrong arena type (spec §6-4)",
    args: [
      // CHAMPIONSHIP season registered with the OFF_SEASON-only policy id (5).
      "--network", "odin", "--season-group-id", "46", "--arena-type", "CHAMPIONSHIP",
      "--season-start-block", String(PREV_SEASON_END + 1),
      "--round-interval", "10800", "--round-count", "14",
      "--required-medal-count", "0", "--total-prize", "500000",
      "--battle-policy-id", "5", "--refresh-policy-id", "5",
    ],
    expectOk: ["gap"],
    expectWarn: ["battle-policy-fingerprint", "refresh-policy-fingerprint"],
  },
  {
    label: "synthetic B: start block moved earlier, creating a gap (spec §6-4)",
    args: [
      // Started 500 blocks before the previous season's end+1 would land — but still
      // after the previous season's own end, so this is a gap-from-elsewhere-in-the-
      // future scenario, not an overlap: push start far enough forward to guarantee no
      // overlap with season 45 while still not being contiguous.
      "--network", "odin", "--season-group-id", "46", "--arena-type", "SEASON",
      "--season-start-block", String(PREV_SEASON_END + 5000),
      "--round-interval", "10800", "--round-count", "14",
      "--required-medal-count", "0", "--total-prize", "400000",
      "--battle-policy-id", "4", "--refresh-policy-id", "4",
    ],
    expectOk: ["round-interval-baseline", "battle-policy-fingerprint", "refresh-policy-fingerprint", "total-prize-baseline"],
    expectWarn: ["gap"],
  },
];

let failed = 0;

for (const scenario of SCENARIOS) {
  const raw = await $`bun run tools/9c/arena-season-preview.ts ${scenario.args} --json`.text();
  const output = JSON.parse(raw) as {
    invariants: Array<{ id: string; ok: boolean; level: string }>;
    computed: { endBlock: number };
  };
  const diffs: string[] = [];

  if (scenario.expectEndBlock !== undefined && output.computed.endBlock !== scenario.expectEndBlock) {
    diffs.push(`endBlock: ${output.computed.endBlock} != ${scenario.expectEndBlock}`);
  }

  for (const id of scenario.expectOk) {
    const inv = output.invariants.find((i) => i.id === id);
    if (!inv) diffs.push(`invariant ${id} 누락`);
    else if (!inv.ok) diffs.push(`invariant ${id}: OK를 기대했는데 ${inv.level}`);
  }
  for (const id of scenario.expectWarn) {
    const inv = output.invariants.find((i) => i.id === id);
    if (!inv) diffs.push(`invariant ${id} 누락`);
    else if (inv.ok || inv.level !== "WARN") diffs.push(`invariant ${id}: WARN을 기대했는데 ok=${inv.ok} level=${inv.level}`);
  }

  if (diffs.length) {
    failed++;
    console.log(`FAIL  ${scenario.label}`);
    diffs.forEach((d) => console.log(`        ${d}`));
  } else {
    console.log(`PASS  ${scenario.label}  (${scenario.expectOk.length} OK + ${scenario.expectWarn.length} WARN checked)`);
  }
}

// --- date-estimate backtests (spec-doc "날짜 정확도" open item, closed 2026-08-30 — see
// references/date-estimate-backtest.md). Anchors the model at each real season's own
// start block and checks the predicted END date against Mimir's actual recorded
// timestamp, matching the domain owner's manual backtest exactly. ---

interface BacktestCase {
  readonly label: string;
  readonly args: string[];
  /** Ground truth from references/date-estimate-backtest.md, ①. */
  readonly expectActualIso: string;
}

const BACKTESTS: BacktestCase[] = [
  {
    label: "backtest: Odin S39 end block",
    args: [
      "--network", "odin", "--season-group-id", "39", "--arena-type", "SEASON",
      "--season-start-block", "19260824", "--round-interval", "10800", "--round-count", "14",
      "--required-medal-count", "0", "--total-prize", "400000",
      "--battle-policy-id", "4", "--refresh-policy-id", "4", "--verify-season",
    ],
    expectActualIso: "2026-08-22T07:13:56.376Z",
  },
  {
    label: "backtest: Heimdall CS9 end block",
    args: [
      "--network", "heimdall", "--season-group-id", "9", "--arena-type", "CHAMPIONSHIP",
      "--season-start-block", "10741181", "--round-interval", "10800", "--round-count", "14",
      "--required-medal-count", "0", "--total-prize", "500000",
      "--battle-policy-id", "6", "--refresh-policy-id", "6", "--verify-season",
    ],
    expectActualIso: "2026-08-21T02:34:00.343Z",
  },
];

for (const bt of BACKTESTS) {
  const raw = await $`bun run tools/9c/arena-season-preview.ts ${bt.args} --json`.text();
  const result = JSON.parse(raw) as { actual: string; residualMinutes: number; withinMargin: boolean };
  const diffs: string[] = [];
  if (result.actual !== bt.expectActualIso) diffs.push(`actual: ${result.actual} != ${bt.expectActualIso}`);
  if (!result.withinMargin) diffs.push(`residual ${result.residualMinutes.toFixed(1)}min exceeded its own margin`);

  if (diffs.length) {
    failed++;
    console.log(`FAIL  ${bt.label}`);
    diffs.forEach((d) => console.log(`        ${d}`));
  } else {
    console.log(`PASS  ${bt.label}  (residual ${result.residualMinutes.toFixed(1)}min, within margin)`);
  }
}

console.log(failed ? `\n${failed} scenario(s) FAILED` : "\nall scenarios behaved as expected");
process.exit(failed ? 1 : 0);
