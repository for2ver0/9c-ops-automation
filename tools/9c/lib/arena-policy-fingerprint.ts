/**
 * "정책 ID ↔ 시즌 타입" fingerprint — an OBSERVED CONVENTION, not a verified rule.
 *
 * Design conclusion (2026-08-30, after two independent DB investigations — see
 * .claude/skills/arena-season-preview/references/policy-id-investigation.md for the full
 * comparison): there is NO programmatic way to verify that a Battle/Refresh Policy ID
 * matches its season's arenaType.
 *   - The public ArenaService REST API never exposes a policy's id or name at all
 *     (TicketPolicyResponse only has defaultTicketsPerRound/maxPurchasableTicketsPerRound/
 *     purchasePrices — confirmed via full Swagger schema + property-name grep, 2026-08-30).
 *   - The BackOffice's Policy.razor page shows id+name, but it's a Blazor Server UI, not
 *     an API — no programmatic read path.
 *   - Even the DB-level model has no ArenaType column on TicketPolicy. `Name` is operator
 *     free text. "name implies type" is a naming habit, not a constraint the schema
 *     enforces — and it has broken in practice (see MIXED_USAGE below).
 *
 * So this check can NEVER be FATAL, and the language used for it must never claim
 * certainty it doesn't have (no "this policy IS for SEASON" — only "this policy HAS BEEN
 * used for SEASON, N times, and never anything else so far").
 *
 * Data below is the DB dump the domain owner ran (battle_ticket_policies /
 * refresh_ticket_policies joined against seasons, all 3 networks) with one adjustment:
 * season id=1 on odin/heimdall/thor is EXCLUDED from "reliable" observations. All three
 * have a suspiciously tiny block width (1-2 blocks) suggesting a seed/dummy row from
 * initial DB setup rather than a real operated season — a second independent
 * investigation flagged this specifically. Excluding them removes the odin/heimdall
 * "policy 1 used for both SEASON and CHAMPIONSHIP" cross-use claim, which likely wasn't a
 * real production event. What's left AFTER excluding the suspected dummy rows is still
 * enough to prove the point: thor season 2 (block width ~6800, clearly a real operating
 * range) used policy id 6 ("new Championship") for an OFF_SEASON. That is the credible
 * counter-example this module is built to not paper over.
 */

export type ArenaSeasonType = "SEASON" | "CHAMPIONSHIP" | "OFF_SEASON";

export interface PolicyFingerprint {
  readonly network: "odin" | "heimdall" | "thor";
  readonly policyId: number;
  readonly name: string;
  /** Season ids this policy id was observed with, per arena type — excludes suspected
   *  dummy rows (see module doc comment). Empty array means "never reliably observed". */
  readonly observedSeasons: Partial<Record<ArenaSeasonType, number[]>>;
}

// battle_ticket_policy_id == refresh_ticket_policy_id in every observed season (0
// exceptions across all 3 networks, both independent investigations agree) — so this is
// keyed by a single "ticket policy id" rather than separate battle/refresh tables.
export const POLICY_FINGERPRINTS: readonly PolicyFingerprint[] = [
  // --- odin (44 seasons; season 1 excluded as a suspected dummy row) ---
  { network: "odin", policyId: 1, name: "[deprecated] Season", observedSeasons: { SEASON: [3, 5, 9, 11, 15, 17] } },
  { network: "odin", policyId: 2, name: "[deprecated] Off Season", observedSeasons: { OFF_SEASON: [2, 4, 6, 8, 10, 12, 14, 16, 18] } },
  { network: "odin", policyId: 3, name: "[deprecated] Championship", observedSeasons: { CHAMPIONSHIP: [7, 13] } },
  { network: "odin", policyId: 4, name: "new season", observedSeasons: { SEASON: [21, 23, 28, 30, 34, 36, 40, 42] } },
  { network: "odin", policyId: 5, name: "new offseason", observedSeasons: { OFF_SEASON: [20, 22, 24, 27, 29, 31, 33, 35, 37, 39, 41, 43, 45] } },
  { network: "odin", policyId: 6, name: "new Championship", observedSeasons: { CHAMPIONSHIP: [19, 25, 32, 38, 44] } },

  // --- heimdall (42 seasons; season 1 excluded as a suspected dummy row) ---
  { network: "heimdall", policyId: 1, name: "[deprecated] Season", observedSeasons: { SEASON: [5, 7, 11, 13, 17] } },
  { network: "heimdall", policyId: 2, name: "[deprecated] Off Season", observedSeasons: { OFF_SEASON: [2, 4, 6, 8, 10, 12, 14, 16, 18] } },
  { network: "heimdall", policyId: 3, name: "[deprecated] Championship", observedSeasons: { CHAMPIONSHIP: [3, 9, 15] } },
  { network: "heimdall", policyId: 4, name: "new Season", observedSeasons: { SEASON: [19, 23, 25, 29, 31, 36, 38, 42] } },
  { network: "heimdall", policyId: 5, name: "new OffSeason", observedSeasons: { OFF_SEASON: [20, 22, 24, 26, 28, 30, 32, 35, 37, 39, 41, 43] } },
  { network: "heimdall", policyId: 6, name: "new Championship", observedSeasons: { CHAMPIONSHIP: [21, 27, 33, 40] } },

  // --- thor (8 seasons; season 1 excluded as a suspected dummy row; policy 2/3 unused) ---
  { network: "thor", policyId: 4, name: "new season", observedSeasons: { SEASON: [4, 9] } },
  { network: "thor", policyId: 5, name: "new offseason", observedSeasons: { OFF_SEASON: [3, 5, 10] } },
  // The real counter-example: season 2 has a real block width (~6800 blocks, not a
  // dummy) and used the "Championship"-named policy for an OFF_SEASON.
  { network: "thor", policyId: 6, name: "new Championship", observedSeasons: { OFF_SEASON: [2], CHAMPIONSHIP: [11] } },
];

export interface FingerprintCheckResult {
  readonly ok: boolean;
  readonly level: "OK" | "WARN";
  readonly detail: string;
}

/** Checks (network, policyId, arenaType) against observed history. Always WARN at worst —
 *  see module doc comment for why this can never be FATAL. */
export function checkPolicyFingerprint(
  network: "odin" | "heimdall" | "thor",
  policyId: number,
  arenaType: ArenaSeasonType,
): FingerprintCheckResult {
  const fp = POLICY_FINGERPRINTS.find((f) => f.network === network && f.policyId === policyId);
  if (!fp) {
    return {
      ok: false,
      level: "WARN",
      detail: `${network} policy id ${policyId}는 관측 데이터에 없는 값입니다 — 신규 정책이거나 오타일 수 있습니다. 백오피스 Policy 화면에서 직접 확인하세요.`,
    };
  }

  const observedTypes = Object.keys(fp.observedSeasons) as ArenaSeasonType[];
  const seasonsForThisType = fp.observedSeasons[arenaType] ?? [];

  if (observedTypes.length === 1 && observedTypes[0] === arenaType) {
    return {
      ok: true,
      level: "OK",
      detail: `${network} policy id ${policyId}("${fp.name}")는 지금까지 ${arenaType}에서만 관측됐습니다 (${seasonsForThisType.length}개 시즌).`,
    };
  }

  if (seasonsForThisType.length > 0) {
    // Matches this type, but ALSO observed with a different type elsewhere — thor id=6 case.
    const others = observedTypes.filter((t) => t !== arenaType);
    return {
      ok: false,
      level: "WARN",
      detail: `${network} policy id ${policyId}("${fp.name}")는 ${arenaType}에서도 쓰였지만(${seasonsForThisType.length}개 시즌), ${others.join("/")}에서도 관측된 적 있습니다 — "이름=타입" 관습이 이 정책에서는 깨져 있습니다. 담당자 확인 필요.`,
    };
  }

  return {
    ok: false,
    level: "WARN",
    detail: `${network} policy id ${policyId}("${fp.name}")는 지금까지 ${observedTypes.join("/")}에서만 관측됐고 ${arenaType}에서 쓰인 적은 없습니다. 오타 의심 — 백오피스 Policy 화면에서 직접 확인하세요.`,
  };
}
