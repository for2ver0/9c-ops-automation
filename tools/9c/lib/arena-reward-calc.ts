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
  // Spec doc §5: this is a form-prefill initial value, not baseline. Live operational
  // value is 1.2 as of the golden-fixture derivation (2.2x multiplier on Courage Pass tier).
  // CODE_DEFAULT_CONFIG intentionally keeps the code's literal 1.0 — callers that want the
  // live baseline must pass it explicitly. Never silently substitute 1.2 here.
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
export function convertTierGroupsToRewardTiers(groups: readonly TierGroup[]): RewardTier[] {
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
  const tiers = convertTierGroupsToRewardTiers(tierGroups);
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

  return invariants;
}
