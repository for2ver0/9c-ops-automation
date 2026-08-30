#!/usr/bin/env bun
/**
 * Golden fixture regression test — runs the actual CLI binary (not just the internal
 * calc library, which has its own unit test at tools/9c/lib/arena-reward-calc.test.ts)
 * against Odin S39 / Heimdall CS9 and diffs against arena-reward-table.golden.json.
 *
 * This layer exists because bugs can live in the CLI's wiring (arg parsing, JSON field
 * mapping between the live API and the internal types) even when the pure calculation
 * library is fully correct — that's exactly the class of bug this caught during
 * development (SeasonMeta was reading `startBlock`/`endBlock` when the live /seasons
 * response actually uses `startBlockIndex`/`endBlockIndex`).
 *
 *   bun run tools/9c/fixtures/verify-arena-reward-table.ts          # table-only, offline
 *   bun run tools/9c/fixtures/verify-arena-reward-table.ts --live   # also hits live APIs
 *
 * exit 0 = all fixtures match / 1 = mismatch.
 */
import { $ } from "bun";
import golden from "./arena-reward-table.golden.json";

const live = process.argv.includes("--live");
const PAID_KEYS = [
  ["basic", "basicReward"],
  ["staking2", "staking2Reward"],
  ["staking3", "staking3Reward"],
  ["couragePass", "couragePassReward"],
  ["couragePassStaking2", "couragePassAndStaking2Reward"],
  ["couragePassStaking3", "couragePassAndStaking3Reward"],
] as const;

let failed = 0;

for (const fx of golden.fixtures) {
  const cfg = fx.inputs.config;
  const args = [
    "run",
    "tools/9c/arena-reward-table.ts",
    "--json",
    "--pool",
    String(cfg.rankingPool),
    "--percentages",
    cfg.percentages.join(","),
    "--players",
    cfg.players.join(","),
    "--staking-lv2",
    String(cfg.stakingLv2Multiplier),
    "--staking-lv3",
    String(cfg.stakingLv3Multiplier),
    "--courage-pass",
    String(cfg.couragePassMultiplier),
  ];
  if (live) {
    args.push(
      "--network",
      fx.inputs.network,
      "--season-type",
      fx.inputs.seasonType,
      "--season-group-id",
      String(fx.inputs.seasonNumber),
    );
  } else {
    args.push("--table-only");
  }

  const raw = await $`bun ${args}`.text();
  const actual = JSON.parse(raw);
  const diffs: string[] = [];

  fx.expected.groups.forEach((exp, i) => {
    const group = actual.groups[i];
    const tier = actual.tiers[i];
    if (!tier) return void diffs.push(`${exp.rankGroup}: tier 누락`);
    if (group.rankGroup !== exp.rankGroup) diffs.push(`group[${i}]: ${group.rankGroup} != ${exp.rankGroup}`);
    if (group.groupReward !== exp.groupReward)
      diffs.push(`${exp.rankGroup}.groupReward: ${group.groupReward} != ${exp.groupReward}`);
    for (const [paidKey, tierKey] of PAID_KEYS) {
      const got = tierKey === "basicReward" ? tier.basicReward : tier.basicReward + tier[tierKey];
      const want = (exp.paid as Record<string, number>)[paidKey];
      if (got !== want) diffs.push(`${exp.rankGroup}.${paidKey}: ${got} != ${want}`);
    }
  });

  for (const inv of fx.expected.invariants) {
    const got = (actual.invariants as Array<{ id: string; ok: boolean }>).find((x) => x.id === inv.id);
    if (!got) diffs.push(`invariant ${inv.id} 누락`);
    else if (got.ok !== inv.ok) diffs.push(`invariant ${inv.id}: ok=${got.ok} != ${inv.ok}`);
  }

  if (live) {
    if (actual.season?.startBlock !== fx.inputs.season.startBlock)
      diffs.push(`season.startBlock: ${actual.season?.startBlock} != ${fx.inputs.season.startBlock}`);
    if (actual.season?.endBlock !== fx.inputs.season.endBlock)
      diffs.push(`season.endBlock: ${actual.season?.endBlock} != ${fx.inputs.season.endBlock}`);
    const participantCount = (actual.results as unknown[] | null)?.length ?? 0;
    if (participantCount !== fx.inputs.ranking.totalParticipants)
      diffs.push(`participants: ${participantCount} != ${fx.inputs.ranking.totalParticipants}`);
  }

  if (diffs.length) {
    failed++;
    console.log(`FAIL  ${fx.label}`);
    diffs.forEach((d) => console.log(`        ${d}`));
  } else {
    console.log(
      `PASS  ${fx.label}  (${fx.expected.groups.length} groups x ${PAID_KEYS.length} cells + ${fx.expected.invariants.length} invariants${live ? " + live season/participant check" : ""})`,
    );
  }
}

console.log(failed ? `\n${failed} case(s) FAILED` : "\nall fixtures match");
process.exit(failed ? 1 : 0);
