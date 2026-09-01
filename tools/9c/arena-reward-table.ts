#!/usr/bin/env bun
/**
 * arena-reward-table — compute an arena season's reward table (and, given ranking data,
 * the actual per-player payout) with invariant checks the backend does not run itself.
 *
 * Usage (table-only — no live ranking/staking/courage-pass needed):
 *   bun run tools/9c/arena-reward-table.ts --table-only --json \
 *     --pool 400000 --percentages 7,8,7,9,12,18,18,12,6,3 --players 2,3,4,6,10,25,37,38,125,250 \
 *     --staking-lv2 0.5 --staking-lv3 1.0 --courage-pass 1.0
 *
 * Usage (full — live ranking + staking via API, courage pass via CSV since the API needs a
 * JWT secret this environment doesn't have):
 *   bun run tools/9c/arena-reward-table.ts --network odin --season-type SEASON --season-group-id 39 \
 *     --pool 400000 --percentages 7,8,7,9,12,18,18,12,6,3 --players 2,3,4,6,10,25,37,38,125,250 \
 *     --staking-lv2 0.5 --staking-lv3 1.0 --courage-pass 1.2 \
 *     --courage-pass-csv ./courage-pass.csv
 *
 * Config (--pool/--percentages/--players/--staking-lv2/--staking-lv3/--courage-pass) is
 * ALWAYS required explicitly — this tool never silently substitutes ArenaRewardModels.cs's
 * CreateDefault() values. That default's couragePassMultiplier=1.0 is a form-prefill, not an
 * operational baseline (spec doc §5, §8-1 decision "도구 기본값 정책"), and RankingPool/
 * percentages/player-counts are things the operator adjusts per season — quietly reusing last
 * season's numbers would be a silent, dangerous default. Missing config aborts with a clear
 * list of what's missing, and every run's console/JSON output echoes the config it actually
 * used so a reviewer can see at a glance whether it matches this season's intent.
 */
import {
  calculateRewards,
  checkInvariants,
  convertTierGroupsToRewardTiers,
  generateTierGroups,
  getStakingLevel,
  type CouragePassEntry,
  type RankingEntry,
  type RewardConfig,
  type StakeEntry,
} from "./lib/arena-reward-calc";
import {
  fetchCompletedLeaderboard,
  fetchGarageStaking,
  fetchSeasons,
  parseCouragePassCsv,
  parseRankingCsv,
  parseStakingCsv,
  resolveSeasonId,
} from "./lib/arena-reward-sources";
import { getNetworkInfo, requireArenaServiceHost, requireMimirHost, type ArenaNetwork } from "./lib/arena-network";
import { buildChampionshipTicketLines, buildSeasonTicketLines, renderRewardTablePng } from "./lib/arena-reward-png";
import { estimateDateForBlock, measureBlockTimeModel } from "./lib/arena-block-time";

interface Args {
  network?: ArenaNetwork;
  seasonType?: string;
  seasonGroupId?: number;
  tableOnly: boolean;
  json: boolean;
  pool?: number;
  percentages?: number[];
  players?: number[];
  stakingLv2?: number;
  stakingLv3?: number;
  couragePass?: number;
  rankingCsv?: string;
  stakingCsv?: string;
  couragePassCsv?: string;
  configFile?: string;
  pngPath?: string;
  ticketTotal?: number;
  ticketSession?: number;
  requiredMedalCount?: number;
  roundCount?: number;
  roundInterval?: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { tableOnly: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--network":
        args.network = next() as ArenaNetwork;
        break;
      case "--season-type":
        args.seasonType = next();
        break;
      case "--season-group-id":
        args.seasonGroupId = Number(next());
        break;
      case "--table-only":
        args.tableOnly = true;
        break;
      case "--json":
        args.json = true;
        break;
      case "--pool":
        args.pool = Number(next());
        break;
      case "--percentages":
        args.percentages = next().split(",").map(Number);
        break;
      case "--players":
        args.players = next().split(",").map(Number);
        break;
      case "--staking-lv2":
        args.stakingLv2 = Number(next());
        break;
      case "--staking-lv3":
        args.stakingLv3 = Number(next());
        break;
      case "--courage-pass":
        args.couragePass = Number(next());
        break;
      case "--ranking-csv":
        args.rankingCsv = next();
        break;
      case "--staking-csv":
        args.stakingCsv = next();
        break;
      case "--courage-pass-csv":
        args.couragePassCsv = next();
        break;
      case "--config":
        args.configFile = next();
        break;
      case "--png":
        args.pngPath = next();
        break;
      case "--ticket-total":
        args.ticketTotal = Number(next());
        break;
      case "--ticket-session":
        args.ticketSession = Number(next());
        break;
      case "--required-medal-count":
        args.requiredMedalCount = Number(next());
        break;
      case "--round-count":
        args.roundCount = Number(next());
        break;
      case "--round-interval":
        args.roundInterval = Number(next());
        break;
      default:
        throw new Error(`알 수 없는 옵션: ${a}`);
    }
  }
  return args;
}

interface ConfigFile {
  pool: number;
  percentages: number[];
  players: number[];
  stakingLv2: number;
  stakingLv3: number;
  couragePass: number;
}

async function resolveConfig(args: Args): Promise<RewardConfig> {
  let file: Partial<ConfigFile> = {};
  if (args.configFile) {
    file = JSON.parse(await Bun.file(args.configFile).text());
  }

  const pool = args.pool ?? file.pool;
  const percentages = args.percentages ?? file.percentages;
  const players = args.players ?? file.players;
  const stakingLv2 = args.stakingLv2 ?? file.stakingLv2;
  const stakingLv3 = args.stakingLv3 ?? file.stakingLv3;
  const couragePass = args.couragePass ?? file.couragePass;

  const missing: string[] = [];
  if (pool === undefined) missing.push("--pool");
  if (percentages === undefined) missing.push("--percentages");
  if (players === undefined) missing.push("--players");
  if (stakingLv2 === undefined) missing.push("--staking-lv2");
  if (stakingLv3 === undefined) missing.push("--staking-lv3");
  if (couragePass === undefined) missing.push("--courage-pass");
  if (missing.length > 0) {
    throw new Error(
      `다음 값을 명시적으로 입력해야 합니다 (누락 시 중단 — §8-1 "도구 기본값 정책"): ${missing.join(", ")}\n` +
        `조용히 코드 기본값(CreateDefault())으로 채우지 않습니다. 지난 시즌 값을 그대로 쓰려는 경우에도 ` +
        `매번 명시적으로 입력해야 실수로 옛 값이 재사용되는 걸 막을 수 있습니다.`,
    );
  }
  if (percentages!.length !== players!.length) {
    throw new Error(
      `--percentages(${percentages!.length}개)와 --players(${players!.length}개)의 그룹 수가 다릅니다.`,
    );
  }

  return {
    rankingPool: pool!,
    stakingLv2Multiplier: stakingLv2!,
    stakingLv3Multiplier: stakingLv3!,
    couragePassMultiplier: couragePass!,
    groupDefinitions: players!.map((playerCount, i) => ({
      playerCount,
      rewardPercentage: percentages![i],
    })),
  };
}

async function loadRanking(args: Args, network?: ArenaNetwork, seasonId?: number): Promise<RankingEntry[]> {
  if (args.rankingCsv) return parseRankingCsv(await Bun.file(args.rankingCsv).text());
  if (!network || seasonId === undefined) {
    throw new Error("랭킹 데이터가 없습니다: --ranking-csv를 주거나 --network/--season-type/--season-group-id로 라이브 조회하세요.");
  }
  const host = requireArenaServiceHost(network);
  const { leaderboard } = await fetchCompletedLeaderboard(host, seasonId);
  return leaderboard;
}

async function loadStaking(args: Args, network?: ArenaNetwork, seasonId?: number): Promise<StakeEntry[]> {
  if (args.stakingCsv) return parseStakingCsv(await Bun.file(args.stakingCsv).text());
  if (!network || seasonId === undefined) {
    throw new Error("스테이킹 데이터가 없습니다: --staking-csv를 주거나 --network로 garage 스냅샷을 조회하세요.");
  }
  const info = getNetworkInfo(network);
  return fetchGarageStaking(info.garagePlanetName, seasonId);
}

async function loadCouragePass(args: Args): Promise<CouragePassEntry[]> {
  if (args.couragePassCsv) return parseCouragePassCsv(await Bun.file(args.couragePassCsv).text());
  // No live path yet — the SeasonPass admin API needs a JWT secret this environment lacks.
  // Treat "no data" as zero premium users rather than aborting, but say so loudly: silently
  // proceeding with an empty courage-pass set would understate every affected player's payout.
  console.error(
    "⚠️  용기패스 데이터 없음 (--courage-pass-csv 미지정, API는 JWT 시크릿 미보유로 사용 불가). " +
      "전원 용기패스 미보유로 계산합니다 — 실제로 패스를 가진 유저가 있다면 그만큼 과소지급으로 계산됩니다.",
  );
  return [];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await resolveConfig(args);
  const groups = generateTierGroups(config);
  const tiers = convertTierGroupsToRewardTiers(groups, config);
  const invariants = checkInvariants(config, groups);

  let title = "Arena Rewards";
  let seasonMeta: { id: number; startBlock: number; endBlock: number; totalPrize: number } | null = null;

  if (args.network && args.seasonType && args.seasonGroupId !== undefined) {
    const resolved = await resolveSeasonId(args.network, args.seasonType, args.seasonGroupId);
    seasonMeta = resolved;
    const netLabel = args.network[0].toUpperCase() + args.network.slice(1);
    const word = args.seasonType === "CHAMPIONSHIP" ? "Championship" : "Season";
    title = `[ ${netLabel} ] Arena ${word} ${args.seasonGroupId} Rewards`;
  }

  // Cross-check Total Prize vs RankingPool as a WARN, per spec doc §6-2 — these are NOT
  // code-linked (confirmed: Season.cs / ArenaServiceModels.cs have no reference to
  // RankingPool), so a mismatch is not necessarily wrong, just worth a human's attention.
  if (seasonMeta && seasonMeta.totalPrize !== config.rankingPool) {
    invariants.push({
      id: "total-prize-vs-ranking-pool",
      name: "Season.TotalPrize == RankingPool (운영 관례, 코드 연결 없음)",
      ok: false,
      detail: `TotalPrize ${seasonMeta.totalPrize} vs RankingPool ${config.rankingPool} — 코드상 연결 없는 운영 관례이므로 다른 것 자체는 정상 범위일 수 있음. 담당자 확인 필요.`,
      level: "WARN",
    });
  }

  let results: ReturnType<typeof calculateRewards> | null = null;
  let stakingMatchFailures: { agentAddress: string; reason: string }[] = [];
  let couragePassCount = 0;

  if (!args.tableOnly) {
    const rankings = await loadRanking(args, args.network, seasonMeta?.id);
    const stakings = await loadStaking(args, args.network, seasonMeta?.id);
    const couragePasses = await loadCouragePass(args);
    couragePassCount = couragePasses.length;

    results = calculateRewards(tiers, rankings, stakings, couragePasses);

    // Matching-failure report split by key axis (spec doc §6-1: agent vs avatar are
    // genuinely different address spaces, must not be merged into one failure list).
    const rankingAgents = new Set(rankings.map((r) => r.agentAddress.toLowerCase()));
    for (const s of stakings) {
      if (!rankingAgents.has(s.agentAddress.toLowerCase())) {
        stakingMatchFailures.push({ agentAddress: s.agentAddress, reason: "이 agentAddress로 랭킹에 매칭되는 유저 없음" });
      }
    }

    if (results.skippedRanks.length > 0) {
      invariants.push({
        id: "skipped-ranks",
        name: "테이블 범위를 벗어나 스킵된 랭크 없음",
        ok: false,
        detail: `${results.skippedRanks.length}명 스킵됨 (rank: ${results.skippedRanks.slice(0, 20).join(", ")}${results.skippedRanks.length > 20 ? " ..." : ""})`,
        level: "WARN",
      });
    }
    if (stakingMatchFailures.length > 0) {
      invariants.push({
        id: "staking-match-failures",
        name: "스테이킹 정보가 있는데 랭킹에 없는 agentAddress 없음",
        ok: false,
        detail: `${stakingMatchFailures.length}건`,
        level: "WARN",
      });
    }
    // Premium-user API pagination cap (spec doc §6-1 "실제 위험 1순위"): 100-user page with
    // no pagination in the real backend means premium users beyond #100 are silently
    // dropped. This tool doesn't call that API yet (JWT), but flag the count regardless so
    // a CSV that happens to have exactly 100 rows gets a second look.
    if (couragePassCount >= 100) {
      invariants.push({
        id: "courage-pass-premium-100",
        name: "용기패스 프리미엄 유저 100명 이상 (백엔드 API는 100명 상한+페이지네이션 없음)",
        ok: false,
        detail: `${couragePassCount}명 — 100명 근처거나 초과라면 실제 인원이 더 많을 수 있음`,
        level: "WARN",
      });
    }
  }

  const fatal = invariants.filter((i) => i.level === "FATAL" && !i.ok);

  const output = {
    title,
    config,
    season: seasonMeta,
    groups,
    tiers,
    invariants,
    results: results?.results ?? null,
    skippedRanks: results?.skippedRanks ?? [],
    stakingMatchFailures,
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    printHumanReadable(output);
  }

  if (args.pngPath) {
    // Date estimates are best-effort: only possible when we know which network this is
    // (so we know which Mimir to ask) and only worth the extra round-trip when a PNG is
    // actually being produced. A measurement failure here shouldn't block the PNG itself
    // — falls back to block-numbers-only, same as before arena-block-time.ts existed.
    let dates: Parameters<typeof renderRewardTablePng>[0]["dates"] = null;
    if (args.network && seasonMeta) {
      try {
        const model = await measureBlockTimeModel(requireMimirHost(args.network));
        const start = estimateDateForBlock(model, seasonMeta.startBlock);
        const end = estimateDateForBlock(model, seasonMeta.endBlock);
        dates = { start: start.estimate, startMarginMinutes: start.marginMinutes, end: end.estimate, endMarginMinutes: end.marginMinutes };
      } catch (e) {
        console.error(`날짜 추정 실패, 블록 번호만 표시: ${e instanceof Error ? e.message : e}`);
      }
    }

    // These "Ticket Information" numbers are never invented here — only rendered when the
    // operator passed them explicitly, same "no silent defaults" rule as the reward config
    // itself. Both the wording AND the required inputs differ by season type: SEASON needs
    // --ticket-total/--ticket-session (ticket purchase limits). CHAMPIONSHIP needs
    // --required-medal-count/--round-count/--round-interval instead — confirmed against a
    // real screenshot (2026-09-01) that this section isn't about ticket purchases at all for
    // CHAMPIONSHIP, it's medal eligibility + round schedule.
    let ticketInfo: Parameters<typeof renderRewardTablePng>[0]["ticketInfo"] = null;
    if (args.seasonType === "CHAMPIONSHIP") {
      if (args.requiredMedalCount !== undefined && args.roundCount !== undefined && args.roundInterval !== undefined) {
        ticketInfo = {
          lines: buildChampionshipTicketLines(args.requiredMedalCount, args.roundCount, args.roundInterval),
        };
      } else if (args.requiredMedalCount !== undefined || args.roundCount !== undefined || args.roundInterval !== undefined) {
        console.error(
          "--required-medal-count/--round-count/--round-interval 중 일부만 있습니다 (CHAMPIONSHIP 타입은 세 값 다 필요) — 티켓 정보 없이 진행합니다.",
        );
      }
    } else if (args.ticketTotal !== undefined) {
      if (args.ticketSession !== undefined) {
        ticketInfo = { lines: buildSeasonTicketLines(args.ticketTotal, args.ticketSession) };
      } else {
        console.error("--ticket-total은 있는데 --ticket-session이 없습니다 (SEASON 타입은 두 값 다 필요) — 티켓 정보 없이 진행합니다.");
      }
    }

    const png = renderRewardTablePng({
      title,
      groups,
      tiers,
      rankingPool: config.rankingPool,
      season: seasonMeta ? { startBlock: seasonMeta.startBlock, endBlock: seasonMeta.endBlock } : null,
      dates,
      ticketInfo,
    });
    await Bun.write(args.pngPath, png);
    console.error(`PNG 저장: ${args.pngPath}`);
  }

  if (fatal.length > 0) {
    console.error(`\n${fatal.length}개 치명(FATAL) 항목 — 산출물을 신뢰할 수 없습니다.`);
    process.exit(1);
  }
}

function printHumanReadable(output: {
  title: string;
  config: RewardConfig;
  season: { id: number; startBlock: number; endBlock: number; totalPrize: number } | null;
  groups: ReturnType<typeof generateTierGroups>;
  tiers: ReturnType<typeof convertTierGroupsToRewardTiers>;
  invariants: ReturnType<typeof checkInvariants>;
  results: ReturnType<typeof calculateRewards>["results"] | null;
  skippedRanks: number[];
  stakingMatchFailures: { agentAddress: string; reason: string }[];
}) {
  console.log(output.title);
  console.log(
    `RankingPool=${output.config.rankingPool} staking2=${output.config.stakingLv2Multiplier} ` +
      `staking3=${output.config.stakingLv3Multiplier} couragePass=${output.config.couragePassMultiplier}`,
  );
  if (output.season) {
    console.log(`season.id=${output.season.id} blocks=${output.season.startBlock}-${output.season.endBlock}`);
  }
  console.log("");

  const header = ["Group", "Players", "%", "GroupReward", "Basic", "Stk2", "Stk3", "CP", "CP+St2", "CP+St3"];
  const rows = output.groups.map((g, i) => {
    const t = output.tiers[i];
    return [
      g.rankGroup,
      String(g.playerCount),
      `${g.rewardPercentage}%`,
      g.groupReward.toLocaleString(),
      t.basicReward.toLocaleString(),
      (t.basicReward + t.staking2Reward).toLocaleString(),
      (t.basicReward + t.staking3Reward).toLocaleString(),
      (t.basicReward + t.couragePassReward).toLocaleString(),
      (t.basicReward + t.couragePassAndStaking2Reward).toLocaleString(),
      (t.basicReward + t.couragePassAndStaking3Reward).toLocaleString(),
    ];
  });
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmt = (cols: string[]) => cols.map((c, i) => c.padStart(widths[i])).join("  ");
  console.log(fmt(header));
  for (const r of rows) console.log(fmt(r));
  console.log("");

  console.log("불변식:");
  for (const inv of output.invariants) {
    const mark = inv.ok ? "OK   " : inv.level === "FATAL" ? "FATAL" : "WARN ";
    console.log(`  [${mark}] ${inv.name} — ${inv.detail}`);
  }

  if (output.results) {
    console.log(`\n${output.results.length}명 지급 계산 완료.`);
    if (output.skippedRanks.length > 0) {
      console.log(`스킵된 랭크(테이블 범위 밖): ${output.skippedRanks.length}명`);
    }
    if (output.stakingMatchFailures.length > 0) {
      console.log(`스테이킹 매칭 실패: ${output.stakingMatchFailures.length}건`);
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
