#!/usr/bin/env bun
/**
 * arena-season-checklist — rolls up the --json output of arena-reward-table /
 * arena-season-preview / arena-announce / arena-settlement-check into one screen, plus a
 * read-only "시즌 캐시" health check (spec §6-4). Pure aggregation ("파생") — this skill
 * does not compute anything the other four don't already compute; it reads files they
 * already produced. See tools/9c/lib/arena-season-checklist.ts for the normalization
 * logic and why arena-settlement-check's section is marked "partial".
 *
 * Each --*-json flag is optional: point it at a file containing that skill's `--json`
 * output (generate it first, e.g. `bun run tools/9c/arena-reward-table.ts ... --json >
 * reward.json`). A skill you don't pass shows as "미실행" rather than blocking the rest —
 * this is meant to be run with whatever's on hand, not as a gate requiring all four.
 *
 * Usage:
 *   bun run tools/9c/arena-season-checklist.ts \
 *     --reward-table-json ./reward.json \
 *     --season-preview-json ./preview.json \
 *     --announce-json ./announce.json \
 *     --settlement-json ./settlement.json \
 *     --check-cache odin,heimdall
 */
import {
  normalizeInvariantsJson,
  normalizeSettlementJson,
  checkSeasonCacheHealth,
  summarizeChecklist,
  type SeasonCacheHealth,
  type SkillSection,
} from "./lib/arena-season-checklist";
import { getNetworkInfo, type ArenaNetwork } from "./lib/arena-network";
import { fetchSeasons } from "./lib/arena-reward-sources";

interface Args {
  rewardTableJson?: string;
  seasonPreviewJson?: string;
  announceJson?: string;
  settlementJson?: string;
  checkCache?: ArenaNetwork[];
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--reward-table-json":
        args.rewardTableJson = next();
        break;
      case "--season-preview-json":
        args.seasonPreviewJson = next();
        break;
      case "--announce-json":
        args.announceJson = next();
        break;
      case "--settlement-json":
        args.settlementJson = next();
        break;
      case "--check-cache":
        args.checkCache = next()
          .split(",")
          .map((s) => s.trim() as ArenaNetwork)
          .filter(Boolean);
        break;
      case "--json":
        args.json = true;
        break;
      default:
        throw new Error(`알 수 없는 옵션: ${a}`);
    }
  }
  return args;
}

async function loadSection(
  label: string,
  path: string | undefined,
  parse: (raw: unknown) => SkillSection,
): Promise<SkillSection> {
  if (!path) return { skill: label, checks: null, partial: false };
  const raw = JSON.parse(await Bun.file(path).text());
  return parse(raw);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const sections = await Promise.all([
    loadSection("arena-reward-table", args.rewardTableJson, (raw) => normalizeInvariantsJson("arena-reward-table", raw)),
    loadSection("arena-season-preview", args.seasonPreviewJson, (raw) => normalizeInvariantsJson("arena-season-preview", raw)),
    loadSection("arena-announce", args.announceJson, (raw) => normalizeInvariantsJson("arena-announce", raw)),
    loadSection("arena-settlement-check", args.settlementJson, (raw) => normalizeSettlementJson(raw)),
  ]);

  const seasonCache: Record<string, SeasonCacheHealth> = {};
  for (const network of args.checkCache ?? []) {
    const info = getNetworkInfo(network);
    if (!info.arenaServiceHost) {
      seasonCache[network] = { ok: false, level: "WARN", detail: "이 네트워크는 아레나 엔드포인트가 없습니다." };
      continue;
    }
    const seasons = await fetchSeasons(info.arenaServiceHost);
    const latestStart = Math.max(...seasons.map((s) => s.startBlock));
    seasonCache[network] = await checkSeasonCacheHealth(info.arenaServiceHost, latestStart);
  }

  const summary = summarizeChecklist(sections, seasonCache);

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printHumanReadable(summary);
  }

  process.exit(summary.overallLevel === "FATAL" ? 1 : 0);
}

function printHumanReadable(summary: ReturnType<typeof summarizeChecklist>) {
  console.log(`전체 상태: ${summary.overallLevel}\n`);

  for (const section of summary.sections) {
    const partialTag = section.partial ? " (부분 구현 — arena-settlement-check SKILL.md 참고)" : "";
    console.log(`## ${section.skill}${partialTag}`);
    if (section.checks === null) {
      console.log("  미실행 (--*-json 안 줌)\n");
      continue;
    }
    if (section.checks.length === 0) {
      console.log("  (항목 없음)\n");
      continue;
    }
    for (const c of section.checks) {
      const mark = c.ok ? "OK   " : c.level === "FATAL" ? "FATAL" : "WARN ";
      console.log(`  [${mark}] ${c.name} — ${c.detail}`);
    }
    console.log("");
  }

  if (Object.keys(summary.seasonCache).length > 0) {
    console.log("## 시즌 캐시 읽기 점검");
    for (const [network, health] of Object.entries(summary.seasonCache)) {
      const mark = health.ok ? "OK   " : health.level === "FATAL" ? "FATAL" : "WARN ";
      console.log(`  [${mark}] ${network} — ${health.detail}`);
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
