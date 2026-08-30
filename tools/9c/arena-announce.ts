#!/usr/bin/env bun
/**
 * arena-announce — draft the Discord season-announcement text for an Odin+Heimdall
 * season pair, and flag what a human needs to check before posting it.
 *
 * Spec doc §4: "실행은 사람" — this tool only ever produces a draft. Sending it is
 * explicitly out of scope (discord.com isn't even in this environment's firewall
 * allowlist) and always a human's action.
 *
 * Every input is explicit, same principle as arena-reward-table/arena-season-preview:
 * no silently guessing which season is "the current one" to announce.
 *
 * Usage:
 *   bun run tools/9c/arena-announce.ts \
 *     --odin-season-group-id 39 --odin-arena-type SEASON \
 *     --heimdall-season-group-id 9 --heimdall-arena-type CHAMPIONSHIP
 *
 * Don't know the current seasonGroupId offhand? --list shows every not-yet-fully-past
 * season on both networks (groupId/type/estimated KST start) WITHOUT picking one — the
 * human still picks, this just saves a manual /seasons lookup (agreed 2026-08-30: no
 * auto-pairing, but a browse-only middle ground is fine).
 *   bun run tools/9c/arena-announce.ts --list
 */
import {
  buildAnnouncementDraft,
  checkSequentialSeasonNumber,
  type AnnounceableArenaType,
  type SeasonForAnnouncement,
} from "./lib/arena-announce-template";
import { estimateDateForBlock, measureBlockTimeModel } from "./lib/arena-block-time";
import { getNetworkInfo, requireMimirHost, type ArenaNetwork } from "./lib/arena-network";
import { fetchSeasons } from "./lib/arena-reward-sources";

interface Args {
  odinSeasonGroupId?: number;
  odinArenaType?: string;
  heimdallSeasonGroupId?: number;
  heimdallArenaType?: string;
  list: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { list: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--odin-season-group-id":
        args.odinSeasonGroupId = Number(next());
        break;
      case "--odin-arena-type":
        args.odinArenaType = next();
        break;
      case "--heimdall-season-group-id":
        args.heimdallSeasonGroupId = Number(next());
        break;
      case "--heimdall-arena-type":
        args.heimdallArenaType = next();
        break;
      case "--list":
        args.list = true;
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

function formatKst(date: Date): string {
  return (
    new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" }).format(date) + " KST"
  );
}

/** --list: every season on `network` whose end block hasn't passed yet (still running or
 *  entirely in the future) — the candidates a human would actually consider announcing. */
async function listCandidates(network: ArenaNetwork): Promise<void> {
  const host = getNetworkInfo(network).arenaServiceHost;
  if (!host) {
    console.log(`${network}: 아레나 엔드포인트 없음`);
    return;
  }
  const mimirHost = requireMimirHost(network);
  const [seasons, model] = await Promise.all([fetchSeasons(host), measureBlockTimeModel(mimirHost)]);
  const upcoming = seasons.filter((s) => s.endBlock >= model.tip.index).sort((a, b) => a.startBlock - b.startBlock);

  console.log(`${network}:`);
  if (upcoming.length === 0) {
    console.log("  (진행 중/예정 시즌 없음)");
    return;
  }
  for (const s of upcoming) {
    const est = estimateDateForBlock(model, s.startBlock);
    const flag = s.arenaType !== "OFF_SEASON" && s.seasonGroupId === 0 ? "  ⚠️ seasonGroupId=0 (버그 의심)" : "";
    const notAnnounceable = s.arenaType === "OFF_SEASON" ? "  (공지 대상 아님)" : "";
    console.log(
      `  groupId=${s.seasonGroupId}  ${s.arenaType.padEnd(12)}  시작 예상 ${formatKst(est.estimate)} (±${est.marginMinutes.toFixed(0)}분)${flag}${notAnnounceable}`,
    );
  }
}

function requireAnnounceable(arenaType: string, network: string): AnnounceableArenaType {
  if (arenaType !== "SEASON" && arenaType !== "CHAMPIONSHIP") {
    throw new Error(
      `${network} arena type "${arenaType}"은(는) 공지 대상이 아닙니다 — 오프시즌은 공지가 안 나갑니다 ` +
        `(실측 확인: 샘플 3건 전부 SEASON/CHAMPIONSHIP만 있었음). SEASON 또는 CHAMPIONSHIP만 입력하세요.`,
    );
  }
  return arenaType;
}

interface ResolvedSeason {
  readonly season: SeasonForAnnouncement;
  /** null if no earlier season of the same arenaType exists in the fetched range —
   *  see checkSequentialSeasonNumber's handling of that case. */
  readonly previousSameTypeSeasonGroupId: number | null;
}

async function resolveSeason(
  network: "odin" | "heimdall",
  seasonGroupId: number,
  arenaType: AnnounceableArenaType,
): Promise<ResolvedSeason> {
  const host = getNetworkInfo(network).arenaServiceHost!;
  // requiredMedalCount isn't in the SeasonMeta shape fetchSeasons returns (that module
  // only needed id/seasonGroupId/arenaType/blocks/totalPrize) — fetch the raw list
  // ourselves instead of widening a shared type for one caller.
  const res = await fetch(`${host}/seasons?pageNumber=1&pageSize=100`);
  const body = (await res.json()) as {
    seasons: Array<{ id: number; seasonGroupId: number; arenaType: string; startBlockIndex: number; requiredMedalCount: number }>;
  };
  const match = body.seasons.find((s) => s.seasonGroupId === seasonGroupId && s.arenaType === arenaType);
  if (!match) {
    throw new Error(`${network}에서 arenaType=${arenaType}, seasonGroupId=${seasonGroupId}인 시즌을 못 찾았습니다.`);
  }
  // Exclude seasonGroupId===0 rows from the search — those are either OFF_SEASON (a
  // different arenaType, already excluded by the filter below) or a data-entry anomaly
  // (real case: heimdall sid=1 and sid=42 both have seasonGroupId=0 despite being
  // SEASON/CHAMPIONSHIP). Picking one of those as "the previous season" would make the
  // expected next number 1, flooding this check with false positives for every season
  // that actually follows a real, valid predecessor (2026-08-30 review caught this before
  // it shipped — heimdall's real next SEASON after the buggy sid=42 would otherwise have
  // been checked against an expected value of 1 instead of the real 25).
  const previousSameType = body.seasons
    .filter((s) => s.arenaType === arenaType && s.id < match.id && s.seasonGroupId !== 0)
    .sort((a, b) => b.id - a.id)[0];

  return {
    season: {
      network,
      seasonGroupId: match.seasonGroupId,
      arenaType,
      requiredMedalCount: match.requiredMedalCount,
      startBlock: match.startBlockIndex,
    },
    previousSameTypeSeasonGroupId: previousSameType?.seasonGroupId ?? null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    await listCandidates("odin");
    await listCandidates("heimdall");
    return;
  }

  const missing: string[] = [];
  if (args.odinSeasonGroupId === undefined) missing.push("--odin-season-group-id");
  if (!args.odinArenaType) missing.push("--odin-arena-type");
  if (args.heimdallSeasonGroupId === undefined) missing.push("--heimdall-season-group-id");
  if (!args.heimdallArenaType) missing.push("--heimdall-arena-type");
  if (missing.length > 0) {
    throw new Error(`다음 값을 명시적으로 입력해야 합니다: ${missing.join(", ")}`);
  }

  const odinType = requireAnnounceable(args.odinArenaType!, "odin");
  const heimdallType = requireAnnounceable(args.heimdallArenaType!, "heimdall");

  const [odinResolved, heimdallResolved] = await Promise.all([
    resolveSeason("odin", args.odinSeasonGroupId!, odinType),
    resolveSeason("heimdall", args.heimdallSeasonGroupId!, heimdallType),
  ]);
  const odin = odinResolved.season;
  const heimdall = heimdallResolved.season;

  const draft = buildAnnouncementDraft(odin, heimdall);
  const checks = [
    ...draft.checks,
    checkSequentialSeasonNumber(odin, odinResolved.previousSameTypeSeasonGroupId),
    checkSequentialSeasonNumber(heimdall, heimdallResolved.previousSameTypeSeasonGroupId),
  ];

  // Sanity check: a pair should represent seasons launching around the same time (per
  // the domain owner: "페어링은 sid가 아니라 시작 시각 근접도로 잡으세요"). If the two
  // networks' start blocks convert to dates more than 3 days apart, this pair might be a
  // mismatch (wrong season picked on one side).
  try {
    const [odinMimir, heimdallMimir] = [requireMimirHost("odin"), requireMimirHost("heimdall")];
    const [odinModel, heimdallModel] = await Promise.all([measureBlockTimeModel(odinMimir), measureBlockTimeModel(heimdallMimir)]);
    const odinDate = estimateDateForBlock(odinModel, odin.startBlock).estimate;
    const heimdallDate = estimateDateForBlock(heimdallModel, heimdall.startBlock).estimate;
    const diffDays = Math.abs(odinDate.getTime() - heimdallDate.getTime()) / 1000 / 86400;
    checks.push({
      id: "start-time-proximity",
      name: "Odin/Heimdall 시작 시각이 서로 근접함",
      ok: diffDays <= 3,
      level: diffDays <= 3 ? "OK" : "WARN",
      detail:
        diffDays <= 3
          ? `약 ${diffDays.toFixed(1)}일 차이 — 같은 페어로 묶기에 정상 범위`
          : `약 ${diffDays.toFixed(1)}일 차이 — 페어링이 sid가 아니라 시작 시각 근접도 기준이어야 한다는 점(2026-08-30 확인)을 고려하면, 이 두 시즌이 실제로 같이 공지될 페어가 맞는지 재확인 필요`,
    });
  } catch (e) {
    // Block-time measurement failing shouldn't block draft generation — it's a bonus
    // sanity check, not a required input.
    checks.push({
      id: "start-time-proximity",
      name: "Odin/Heimdall 시작 시각이 서로 근접함",
      ok: true,
      level: "OK",
      detail: `측정 실패, 건너뜀: ${e instanceof Error ? e.message : e}`,
    });
  }

  const fatal = checks.filter((c) => c.level === "FATAL" && !c.ok);

  const output = { odin, heimdall, draft: draft.body, medalNoteReference: draft.medalNoteReference, checks };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    if (fatal.length === 0) {
      console.log("=== 공지 초안 ===");
      console.log(draft.body);
      console.log("");
    } else {
      console.log("치명(FATAL) 항목이 있어 초안을 표시하지 않습니다 — 아래 확인 후 재실행하세요.\n");
    }
    if (draft.medalNoteReference) {
      console.log("=== 참고: 메달 조정 문단이 필요할 수 있습니다 (그대로 쓰지 말고 확인 후 다듬어서) ===");
      console.log(draft.medalNoteReference);
      console.log("");
    }
    console.log("대사 결과:");
    for (const c of checks) {
      const mark = c.ok ? "OK   " : c.level === "FATAL" ? "FATAL" : "WARN ";
      console.log(`  [${mark}] ${c.name} — ${c.detail}`);
    }
  }

  if (fatal.length > 0) {
    console.error(`\n${fatal.length}개 치명(FATAL) 항목 — 게시 전에 반드시 확인이 필요합니다.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
