/**
 * Pure reward-table calculation for Nine Chronicles arena seasons.
 *
 * This mirrors NineChronicles.Backoffice's ArenaRewardService calculation chain
 * exactly (verified cell-for-cell against the Odin S39 / Heimdall CS9 golden
 * fixture in tools/9c/fixtures/arena-reward-table.golden.json):
 *
 *   GenerateTierGroups()            config -> per-group amounts (decimal, no truncation)
 *   ConvertTierGroupsToRewardTiers()  groups -> per-rank-range tiers (int truncation happens HERE)
 *   CalculateRewards()              per-user rank -> tier lookup -> staking/courage-pass bonus
 *
 * Source: ArenaRewardService.cs:557-628 (NineChronicles.Backoffice, main ba13ff5).
 * See references/backend-source/ in the arena-reward-table skill for the full C# source
 * this was translated from, and references/backend-source/calculation-chain-notes.md for
 * the domain owner's confirmed reading of it.
 *
 * This module does no I/O — it is deterministic given its inputs, which is what makes
 * the golden-fixture regression test in tools/9c/fixtures/verify-arena-reward-table.ts
 * possible without depending on a live ArenaService.
 */

export interface GroupDefinition {
  readonly playerCount: number;
  /** Percent, e.g. 7 means 7%. Matches ArenaRewardGroupDefinition.RewardPercentage. */
  readonly rewardPercentage: number;
}

export interface RewardConfig {
  /** The only pool actually used in calculation (ArenaRewardService.cs:568 GenerateTierGroups).
   *  `TotalPool`/`CompetitionPercentage` exist in the backend model but are inert — never read. */
  readonly rankingPool: number;
  readonly stakingLv2Multiplier: number;
  readonly stakingLv3Multiplier: number;
  readonly couragePassMultiplier: number;
  readonly groupDefinitions: readonly GroupDefinition[];
}

/** CreateDefault() values from ArenaRewardModels.cs:121-145 — code defaults, NOT necessarily
 *  the live operational baseline (see couragePassMultiplier note below). */
export const CODE_DEFAULT_CONFIG: RewardConfig = {
  rankingPool: 500_000,
  stakingLv2Multiplier: 0.5,
  stakingLv3Multiplier: 1.0,
  // Spec doc §5: this is a form-prefill initial value, not a stable baseline. Heimdall CS9
  // was confirmed at 1.2 via golden-fixture derivation (2.2x multiplier on Courage Pass
  // tier), but that is one season's observed value, not a constant — Odin S39 was never
  // confirmed the same way, and the value is known to vary by season/type (and the
  // backoffice's own displayed value can itself be stale). CODE_DEFAULT_CONFIG intentionally
  // keeps the code's literal 1.0 — callers must pass the current season's confirmed value
  // explicitly. Never silently substitute 1.2 (or any other remembered value) here.
  couragePassMultiplier: 1.0,
  groupDefinitions: [
    { playerCount: 2, rewardPercentage: 7 },
    { playerCount: 3, rewardPercentage: 8 },
    { playerCount: 4, rewardPercentage: 7 },
    { playerCount: 6, rewardPercentage: 9 },
    { playerCount: 10, rewardPercentage: 12 },
    { playerCount: 25, rewardPercentage: 18 },
    { playerCount: 37, rewardPercentage: 18 },
    { playerCount: 38, rewardPercentage: 12 },
    { playerCount: 125, rewardPercentage: 6 },
    { playerCount: 250, rewardPercentage: 3 },
  ],
};

export interface TierGroup {
  readonly rankGroup: string; // "min-max"
  readonly minRank: number;
  readonly maxRank: number;
  readonly playerCount: number;
  readonly rewardPercentage: number;
  readonly groupReward: number;
  readonly eachPlayerGetsNone: number;
  readonly eachPlayerGetsStakingLv2: number;
  readonly eachPlayerGetsStakingLv3: number;
  readonly eachPlayerGetsCouragePass: number;
  readonly eachPlayerGetsStakingLv2Courage: number;
  readonly eachPlayerGetsStakingLv3Courage: number;
  /** Mathematically always equal to groupReward (playerCount * eachPlayerGetsNone * (1+lv3+cp)
   *  collapses back to groupReward by construction) — kept as a field to match the backend
   *  shape and to make that invariant checkable rather than assumed. */
  readonly fullSum: number;
}

/** Which of the 6 paid amounts a group's rounding is boundary-sensitive on — see
 *  `boundaryRiskFields` below. Field names match RewardTier's "paid" keys, not its
 *  stored-delta keys. */
export type PaidField =
  | "basic"
  | "staking2"
  | "staking3"
  | "couragePass"
  | "couragePassStaking2"
  | "couragePassStaking3";

export interface RewardTier {
  readonly rankRangeMin: number;
  readonly rankRangeMax: number;
  readonly basicReward: number;
  /** Stored as a DELTA over basicReward, not the full per-condition amount — matches
   *  ConvertTierGroupsToRewardTiers exactly. paid amount = basicReward + <condition>Reward. */
  readonly staking2Reward: number;
  readonly staking3Reward: number;
  readonly couragePassReward: number;
  readonly couragePassAndStaking2Reward: number;
  readonly couragePassAndStaking3Reward: number;
  /** Paid amounts whose exact (infinite-precision) value lands on — or extremely close to —
   *  a whole number. CONFIRMED 2026-08-31: in that situation, this engine's IEEE-754 double
   *  arithmetic and the live backend's C# `decimal` arithmetic (ArenaRewardService.cs, all
   *  fields `decimal`) can round the intermediate division differently and disagree by
   *  exactly 1 on the floored result. Real example, reproduced by directly running
   *  CalculateRewardsWithDynamicTable: pool 400,000, group "6-9", courage+staking-lv3 —
   *  this engine floors to 7000 (the mathematically exact value), the live backend floors to
   *  6999. This engine is not "wrong" here — 7000 IS the exact value — but the backend's
   *  actual payout is what operators need to know, so cells landing on this boundary are
   *  flagged rather than silently trusted. See checkInvariants' "rounding-boundary-risk"
   *  entry and the arena-reward-table skill's SKILL.md for the fuller writeup. */
  readonly boundaryRiskFields: readonly PaidField[];
}

// --- Exact rational arithmetic (BigInt numerator/denominator) for boundary-risk detection ---
//
// An epsilon-based "is this double close to an integer" check cannot tell a genuinely exact
// division (e.g. 6000/3 = 2000, no rounding possible in any base) apart from a division that
// only LOOKS exact because this engine's specific double rounding happened to land back on
// the integer (e.g. 7000/3*3 prints as exactly 7000 in JS, yet the live C# decimal backend
// computes the same formula as 6999 for that exact case — confirmed 2026-08-31). Both cases
// are numerically indistinguishable from the computed double value alone. Exact fractions
// sidestep the problem entirely: a value is representable with zero rounding error in IEEE-754
// double iff its reduced denominator is a power of 2, and in C# `decimal` (base-10) iff its
// reduced denominator's only prime factors are 2 and 5 — so "denominator is a power of 2" is
// sufic­ient for BOTH engines to agree exactly, and is the only case this code treats as safe.
interface Frac {
  readonly num: bigint;
  readonly den: bigint; // always > 0
}

function gcdBig(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) {
    [a, b] = [b, a % b];
  }
  return a === 0n ? 1n : a;
}

function simplifyFrac(num: bigint, den: bigint): Frac {
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const g = gcdBig(num, den);
  return { num: num / g, den: den / g };
}

function mulFrac(a: Frac, b: Frac): Frac {
  return simplifyFrac(a.num * b.num, a.den * b.den);
}

function divFrac(a: Frac, b: Frac): Frac {
  return simplifyFrac(a.num * b.den, a.den * b.num);
}

function addFrac(a: Frac, b: Frac): Frac {
  return simplifyFrac(a.num * b.den + b.num * a.den, a.den * b.den);
}

const ONE_FRAC: Frac = { num: 1n, den: 1n };

/** Exact conversion of a "human decimal" (config values: pool, percentages, player counts,
 *  multipliers) to a fraction, via string round-tripping rather than binary inspection — a
 *  double like 1.2 is not exactly 1.2 in memory, but `(1.2).toString()` reliably gives back
 *  "1.2" for any value this domain actually produces (typed literals, JSON, or CLI-parsed
 *  numbers with at most a few decimal digits), which is what we want to reason about exactly. */
function decimalToFraction(x: number): Frac {
  const s = x.toString();
  if (s.includes("e") || s.includes("E")) {
    throw new Error(`decimalToFraction: unsupported exponential notation for ${x}`);
  }
  const negative = s.startsWith("-");
  const abs = negative ? s.slice(1) : s;
  const dotIndex = abs.indexOf(".");
  if (dotIndex === -1) {
    return simplifyFrac(BigInt(abs) * (negative ? -1n : 1n), 1n);
  }
  const digits = abs.slice(0, dotIndex) + abs.slice(dotIndex + 1);
  const den = 10n ** BigInt(abs.length - dotIndex - 1);
  return simplifyFrac(BigInt(digits) * (negative ? -1n : 1n), den);
}

function isPowerOfTwo(n: bigint): boolean {
  return n > 0n && (n & (n - 1n)) === 0n;
}

function fieldFactorFractions(config: RewardConfig): Record<PaidField, Frac> {
  const lv2 = decimalToFraction(config.stakingLv2Multiplier);
  const lv3 = decimalToFraction(config.stakingLv3Multiplier);
  const cp = decimalToFraction(config.couragePassMultiplier);
  return {
    basic: ONE_FRAC,
    staking2: addFrac(ONE_FRAC, lv2),
    staking3: addFrac(ONE_FRAC, lv3),
    couragePass: addFrac(ONE_FRAC, cp),
    couragePassStaking2: addFrac(addFrac(ONE_FRAC, lv2), cp),
    couragePassStaking3: addFrac(addFrac(ONE_FRAC, lv3), cp),
  };
}

/** A paid amount is boundary-sensitive only when BOTH: (1) the group's eachPlayerGetsNone
 *  division is not exactly representable in double (equivalently: its reduced denominator is
 *  not a power of 2 — see the module-level comment above), so at least one of this engine /
 *  the live decimal backend must round it, AND (2) that specific field's true
 *  (infinite-precision) value is exactly a whole number, so a rounding nudge in either
 *  direction changes which integer Math.floor()/`(int)` lands on. Real confirmed example:
 *  pool 400,000, group "6-9", courage+staking-lv3 — this engine floors to 7000, the live
 *  backend floors to 6999 (verified 2026-08-31 by directly running
 *  CalculateRewardsWithDynamicTable). See RewardTier.boundaryRiskFields and the
 *  arena-reward-table skill's SKILL.md for the fuller writeup. */
function computeBoundaryRiskFields(group: TierGroup, config: RewardConfig): PaidField[] {
  const groupReward = divFrac(
    mulFrac(decimalToFraction(config.rankingPool), decimalToFraction(group.rewardPercentage)),
    decimalToFraction(100),
  );
  const playerCount = decimalToFraction(group.playerCount);
  const factors = fieldFactorFractions(config);
  const eachPlayerGetsNone = divFrac(divFrac(groupReward, playerCount), factors.couragePassStaking3);

  if (isPowerOfTwo(eachPlayerGetsNone.den)) {
    return []; // exact in both double and decimal -- no field can be at risk
  }

  const risky: PaidField[] = [];
  for (const field of Object.keys(factors) as PaidField[]) {
    const trueValue = mulFrac(eachPlayerGetsNone, factors[field]);
    if (trueValue.den === 1n) {
      risky.push(field);
    }
  }
  return risky;
}

/** GenerateTierGroups() — ArenaRewardService.cs:557-599. All decimal, no truncation.
 *  Note: the backend's `totalPlayers` parameter is accepted but never read in the body
 *  (confirmed by the domain owner) — group composition comes entirely from
 *  config.groupDefinitions. We omit that unused parameter here rather than replicate it. */
export function generateTierGroups(config: RewardConfig): TierGroup[] {
  const groups: TierGroup[] = [];
  let currentRank = 1;

  for (const def of config.groupDefinitions) {
    const { playerCount, rewardPercentage } = def;
    const maxRank = currentRank + playerCount - 1;

    const groupReward = (config.rankingPool * rewardPercentage) / 100;
    const eachPlayerGetsNone =
      groupReward / playerCount / (1 + config.stakingLv3Multiplier + config.couragePassMultiplier);

    groups.push({
      rankGroup: `${currentRank}-${maxRank}`,
      minRank: currentRank,
      maxRank,
      playerCount,
      rewardPercentage,
      groupReward,
      eachPlayerGetsNone,
      eachPlayerGetsStakingLv2: eachPlayerGetsNone * (1 + config.stakingLv2Multiplier),
      eachPlayerGetsStakingLv3: eachPlayerGetsNone * (1 + config.stakingLv3Multiplier),
      eachPlayerGetsCouragePass: eachPlayerGetsNone * (1 + config.couragePassMultiplier),
      eachPlayerGetsStakingLv2Courage:
        eachPlayerGetsNone * (1 + config.stakingLv2Multiplier + config.couragePassMultiplier),
      eachPlayerGetsStakingLv3Courage:
        eachPlayerGetsNone * (1 + config.stakingLv3Multiplier + config.couragePassMultiplier),
      fullSum:
        playerCount *
        eachPlayerGetsNone *
        (1 + config.stakingLv3Multiplier + config.couragePassMultiplier),
    });

    currentRank = maxRank + 1;
  }

  return groups;
}

/** ConvertTierGroupsToRewardTiers() — ArenaRewardService.cs:601-628. The ONLY place
 *  truncation happens. Each condition is floored independently, then basicReward is
 *  subtracted to get the stored delta — this is why bonuses can be off by up to 1 unit
 *  from "exactly basic * multiplier" (each floors separately). */
export function convertTierGroupsToRewardTiers(
  groups: readonly TierGroup[],
  config: RewardConfig,
): RewardTier[] {
  return groups
    .map((g): RewardTier => {
      const basicReward = Math.floor(g.eachPlayerGetsNone);
      return {
        rankRangeMin: g.minRank,
        rankRangeMax: g.maxRank,
        basicReward,
        staking2Reward: Math.floor(g.eachPlayerGetsStakingLv2) - basicReward,
        staking3Reward: Math.floor(g.eachPlayerGetsStakingLv3) - basicReward,
        couragePassReward: Math.floor(g.eachPlayerGetsCouragePass) - basicReward,
        couragePassAndStaking2Reward: Math.floor(g.eachPlayerGetsStakingLv2Courage) - basicReward,
        couragePassAndStaking3Reward: Math.floor(g.eachPlayerGetsStakingLv3Courage) - basicReward,
        boundaryRiskFields: computeBoundaryRiskFields(g, config),
      };
    })
    .sort((a, b) => a.rankRangeMin - b.rankRangeMin);
}

/** GetStakingLevel() — ArenaRewardService.cs:~500. No level 1 exists in the source. */
export function getStakingLevel(deposit: number): 0 | 2 | 3 {
  if (deposit >= 5000) return 3;
  if (deposit >= 500) return 2;
  return 0;
}

export class RewardEntryNotFoundError extends Error {
  constructor(public readonly rank: number) {
    super(`랭크 ${rank}에 대한 리워드 엔트리를 찾을 수 없습니다.`);
  }
}

/** GetRewardEntryForRank() — linear scan, first match wins. Throws (caller should skip,
 *  matching CalculateRewards' catch-and-continue) when rank falls outside every tier's range
 *  — e.g. rank 501+ when the table only covers 1-500. */
export function getRewardEntryForRank(rank: number, tiers: readonly RewardTier[]): RewardTier {
  for (const tier of tiers) {
    if (rank >= tier.rankRangeMin && rank <= tier.rankRangeMax) return tier;
  }
  throw new RewardEntryNotFoundError(rank);
}

/** GetStakingBonus() — priority order matches the source exactly: courage+staking3 beats
 *  courage+staking2 beats courage-alone beats staking3-alone beats staking2-alone beats none. */
export function getStakingBonus(
  tier: RewardTier,
  stakingLevel: 0 | 2 | 3,
  hasCouragePass: boolean,
): number {
  if (stakingLevel === 3 && hasCouragePass) return tier.couragePassAndStaking3Reward;
  if (stakingLevel === 2 && hasCouragePass) return tier.couragePassAndStaking2Reward;
  if (hasCouragePass) return tier.couragePassReward;
  if (stakingLevel === 3) return tier.staking3Reward;
  if (stakingLevel === 2) return tier.staking2Reward;
  return 0;
}

export interface RankingEntry {
  readonly avatarAddress: string;
  readonly agentAddress: string;
  readonly nameWithHash: string;
  readonly rank: number;
  readonly score: number;
  readonly totalWin: number;
  readonly totalLose: number;
  readonly level: number;
}

export interface StakeEntry {
  readonly agentAddress: string;
  readonly deposit: number;
}

export interface CouragePassEntry {
  readonly avatarAddress: string;
  readonly agentAddress: string;
}

export interface RewardResult {
  readonly name: string;
  readonly rank: number;
  readonly score: number;
  readonly winCount: number;
  readonly lossCount: number;
  readonly avatarLevel: number;
  readonly agentAddress: string;
  readonly avatarAddress: string;
  readonly stakingLevel: 0 | 2 | 3;
  readonly hasCouragePass: boolean;
  readonly basicRewardAmount: number;
  readonly stakingBonus: number;
  readonly totalRewardAmount: number;
}

/** ExtractNameFromHash() — everything before the first space. */
export function extractNameFromHash(nameWithHash: string): string {
  if (!nameWithHash) return "";
  const spaceIndex = nameWithHash.indexOf(" ");
  return spaceIndex > 0 ? nameWithHash.slice(0, spaceIndex) : nameWithHash;
}

export interface CalculateRewardsResult {
  readonly results: RewardResult[];
  /** Ranks that fell outside every tier range and were silently skipped by the backend
   *  (RewardEntryNotFoundException -> catch -> continue). Surfacing these is the whole
   *  point of this skill existing per the spec doc — the backend does NOT report them. */
  readonly skippedRanks: number[];
}

/** CalculateRewards() — matching key is AgentAddress for staking, AvatarAddress for
 *  courage pass. These are genuinely different address axes; do not conflate them. */
export function calculateRewards(
  tiers: readonly RewardTier[],
  rankings: readonly RankingEntry[],
  stakings: readonly StakeEntry[],
  couragePasses: readonly CouragePassEntry[],
): CalculateRewardsResult {
  const stakingByAgent = new Map<string, StakeEntry>();
  for (const s of stakings) {
    if (s.agentAddress) stakingByAgent.set(s.agentAddress.toLowerCase(), s);
  }
  const couragePassByAvatar = new Set<string>();
  for (const c of couragePasses) {
    couragePassByAvatar.add(c.avatarAddress.toLowerCase());
  }

  const results: RewardResult[] = [];
  const skippedRanks: number[] = [];

  for (const ranking of rankings) {
    let tier: RewardTier;
    try {
      tier = getRewardEntryForRank(ranking.rank, tiers);
    } catch (e) {
      if (e instanceof RewardEntryNotFoundError) {
        skippedRanks.push(ranking.rank);
        continue;
      }
      throw e;
    }

    const staking = stakingByAgent.get(ranking.agentAddress.toLowerCase());
    const stakingLevel = getStakingLevel(staking ? staking.deposit : 0);
    const hasCouragePass = couragePassByAvatar.has(ranking.avatarAddress.toLowerCase());
    const stakingBonus = getStakingBonus(tier, stakingLevel, hasCouragePass);

    results.push({
      name: extractNameFromHash(ranking.nameWithHash),
      rank: ranking.rank,
      score: ranking.score,
      winCount: ranking.totalWin,
      lossCount: ranking.totalLose,
      avatarLevel: ranking.level,
      agentAddress: ranking.agentAddress,
      avatarAddress: ranking.avatarAddress,
      stakingLevel,
      hasCouragePass,
      basicRewardAmount: tier.basicReward,
      stakingBonus,
      totalRewardAmount: tier.basicReward + stakingBonus,
    });
  }

  results.sort((a, b) => a.rank - b.rank);
  return { results, skippedRanks };
}

export interface Invariant {
  readonly id: string;
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  /** OK | WARN | FATAL per the spec doc's 6-2 judging criteria. */
  readonly level: "OK" | "WARN" | "FATAL";
}

/** Invariant checks the backend does NOT perform (confirmed: ArenaRewardService.cs
 *  validates neither the 500-player sum nor the 100% percentage sum) — this skill's
 *  entire justification for existing on the calculation side. See spec doc §6-2. */
export function checkInvariants(config: RewardConfig, tierGroups: readonly TierGroup[]): Invariant[] {
  const invariants: Invariant[] = [];

  const playerSum = config.groupDefinitions.reduce((sum, g) => sum + g.playerCount, 0);
  invariants.push({
    id: "players-sum",
    name: "sum(playerCount) == 500",
    ok: playerSum === 500,
    detail: String(playerSum),
    level: playerSum === 500 ? "OK" : "FATAL",
  });

  const percentSum = config.groupDefinitions.reduce((sum, g) => sum + g.rewardPercentage, 0);
  invariants.push({
    id: "percent-sum",
    name: "sum(rewardPercentage) == 100",
    ok: percentSum === 100,
    detail: `${percentSum}%`,
    level: percentSum === 100 ? "OK" : "FATAL",
  });

  const groupRewardSum = tierGroups.reduce((sum, g) => sum + g.groupReward, 0);
  const groupRewardOk = Math.abs(groupRewardSum - config.rankingPool) < 1e-9;
  invariants.push({
    id: "group-reward-sum",
    name: "sum(groupReward) == RankingPool",
    ok: groupRewardOk,
    detail: `${groupRewardSum} vs pool ${config.rankingPool}`,
    level: groupRewardOk ? "OK" : "FATAL",
  });

  // Upper bound, not equality — every player would need staking lv3 + courage pass to
  // reach it, and int truncation shaves a little more off even then. See spec doc §6:
  // "실지급 ≤ 총 풀... 등호로 두면 매 시즌 오탐이 난다".
  const tiers = convertTierGroupsToRewardTiers(tierGroups, config);
  const maxPayout = tierGroups.reduce((sum, g) => {
    const tier = tiers.find((t) => t.rankRangeMin === g.minRank)!;
    return sum + g.playerCount * (tier.basicReward + tier.couragePassAndStaking3Reward);
  }, 0);
  const payoutOk = maxPayout <= config.rankingPool;
  invariants.push({
    id: "payout-upper-bound",
    name: "maxPayout <= RankingPool (등호 아님)",
    ok: payoutOk,
    detail: `max ${maxPayout} vs pool ${config.rankingPool} (residual ${config.rankingPool - maxPayout})`,
    level: payoutOk ? "OK" : "FATAL",
  });

  // CONFIRMED 2026-08-31 by directly running the live backend's
  // CalculateRewardsWithDynamicTable: pool 400,000 group "6-9" courage+staking-lv3 pays
  // 6,999 there but this engine computes 7,000 — both are "correct" reads of the same
  // formula, they just round the intermediate C# decimal / JS double division differently
  // when the exact value sits on a whole-number boundary. See RewardTier.boundaryRiskFields.
  const boundaryRiskGroups = tierGroups
    .map((g, i) => ({ group: g, tier: tiers[i]! }))
    .filter(({ tier }) => tier.boundaryRiskFields.length > 0);
  invariants.push({
    id: "rounding-boundary-risk",
    name: "부동소수점 반올림 경계값 없음",
    ok: boundaryRiskGroups.length === 0,
    detail:
      boundaryRiskGroups.length === 0
        ? "없음"
        : boundaryRiskGroups
            .map(({ group, tier }) => `${group.rankGroup}(${tier.boundaryRiskFields.join(",")})`)
            .join("; ") +
          " — 이 칸들은 실제 값(정수)에 정확히 걸쳐 있어 백엔드(C# decimal)와 ±1 차이가 날 수 있습니다. 실지급 확정 전 백오피스 값과 대조하세요.",
    level: boundaryRiskGroups.length === 0 ? "OK" : "WARN",
  });

  return invariants;
}
