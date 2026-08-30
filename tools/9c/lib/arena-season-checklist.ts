/**
 * Aggregation logic for arena-season-checklist — "파생" per spec §6-1/§6-4: this skill
 * doesn't compute anything new, it reads the --json output that skills 1-3 already
 * produce and rolls it into one screen.
 *
 * Shape mismatch across the four skills (confirmed by reading each CLI's actual --json
 * output, 2026-08-30) — this module's whole job is normalizing these into one common
 * shape:
 *   - arena-reward-table.ts, arena-season-preview.ts: `{ invariants: Check[] }`
 *   - arena-announce.ts: `{ checks: Check[] }` — same Check shape, different key name
 *   - arena-settlement-check.ts: a raw array of `TxStatusResult | { txId, error }` — not
 *     an invariants/checks list at all, because that skill is still only a partial build
 *     (see .claude/skills/arena-settlement-check/SKILL.md) — there is no OK/WARN/FATAL
 *     concept there yet, just per-tx on-chain status. Mapped here to the common shape so
 *     this skill can still show something for it, clearly labeled as partial.
 */

export type Level = "OK" | "WARN" | "FATAL";

export interface NormalizedCheck {
  readonly id: string;
  readonly name: string;
  readonly ok: boolean;
  readonly level: Level;
  readonly detail: string;
}

export interface SkillSection {
  readonly skill: string;
  /** null when this skill's JSON wasn't supplied — shown as "미실행", not folded into the
   *  overall level (an unrun check is not the same claim as a passing one). */
  readonly checks: NormalizedCheck[] | null;
  /** True for arena-settlement-check's current partial build — its "checks" are a
   *  best-effort mapping from tx status, not real invariants, and the skill's own
   *  documented scope gap (no per-user payout reconciliation yet) isn't represented here
   *  at all. Surfaced so this skill doesn't quietly imply skill 4 is complete. */
  readonly partial: boolean;
}

interface RawInvariantsShape {
  invariants?: unknown;
  checks?: unknown;
}

function isCheckArray(value: unknown): value is NormalizedCheck[] {
  return (
    Array.isArray(value) &&
    value.every(
      (v) =>
        v && typeof v === "object" && "id" in v && "name" in v && "ok" in v && "level" in v && "detail" in v,
    )
  );
}

/** arena-reward-table.ts / arena-season-preview.ts (`invariants`) and arena-announce.ts
 *  (`checks`) all produce the same Check shape under different keys — this reads either. */
export function normalizeInvariantsJson(skill: string, raw: unknown): SkillSection {
  const obj = raw as RawInvariantsShape;
  const list = obj.invariants ?? obj.checks;
  if (!isCheckArray(list)) {
    throw new Error(`${skill} JSON에서 invariants/checks 배열을 못 찾았습니다 — 형식이 바뀐 것 같습니다.`);
  }
  return { skill, checks: list, partial: false };
}

interface RawTxResult {
  readonly network?: string;
  readonly txId: string;
  readonly status?: "SUCCESS" | "FAILURE" | "STAGING" | "INCLUDED" | "INVALID";
  readonly error?: string;
}

/** arena-settlement-check.ts's --json is a raw array of tx results, not a Check list —
 *  mapped here so the checklist can show it, but `partial: true` marks that this is NOT
 *  the same kind of claim as the other three skills' invariant checks. */
export function normalizeSettlementJson(raw: unknown): SkillSection {
  if (!Array.isArray(raw)) {
    throw new Error("arena-settlement-check JSON이 배열이 아닙니다 — 형식이 바뀐 것 같습니다.");
  }
  const results = raw as RawTxResult[];
  const checks: NormalizedCheck[] = results.map((r) => {
    if (r.error) {
      return { id: `tx-${r.txId}`, name: `tx ${r.txId}`, ok: false, level: "WARN", detail: r.error };
    }
    const level: Level = r.status === "SUCCESS" ? "OK" : r.status === "FAILURE" || r.status === "INVALID" ? "FATAL" : "WARN";
    return {
      id: `tx-${r.txId}`,
      name: `tx ${r.txId}`,
      ok: level === "OK",
      level,
      detail: `${r.network ?? "?"} — ${r.status ?? "unknown"}`,
    };
  });
  return { skill: "arena-settlement-check", checks, partial: true };
}

export interface SeasonCacheHealth {
  readonly ok: boolean;
  readonly level: Level;
  readonly detail: string;
}

/** "시즌 캐시 읽기 점검" (spec §6-4) — GET /cached-block-info and report whether it's
 *  reachable at all (503 = cache empty, confirmed via ArenaService source, 2026-08-30 —
 *  see arena-reward-table's data-sources.md) and, if reachable, how far its cached tip
 *  lags behind live /seasons data (large lag is the same failure mode arena-reward-table's
 *  fetchCompletedLeaderboard retries around). This is a READ-ONLY check, matching spec
 *  §7-1's "읽기 동작이라 자동화해도 안전하다" principle used throughout this project. */
export async function checkSeasonCacheHealth(
  arenaServiceHost: string,
  latestKnownSeasonStartBlock: number,
): Promise<SeasonCacheHealth> {
  const res = await fetch(`${arenaServiceHost}/cached-block-info`);
  if (res.status === 503) {
    return { ok: false, level: "FATAL", detail: "503 — 시즌 캐시가 비어있습니다(CacheUnavailableException). 백그라운드 워커 상태를 확인하세요." };
  }
  if (!res.ok) {
    return { ok: false, level: "WARN", detail: `HTTP ${res.status} — 예상치 못한 응답` };
  }
  const body = (await res.json()) as { currentBlockIndex: number };
  const lag = latestKnownSeasonStartBlock - body.currentBlockIndex;
  if (lag > 100_000) {
    return {
      ok: false,
      level: "WARN",
      detail: `캐시된 블록(${body.currentBlockIndex.toLocaleString()})이 최신 시즌 시작 블록보다 ${lag.toLocaleString()}블록 뒤처져 있습니다 — /leaderboard/completed 400 오탐 위험(arena-reward-table 참고).`,
    };
  }
  return { ok: true, level: "OK", detail: `캐시된 블록 ${body.currentBlockIndex.toLocaleString()}, 최신 시즌과 ${Math.max(lag, 0).toLocaleString()}블록 차이` };
}

export interface ChecklistSummary {
  readonly overallLevel: Level;
  readonly sections: SkillSection[];
  readonly seasonCache: Record<string, SeasonCacheHealth>;
}

export function summarizeChecklist(sections: SkillSection[], seasonCache: Record<string, SeasonCacheHealth>): ChecklistSummary {
  const allLevels: Level[] = [
    ...sections.flatMap((s) => s.checks?.map((c) => c.level) ?? []),
    ...Object.values(seasonCache).map((c) => c.level),
  ];
  const overallLevel: Level = allLevels.includes("FATAL") ? "FATAL" : allLevels.includes("WARN") ? "WARN" : "OK";
  return { overallLevel, sections, seasonCache };
}
