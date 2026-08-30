/**
 * Data-source adapters for arena-reward-table: ranking, staking, courage-pass.
 *
 * Design (agreed 2026-08-30, see .claude/skills/arena-reward-table/references/data-sources.md
 * for the full investigation this is based on):
 *
 *   ranking     -> API default (ArenaService /leaderboard/completed), CSV override fallback
 *   staking     -> API default (garage per-season snapshot), CSV override fallback (this
 *                  skill's own addition — the real backend has NO staking CSV path at all;
 *                  ArenaRewardService only ever reads garage)
 *   couragePass -> CSV only for now. The real API (SeasonPass admin /api/admin/premium-users)
 *                  needs an HS256 JWT signed with a k8s-Secret-only key this environment does
 *                  not have. The adapter function exists and is wired for when that secret is
 *                  available, but currently always throws NoJwtSecretError.
 *
 * All three CSV parsers match the backend's exact column names (ArenaRewardModels.cs's
 * [Name(...)] attributes / *Map classes) so a CSV exported from the real backoffice, or one
 * built to match it, works here unmodified.
 */

import type { CouragePassEntry, RankingEntry, StakeEntry } from "./arena-reward-calc";
import { getStakingLevel } from "./arena-reward-calc";
import { getNetworkInfo, requireArenaServiceHost, type ArenaNetwork } from "./arena-network";

// ---------------------------------------------------------------------------
// Season resolution
// ---------------------------------------------------------------------------

export interface SeasonMeta {
  readonly id: number;
  readonly seasonGroupId: number;
  readonly arenaType: string;
  readonly startBlock: number;
  readonly endBlock: number;
  readonly totalPrize: number;
}

/** Raw /seasons response shape — NOTE the field names differ from SimpleSeasonResponse
 *  (the `season` object embedded in /leaderboard/completed's response), which uses
 *  `startBlock`/`endBlock`. This endpoint uses `startBlockIndex`/`endBlockIndex` instead.
 *  Confirmed via Swagger + live response, 2026-08-30 — do not assume the two are the same
 *  shape just because both describe "a season". */
interface RawSeasonResponse {
  id: number;
  seasonGroupId: number;
  arenaType: string;
  startBlockIndex: number;
  endBlockIndex: number;
  totalPrize: number;
}

/** GET /seasons?pageNumber=&pageSize= — NOTE: the query param is pageSize, not limit.
 *  (Confirmed 2026-08-30: passing `limit` is silently ignored and the server falls back
 *  to its default pageSize=10, which looks like it "worked" if you don't check the count.)
 *  pageSize is capped server-side at 100 (confirmed: 200 -> 400 "Page size must be between
 *  1 and 100") — this fetches every page up to that cap until a short page signals the end. */
export async function fetchSeasons(host: string, opts: { pageSize?: number } = {}): Promise<SeasonMeta[]> {
  const pageSize = Math.min(opts.pageSize ?? 100, 100);
  const all: SeasonMeta[] = [];
  for (let pageNumber = 1; ; pageNumber++) {
    const url = `${host}/seasons?pageNumber=${pageNumber}&pageSize=${pageSize}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { seasons: RawSeasonResponse[] };
    all.push(
      ...body.seasons.map((s) => ({
        id: s.id,
        seasonGroupId: s.seasonGroupId,
        arenaType: s.arenaType,
        startBlock: s.startBlockIndex,
        endBlock: s.endBlockIndex,
        totalPrize: s.totalPrize,
      })),
    );
    if (body.seasons.length < pageSize) break;
  }
  return all;
}

export class SeasonNotFoundError extends Error {
  constructor(network: ArenaNetwork, seasonType: string, seasonGroupId: number) {
    super(
      `${network}에서 arenaType=${seasonType}, seasonGroupId=${seasonGroupId}인 시즌을 못 찾았습니다. ` +
        `아직 진행 중이거나 pageSize가 부족할 수 있습니다.`,
    );
  }
}

/** Resolves (network, seasonType, seasonGroupId) -> the ArenaService numeric Season.Id.
 *  Necessary because Season.Id collides across networks (confirmed: Odin S39 and Heimdall
 *  CS9 are both id=40) — seasonGroupId + arenaType + network is the only collision-free key. */
export async function resolveSeasonId(
  network: ArenaNetwork,
  seasonType: string,
  seasonGroupId: number,
): Promise<SeasonMeta> {
  const host = requireArenaServiceHost(network);
  const seasons = await fetchSeasons(host);
  const match = seasons.find((s) => s.arenaType === seasonType && s.seasonGroupId === seasonGroupId);
  if (!match) throw new SeasonNotFoundError(network, seasonType, seasonGroupId);
  return match;
}

// ---------------------------------------------------------------------------
// Ranking (leaderboard)
// ---------------------------------------------------------------------------

interface LeaderboardEntryResponse {
  rank: number;
  avatarAddress: string;
  agentAddress: string;
  nameWithHash: string;
  score: number;
  totalWin: number;
  totalLose: number;
  level: number;
}

export class SeasonNotCompletedError extends Error {
  constructor(seasonId: number, public readonly rawMessage: string) {
    super(
      `시즌 ${seasonId}이 아직 진행 중이거나(또는 cached-block-info 캐시가 뒤처져서) ` +
        `완료로 인식되지 않습니다: ${rawMessage}`,
    );
  }
}

/** GET /leaderboard/completed?seasonId= with retry-on-cache-lag.
 *
 *  Confirmed 2026-08-30: this endpoint appears to gate "is this season completed?" on the
 *  server's CACHED block height (/cached-block-info), which can lag the real chain tip by
 *  hundreds of thousands of blocks. A season that has genuinely ended can still 400 with
 *  "ongoing or future" until the cache catches up. That 400 is retried with backoff here —
 *  it is NOT necessarily permanent. If retries are exhausted, the caller should fall back to
 *  a CSV rather than block indefinitely (this is the retry budget the hybrid design needs). */
export async function fetchCompletedLeaderboard(
  host: string,
  seasonId: number,
  opts: { retries?: number; retryDelayMs?: number } = {},
): Promise<{ season: SeasonMeta; leaderboard: RankingEntry[] }> {
  const retries = opts.retries ?? 3;
  const retryDelayMs = opts.retryDelayMs ?? 2000;
  const url = `${host}/leaderboard/completed?seasonId=${seasonId}`;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url);
    if (res.ok) {
      const body = (await res.json()) as {
        season: SeasonMeta;
        leaderboard: LeaderboardEntryResponse[];
      };
      return {
        season: body.season,
        leaderboard: body.leaderboard.map((e) => ({
          avatarAddress: e.avatarAddress,
          agentAddress: e.agentAddress,
          nameWithHash: e.nameWithHash,
          rank: e.rank,
          score: e.score,
          totalWin: e.totalWin,
          totalLose: e.totalLose,
          level: e.level,
        })),
      };
    }

    const text = await res.text();
    if (res.status === 400 && attempt < retries) {
      lastError = new SeasonNotCompletedError(seasonId, text);
      await new Promise((r) => setTimeout(r, retryDelayMs * 2 ** attempt));
      continue;
    }
    throw res.status === 400 ? new SeasonNotCompletedError(seasonId, text) : new Error(`GET ${url} -> HTTP ${res.status}: ${text}`);
  }
  // unreachable, but keeps TS happy
  throw lastError ?? new Error(`GET ${url} failed after ${retries} retries`);
}

const RANKING_CSV_HEADER = [
  "avatar_address",
  "agent_address",
  "name_with_hash",
  "ranking",
  "score",
  "total_win",
  "total_lose",
  "level",
] as const;

/** Matches ArenaRankingEntryMap exactly (ArenaRewardModels.cs). Column order in the file
 *  doesn't matter (matched by header name), but the names must be exact snake_case. */
export function parseRankingCsv(text: string): RankingEntry[] {
  const { header, rows } = splitCsv(text);
  requireColumns(header, RANKING_CSV_HEADER, "랭킹 CSV");
  const idx = indexOf(header);
  return rows.map((row) => ({
    avatarAddress: row[idx("avatar_address")],
    agentAddress: row[idx("agent_address")],
    nameWithHash: row[idx("name_with_hash")],
    rank: Number(row[idx("ranking")]),
    score: Number(row[idx("score")]),
    totalWin: Number(row[idx("total_win")]),
    totalLose: Number(row[idx("total_lose")]),
    level: Number(row[idx("level")]),
  }));
}

// ---------------------------------------------------------------------------
// Staking (garage snapshot)
// ---------------------------------------------------------------------------

interface GarageStakingResponse {
  metadata: {
    seasonId: number;
    currentBlockIndex: number;
    endBlockIndex: number;
    timestamp: string;
  };
  stakingInfo: Array<{
    address: string;
    agentAddress: string;
    deposit: string;
    startedBlockIndex: number;
    receivedBlockIndex: number;
    cancellableBlockIndex: number;
  }>;
}

export class StakingSnapshotNotFoundError extends Error {
  constructor(planetName: string, seasonId: number) {
    super(`garage에 ${planetName} 시즌 ${seasonId}의 스테이킹 스냅샷이 없습니다 (404).`);
  }
}

/** GET garage.nine-chronicles.dev/staking-for-arena/main/{PlanetName}/{seasonId}.json.
 *  This is a static, already-point-in-time snapshot (metadata.timestamp/currentBlockIndex
 *  are baked in at generation time) — no cache-lag retry needed here, unlike the leaderboard. */
export async function fetchGarageStaking(planetName: string, seasonId: number): Promise<StakeEntry[]> {
  const url = `https://garage.nine-chronicles.dev/staking-for-arena/main/${planetName}/${seasonId}.json`;
  const res = await fetch(url);
  if (res.status === 404) throw new StakingSnapshotNotFoundError(planetName, seasonId);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  const body = (await res.json()) as GarageStakingResponse;
  return body.stakingInfo.map((s) => ({
    agentAddress: s.agentAddress,
    deposit: Number(s.deposit),
  }));
}

/** Not part of the real backend (ArenaRewardService has zero staking-CSV path — garage is
 *  its only staking source). Added here purely as an operational fallback for when garage
 *  is unreachable; document this divergence clearly to whoever reads a report produced with
 *  this fallback active. Columns: agent_address, deposit (decimal string, same as garage). */
const STAKING_CSV_HEADER = ["agent_address", "deposit"] as const;

export function parseStakingCsv(text: string): StakeEntry[] {
  const { header, rows } = splitCsv(text);
  requireColumns(header, STAKING_CSV_HEADER, "스테이킹 CSV (스킬 자체 폴백 포맷 — 백엔드엔 없음)");
  const idx = indexOf(header);
  return rows.map((row) => ({
    agentAddress: row[idx("agent_address")],
    deposit: Number(row[idx("deposit")]),
  }));
}

// ---------------------------------------------------------------------------
// Courage pass
// ---------------------------------------------------------------------------

export class NoJwtSecretError extends Error {
  constructor() {
    super(
      "용기패스 API(SeasonPass /api/admin/premium-users)는 HS256 JWT가 필요합니다. " +
        "서명 시크릿(NC_MAINNET_SEASONPASS_JWT_KEY)이 k8s Secret에만 있어 이 환경엔 없습니다. " +
        "--courage-pass-csv로 CSV 폴백을 쓰세요.",
    );
  }
}

/** GET {SEASONPASS_API_URL}/api/admin/premium-users?pass_type=CouragePass&season_index=&
 *  planet_id=&limit=100&offset=0, paginated. Wired for when a JWT secret becomes available —
 *  see .claude/skills/arena-reward-table/references/data-sources.md for the full auth spec
 *  and the "season_index silently ignored if unknown" trap this MUST guard against: the
 *  response's season_info.season_index must be checked against the request, or a typo'd
 *  season number silently returns every premium user across all seasons instead of an error. */
export async function fetchCouragePassEntries(
  _seasonPassApiUrl: string,
  _planetId: string,
  _seasonIndex: number,
  _signJwt: () => string,
): Promise<CouragePassEntry[]> {
  throw new NoJwtSecretError();
}

const COURAGE_PASS_CSV_HEADER = ["avatar_addr", "product_id", "agent_Addr"] as const;

/** Matches CouragePassEntryMap exactly — including the inconsistent `agent_Addr` casing
 *  (capital A, unlike avatar_addr/product_id). This is a real backend quirk, not a typo. */
export function parseCouragePassCsv(text: string): CouragePassEntry[] {
  const { header, rows } = splitCsv(text);
  requireColumns(header, COURAGE_PASS_CSV_HEADER, "용기패스 CSV");
  const idx = indexOf(header);
  return rows.map((row) => ({
    avatarAddress: row[idx("avatar_addr")],
    agentAddress: row[idx("agent_Addr")],
  }));
}

// ---------------------------------------------------------------------------
// Minimal CSV helpers (no external dependency — header-matched, comma-separated,
// no quoted-field support since none of the three formats above need it)
// ---------------------------------------------------------------------------

function splitCsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  const header = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((l) => l.split(",").map((c) => c.trim()));
  return { header, rows };
}

function requireColumns(header: string[], required: readonly string[], label: string): void {
  const missing = required.filter((col) => !header.includes(col));
  if (missing.length > 0) {
    throw new Error(`${label}에 필수 컬럼이 없습니다: ${missing.join(", ")} (헤더: ${header.join(", ")})`);
  }
}

function indexOf(header: string[]): (col: string) => number {
  return (col: string) => {
    const i = header.indexOf(col);
    if (i < 0) throw new Error(`컬럼을 찾을 수 없습니다: ${col}`);
    return i;
  };
}

// Re-exported for CLI convenience so callers don't need to import from arena-reward-calc too.
export { getStakingLevel, getNetworkInfo };
