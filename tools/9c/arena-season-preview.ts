#!/usr/bin/env bun
/**
 * arena-season-preview — before registering a new arena season in ManageSeasons, preview
 * its block <-> date range and cross-check the 9 inputs against what the server does NOT
 * validate itself (spec doc §5-1 "서버가 안 해주는 것"): policy id / arena type
 * consistency (observed-convention only, never provably correct — see
 * tools/9c/lib/arena-policy-fingerprint.ts), gap vs. the previous season, and Total Prize
 * against a historical baseline.
 *
 * Two modes for pinning down the season's block range:
 *   --season-start-block <n>   기본 모드: 이미 정해진 시작 블록 -> 날짜로 환산해 보여주기
 *   --season-start-date <ISO>  보조 모드: 원하는 시작 날짜 -> 블록으로 역산 (시즌 사이에 공백을
 *                               두거나 새로 열 때만 필요 — §5-1)
 * Exactly one of the two must be given.
 *
 * Like arena-reward-table, every input is explicit — no silent defaults. round_interval
 * is observed to be 10,800 for every historical season across all types (spec §7-1), but
 * this tool still requires it explicitly rather than assuming that never changes.
 *
 * Usage:
 *   bun run tools/9c/arena-season-preview.ts --network odin --season-group-id 46 \
 *     --arena-type OFF_SEASON --season-start-block 20265224 \
 *     --round-interval 10800 --round-count 17 --required-medal-count 0 \
 *     --total-prize 0 --battle-policy-id 5 --refresh-policy-id 5
 *
 * For an ALREADY-COMPLETED season, add --verify-season to backtest the date estimator
 * instead of previewing it: builds the block-time model anchored at the season's own
 * start block (so it never sees the end block's real timestamp), predicts the end
 * block's date, then compares against Mimir's actually-recorded timestamp for that
 * block. This operationalizes the manual backtest the domain owner ran on 2026-08-30 to
 * validate the estimator (see references/date-estimate-backtest.md) — Mimir's block
 * timestamps ARE the ground truth, no external record was ever needed.
 *   bun run tools/9c/arena-season-preview.ts --network odin --season-group-id 39 \
 *     --arena-type SEASON --season-start-block 19260824 --round-interval 10800 \
 *     --round-count 14 --required-medal-count 0 --total-prize 400000 \
 *     --battle-policy-id 4 --refresh-policy-id 4 --verify-season
 */
import {
  checkPolicyFingerprint,
  type ArenaSeasonType,
} from "./lib/arena-policy-fingerprint";
import { backtestSeasonDates, estimateBlockForDate, estimateDateForBlock, measureBlockTimeModel } from "./lib/arena-block-time";
import { getNetworkInfo, requireMimirHost, type ArenaNetwork } from "./lib/arena-network";
import { fetchSeasons } from "./lib/arena-reward-sources";

// Historical Total Prize baseline per arena type (spec doc §7-1 / independently sourced
// live-10-season observation: SEASON=400000 all 3, CHAMPIONSHIP=500000 both, OFF_SEASON=0
// all). Same epistemics as the policy fingerprint: an observed convention, not a rule the
// code enforces (Season.TotalPrize and RankingPool have no code-level link — spec §6-2).
const TOTAL_PRIZE_BASELINE: Record<ArenaSeasonType, number> = {
  SEASON: 400_000,
  CHAMPIONSHIP: 500_000,
  OFF_SEASON: 0,
};

const OBSERVED_ROUND_INTERVAL = 10_800;

interface Args {
  network?: ArenaNetwork;
  seasonGroupId?: number;
  arenaType?: ArenaSeasonType;
  seasonStartBlock?: number;
  seasonStartDate?: string;
  roundInterval?: number;
  roundCount?: number;
  requiredMedalCount?: number;
  totalPrize?: number;
  battlePolicyId?: number;
  refreshPolicyId?: number;
  rewardTablePool?: number;
  verifySeason: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false, verifySeason: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--network":
        args.network = next() as ArenaNetwork;
        break;
      case "--season-group-id":
        args.seasonGroupId = Number(next());
        break;
      case "--arena-type":
        args.arenaType = next() as ArenaSeasonType;
        break;
      case "--season-start-block":
        args.seasonStartBlock = Number(next());
        break;
      case "--season-start-date":
        args.seasonStartDate = next();
        break;
      case "--round-interval":
        args.roundInterval = Number(next());
        break;
      case "--round-count":
        args.roundCount = Number(next());
        break;
      case "--required-medal-count":
        args.requiredMedalCount = Number(next());
        break;
      case "--total-prize":
        args.totalPrize = Number(next());
        break;
      case "--battle-policy-id":
        args.battlePolicyId = Number(next());
        break;
      case "--refresh-policy-id":
        args.refreshPolicyId = Number(next());
        break;
      case "--reward-table-pool":
        args.rewardTablePool = Number(next());
        break;
      case "--verify-season":
        args.verifySeason = true;
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

function requireArgs(args: Args): asserts args is Required<Omit<Args, "seasonStartBlock" | "seasonStartDate" | "rewardTablePool">> & Args {
  const missing: string[] = [];
  if (!args.network) missing.push("--network");
  if (args.seasonGroupId === undefined) missing.push("--season-group-id");
  if (!args.arenaType) missing.push("--arena-type");
  if (args.roundInterval === undefined) missing.push("--round-interval");
  if (args.roundCount === undefined) missing.push("--round-count");
  if (args.requiredMedalCount === undefined) missing.push("--required-medal-count");
  if (args.totalPrize === undefined) missing.push("--total-prize");
  if (args.battlePolicyId === undefined) missing.push("--battle-policy-id");
  if (args.refreshPolicyId === undefined) missing.push("--refresh-policy-id");
  if (!args.seasonStartBlock && !args.seasonStartDate) missing.push("--season-start-block 또는 --season-start-date");
  if (args.seasonStartBlock && args.seasonStartDate) {
    throw new Error("--season-start-block과 --season-start-date는 동시에 줄 수 없습니다 (기본 모드/보조 모드 중 하나만).");
  }
  if (missing.length > 0) {
    throw new Error(
      `다음 값을 명시적으로 입력해야 합니다 (arena-reward-table과 동일한 원칙 — 조용한 기본값 없음): ${missing.join(", ")}`,
    );
  }
}

interface Invariant {
  readonly id: string;
  readonly name: string;
  readonly ok: boolean;
  readonly level: "OK" | "WARN" | "FATAL";
  readonly detail: string;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  requireArgs(args);

  const mimirHost = requireMimirHost(args.network);
  const model = await measureBlockTimeModel(mimirHost);

  let startBlock: number;
  let startBlockMarginBlocks = 0;
  if (args.seasonStartBlock) {
    startBlock = args.seasonStartBlock;
  } else {
    const est = estimateBlockForDate(model, new Date(args.seasonStartDate!));
    startBlock = est.estimate;
    startBlockMarginBlocks = est.marginBlocks;
  }

  const endBlock = startBlock + args.roundInterval! * args.roundCount! - 1;

  if (args.verifySeason) {
    const result = await backtestSeasonDates(mimirHost, startBlock, endBlock);
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`앵커(시작) 블록: ${result.anchorBlock.toLocaleString()}`);
      console.log(`대상(종료) 블록: ${result.targetBlock.toLocaleString()}`);
      console.log(`예측: ${result.predicted.toISOString()} (±${result.marginMinutes.toFixed(1)}분)`);
      console.log(`실제: ${result.actual.toISOString()} (Mimir 실측 기록)`);
      console.log(
        `잔차: ${result.residualMinutes >= 0 ? "+" : ""}${result.residualMinutes.toFixed(1)}분 ` +
          `(예측이 실제보다 ${result.residualMinutes >= 0 ? "늦음" : "이름"}) — ` +
          `${result.withinMargin ? "마진 이내" : "⚠️ 마진 초과"}`,
      );
    }
    if (!result.withinMargin) process.exit(1);
    return;
  }

  const startDate = estimateDateForBlock(model, startBlock);
  const endDate = estimateDateForBlock(model, endBlock);
  const totalDays = (endBlock - startBlock + 1) / ((86400 / model.secPerBlock) || 1);

  const invariants: Invariant[] = [];

  // -- gap check against the previous season on this network --
  const seasons = await fetchSeasons(getNetworkInfo(args.network).arenaServiceHost ?? "");
  const previous = seasons
    .filter((s) => s.endBlock < startBlock)
    .sort((a, b) => b.endBlock - a.endBlock)[0];
  if (previous) {
    const gap = startBlock - (previous.endBlock + 1);
    if (gap === 0) {
      invariants.push({
        id: "gap",
        name: "직전 시즌과 연속(gap 없음)",
        ok: true,
        level: "OK",
        detail: `직전 시즌(id=${previous.id}, end=${previous.endBlock})과 바로 이어짐`,
      });
    } else if (gap > 0) {
      invariants.push({
        id: "gap",
        name: "직전 시즌과 gap 발생",
        ok: false,
        level: "WARN",
        detail: `직전 시즌(id=${previous.id}) 종료(${previous.endBlock}) 이후 ${gap}블록 공백. 의도적 공백인지 담당자 확인 필요 (gap 탐지 로직은 확정, "무조건 오류"인지는 운영 정책 판단 — 스펙 §6-2)`,
      });
    } else {
      invariants.push({
        id: "gap",
        name: "직전 시즌과 블록 범위 겹침",
        ok: false,
        level: "WARN",
        detail: `직전 시즌(id=${previous.id}, end=${previous.endBlock})과 ${-gap}블록 겹침 — 서버 저장 시 IsBlockRangeOverlappingAsync가 거부하겠지만, 등록 전에 미리 잡습니다.`,
      });
    }
  } else {
    invariants.push({
      id: "gap",
      name: "직전 시즌 없음(이 네트워크 첫 시즌 또는 조회 범위 밖)",
      ok: true,
      level: "OK",
      detail: "gap 검사 생략",
    });
  }

  // -- round_interval sanity check (observed constant, not enforced) --
  if (args.roundInterval !== OBSERVED_ROUND_INTERVAL) {
    invariants.push({
      id: "round-interval-baseline",
      name: `round_interval == ${OBSERVED_ROUND_INTERVAL} (전 타입·전 시즌 관측값)`,
      ok: false,
      level: "WARN",
      detail: `입력값 ${args.roundInterval} — 지금까지 모든 시즌·모든 타입에서 ${OBSERVED_ROUND_INTERVAL}이 관측됨 (스펙 §7-1). 의도적 변경이 아니면 오타 의심.`,
    });
  } else {
    invariants.push({
      id: "round-interval-baseline",
      name: `round_interval == ${OBSERVED_ROUND_INTERVAL}`,
      ok: true,
      level: "OK",
      detail: `관측 기준값과 일치`,
    });
  }

  // -- policy id fingerprint (observed convention, never FATAL) --
  if (args.battlePolicyId !== args.refreshPolicyId) {
    invariants.push({
      id: "battle-refresh-policy-mismatch",
      name: "battle/refresh policy id가 서로 다름",
      ok: false,
      level: "WARN",
      detail: `battle=${args.battlePolicyId}, refresh=${args.refreshPolicyId} — 지금까지 관측된 모든 시즌에서 이 둘은 항상 같은 값이었습니다. 의도적인지 확인 필요.`,
    });
  }
  const battleFp = checkPolicyFingerprint(args.network, args.battlePolicyId!, args.arenaType!);
  invariants.push({
    id: "battle-policy-fingerprint",
    name: "battle policy id ↔ arenaType 관측 일치",
    ok: battleFp.ok,
    level: battleFp.level,
    detail: battleFp.detail,
  });
  const refreshFp = checkPolicyFingerprint(args.network, args.refreshPolicyId!, args.arenaType!);
  invariants.push({
    id: "refresh-policy-fingerprint",
    name: "refresh policy id ↔ arenaType 관측 일치",
    ok: refreshFp.ok,
    level: refreshFp.level,
    detail: refreshFp.detail,
  });

  // -- Total Prize checks --
  const baseline = TOTAL_PRIZE_BASELINE[args.arenaType!];
  if (args.totalPrize !== baseline) {
    invariants.push({
      id: "total-prize-baseline",
      name: `Total Prize ↔ ${args.arenaType} 관측 기준값(${baseline.toLocaleString()})`,
      ok: false,
      level: "WARN",
      detail: `입력값 ${args.totalPrize!.toLocaleString()} — 과거 라이브 관측으로는 ${args.arenaType}이 전부 ${baseline.toLocaleString()}이었습니다. 코드 연결은 없는 운영 관례이므로 다른 것 자체는 정상 범위일 수 있음.`,
    });
  } else {
    invariants.push({
      id: "total-prize-baseline",
      name: `Total Prize ↔ ${args.arenaType} 관측 기준값`,
      ok: true,
      level: "OK",
      detail: `관측 기준값과 일치`,
    });
  }
  if (args.rewardTablePool !== undefined && args.totalPrize !== args.rewardTablePool) {
    invariants.push({
      id: "total-prize-vs-reward-table-pool",
      name: "Total Prize == arena-reward-table의 RankingPool",
      ok: false,
      level: "WARN",
      detail: `TotalPrize ${args.totalPrize!.toLocaleString()} vs RankingPool ${args.rewardTablePool.toLocaleString()} — 코드 연결 없는 운영 관례. 담당자 확인 필요 (스펙 §6-2).`,
    });
  }

  const fatal = invariants.filter((i) => i.level === "FATAL" && !i.ok);

  const output = {
    input: { ...args, json: undefined },
    computed: {
      startBlock,
      endBlock,
      startBlockMarginBlocks,
      startDateEstimate: startDate.estimate.toISOString(),
      startDateMarginMinutes: startDate.marginMinutes,
      endDateEstimate: endDate.estimate.toISOString(),
      endDateMarginMinutes: endDate.marginMinutes,
      totalDays: Math.round(totalDays * 10) / 10,
      blockTimeModel: { secPerBlock: model.secPerBlock, marginSecPerBlock: model.marginSecPerBlock },
    },
    invariants,
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    printHumanReadable(output);
  }

  if (fatal.length > 0) {
    console.error(`\n${fatal.length}개 치명(FATAL) 항목 — 등록 전에 확인이 필요합니다.`);
    process.exit(1);
  }
}

function printHumanReadable(output: {
  input: Record<string, unknown>;
  computed: {
    startBlock: number;
    endBlock: number;
    startBlockMarginBlocks: number;
    startDateEstimate: string;
    startDateMarginMinutes: number;
    endDateEstimate: string;
    endDateMarginMinutes: number;
    totalDays: number;
  };
  invariants: Invariant[];
}) {
  const { computed } = output;
  console.log(`시작 블록: ${computed.startBlock.toLocaleString()}${computed.startBlockMarginBlocks ? ` (날짜→블록 환산, 오차 ±${Math.round(computed.startBlockMarginBlocks)}블록)` : ""}`);
  console.log(`종료 블록: ${computed.endBlock.toLocaleString()}`);
  console.log(
    `시작 ${new Date(computed.startDateEstimate).toISOString().replace("T", " ").slice(0, 16)} UTC (±${computed.startDateMarginMinutes.toFixed(1)}분) / ` +
      `종료 ${new Date(computed.endDateEstimate).toISOString().replace("T", " ").slice(0, 16)} UTC (±${computed.endDateMarginMinutes.toFixed(1)}분) / 총 ${computed.totalDays}일`,
  );
  console.log("");
  console.log("대사 결과:");
  for (const inv of output.invariants) {
    const mark = inv.ok ? "OK   " : inv.level === "FATAL" ? "FATAL" : "WARN ";
    console.log(`  [${mark}] ${inv.name} — ${inv.detail}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
