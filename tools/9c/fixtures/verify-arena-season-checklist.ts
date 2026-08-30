#!/usr/bin/env bun
/**
 * Regression check for arena-season-checklist — generates real --json output from all
 * four sibling skills (known-good inputs, same ones used in their own fixtures) into temp
 * files, then confirms the checklist aggregates them correctly: every section present,
 * every section OK (since the inputs are all known-clean), and the season-cache check
 * runs without crashing (its result is live/variable so this only checks it produced
 * *a* result, not a specific level — the cache-lag WARN has been observed persisting for
 * this entire session, so asserting OK here would make this script flaky by design).
 */
import { $ } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let failed = 0;
const dir = await mkdtemp(join(tmpdir(), "arena-season-checklist-verify-"));

try {
  const rewardJson = join(dir, "reward.json");
  const previewJson = join(dir, "preview.json");
  const announceJson = join(dir, "announce.json");
  const settlementJson = join(dir, "settlement.json");

  await $`bun run tools/9c/arena-reward-table.ts --table-only --json --pool 400000 --percentages 7,8,7,9,12,18,18,12,6,3 --players 2,3,4,6,10,25,37,38,125,250 --staking-lv2 0.5 --staking-lv3 1.0 --courage-pass 1.0`.text().then((t) => Bun.write(rewardJson, t));

  await $`bun run tools/9c/arena-season-preview.ts --network odin --season-group-id 39 --arena-type SEASON --season-start-block 19260824 --round-interval 10800 --round-count 14 --required-medal-count 0 --total-prize 400000 --battle-policy-id 4 --refresh-policy-id 4 --json`.text().then((t) => Bun.write(previewJson, t));

  await $`bun run tools/9c/arena-announce.ts --odin-season-group-id 38 --odin-arena-type SEASON --heimdall-season-group-id 22 --heimdall-arena-type SEASON --json`.text().then((t) => Bun.write(announceJson, t));

  await $`bun run tools/9c/arena-settlement-check.ts --network odin --tx 0f2623c4002567fda88d70798863b737b9c3ecfd789894033f35ad3887f507fe --json`.text().then((t) => Bun.write(settlementJson, t));

  const raw = await $`bun run tools/9c/arena-season-checklist.ts --reward-table-json ${rewardJson} --season-preview-json ${previewJson} --announce-json ${announceJson} --settlement-json ${settlementJson} --check-cache odin --json`.text();
  const summary = JSON.parse(raw) as {
    overallLevel: string;
    sections: Array<{ skill: string; checks: unknown[] | null; partial: boolean }>;
    seasonCache: Record<string, { ok: boolean; level: string }>;
  };

  const expectedSkills = ["arena-reward-table", "arena-season-preview", "arena-announce", "arena-settlement-check"];
  for (const skill of expectedSkills) {
    const section = summary.sections.find((s) => s.skill === skill);
    if (!section) {
      failed++;
      console.log(`FAIL  section missing: ${skill}`);
      continue;
    }
    if (section.checks === null) {
      failed++;
      console.log(`FAIL  ${skill}: checks is null (should have loaded from file)`);
      continue;
    }
    const badLevels = (section.checks as Array<{ level: string }>).filter((c) => c.level !== "OK");
    if (badLevels.length > 0) {
      failed++;
      console.log(`FAIL  ${skill}: expected all-OK for known-clean inputs, got ${JSON.stringify(badLevels)}`);
      continue;
    }
    console.log(`PASS  ${skill}: ${section.checks.length} checks, all OK${section.partial ? " (partial, as expected for arena-settlement-check)" : ""}`);
  }

  if (!("odin" in summary.seasonCache)) {
    failed++;
    console.log("FAIL  season cache check for odin did not run");
  } else {
    console.log(`PASS  season cache check ran (odin: ${summary.seasonCache.odin.level} — not asserting a specific level, see module doc comment)`);
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} case(s) FAILED` : "\nall cases match");
process.exit(failed ? 1 : 0);
