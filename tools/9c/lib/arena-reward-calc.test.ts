/**
 * Golden-fixture regression test for the pure reward-table calculator.
 *
 * Truth source: tools/9c/fixtures/arena-reward-table.golden.json (Odin S39 / Heimdall CS9,
 * cross-checked against two independently produced answers and this session's own live
 * odin-arena.9c.gg / heimdall-arena.9c.gg queries — see
 * .claude/skills/arena-reward-table/references/fixtures/golden-fixture-answer-1.md).
 *
 * If ArenaRewardService's formula ever changes, this is where it should break first.
 */
import { describe, expect, test } from "bun:test";
import golden from "../fixtures/arena-reward-table.golden.json";
import {
  checkInvariants,
  convertTierGroupsToRewardTiers,
  generateTierGroups,
  type RewardConfig,
} from "./arena-reward-calc";

const PAID_KEYS = [
  ["basic", "basicReward"],
  ["staking2", "staking2Reward"],
  ["staking3", "staking3Reward"],
  ["couragePass", "couragePassReward"],
  ["couragePassStaking2", "couragePassAndStaking2Reward"],
  ["couragePassStaking3", "couragePassAndStaking3Reward"],
] as const;

for (const fixture of golden.fixtures) {
  describe(fixture.label, () => {
    const cfg = fixture.inputs.config;
    const config: RewardConfig = {
      rankingPool: cfg.rankingPool,
      stakingLv2Multiplier: cfg.stakingLv2Multiplier,
      stakingLv3Multiplier: cfg.stakingLv3Multiplier,
      couragePassMultiplier: cfg.couragePassMultiplier,
      groupDefinitions: cfg.players.map((playerCount, i) => ({
        playerCount,
        rewardPercentage: cfg.percentages[i],
      })),
    };

    const groups = generateTierGroups(config);
    const tiers = convertTierGroupsToRewardTiers(groups, config);

    test("produces the right number of groups/tiers", () => {
      expect(groups.length).toBe(fixture.expected.groups.length);
      expect(tiers.length).toBe(fixture.expected.groups.length);
    });

    fixture.expected.groups.forEach((expectedGroup, i) => {
      test(`group ${expectedGroup.rankGroup}: groupReward + all 6 paid cells`, () => {
        const group = groups[i];
        const tier = tiers[i];
        expect(group.rankGroup).toBe(expectedGroup.rankGroup);
        expect(group.groupReward).toBeCloseTo(expectedGroup.groupReward, 6);

        for (const [paidKey, tierKey] of PAID_KEYS) {
          const paid =
            tierKey === "basicReward"
              ? tier.basicReward
              : tier.basicReward + (tier as unknown as Record<string, number>)[tierKey];
          expect(paid).toBe((expectedGroup.paid as Record<string, number>)[paidKey]);
        }

        const storedExpected = expectedGroup.storedTier as Record<string, number>;
        expect(tier.basicReward).toBe(storedExpected.basicReward);
        expect(tier.staking2Reward).toBe(storedExpected.staking2Reward);
        expect(tier.staking3Reward).toBe(storedExpected.staking3Reward);
        expect(tier.couragePassReward).toBe(storedExpected.couragePassReward);
        expect(tier.couragePassAndStaking2Reward).toBe(storedExpected.couragePassAndStaking2Reward);
        expect(tier.couragePassAndStaking3Reward).toBe(storedExpected.couragePassAndStaking3Reward);
      });
    });

    test("totals", () => {
      const playerCountSum = groups.reduce((s, g) => s + g.playerCount, 0);
      const percentageSum = groups.reduce((s, g) => s + g.rewardPercentage, 0);
      const groupRewardSum = groups.reduce((s, g) => s + g.groupReward, 0);
      expect(playerCountSum).toBe(fixture.expected.totals.playerCountSum);
      expect(percentageSum).toBe(fixture.expected.totals.percentageSum);
      expect(groupRewardSum).toBeCloseTo(fixture.expected.totals.groupRewardSum, 6);

      const maxPayout = groups.reduce((sum, g, i) => {
        const tier = tiers[i];
        return sum + g.playerCount * (tier.basicReward + tier.couragePassAndStaking3Reward);
      }, 0);
      expect(maxPayout).toBe(fixture.expected.totals.maxPayoutAfterTruncation);
      expect(config.rankingPool - maxPayout).toBe(fixture.expected.totals.truncationResidual);
    });

    test("invariants all pass (this config is known-good)", () => {
      const invariants = checkInvariants(config, groups);
      for (const expectedInv of fixture.expected.invariants) {
        const actual = invariants.find((i) => i.id === expectedInv.id);
        expect(actual, `missing invariant ${expectedInv.id}`).toBeDefined();
        expect(actual!.ok).toBe(expectedInv.ok);
      }
    });
  });
}

describe("invariant checks catch broken configs (not covered by the golden fixture)", () => {
  test("flags player-count sum != 500 as FATAL", () => {
    const config: RewardConfig = {
      rankingPool: 500_000,
      stakingLv2Multiplier: 0.5,
      stakingLv3Multiplier: 1.0,
      couragePassMultiplier: 1.0,
      groupDefinitions: [{ playerCount: 499, rewardPercentage: 100 }],
    };
    const groups = generateTierGroups(config);
    const invariants = checkInvariants(config, groups);
    const playersSum = invariants.find((i) => i.id === "players-sum")!;
    expect(playersSum.ok).toBe(false);
    expect(playersSum.level).toBe("FATAL");
  });

  test("flags percentage sum != 100 as FATAL", () => {
    const config: RewardConfig = {
      rankingPool: 500_000,
      stakingLv2Multiplier: 0.5,
      stakingLv3Multiplier: 1.0,
      couragePassMultiplier: 1.0,
      groupDefinitions: [{ playerCount: 500, rewardPercentage: 99 }],
    };
    const groups = generateTierGroups(config);
    const invariants = checkInvariants(config, groups);
    const pctSum = invariants.find((i) => i.id === "percent-sum")!;
    expect(pctSum.ok).toBe(false);
    expect(pctSum.level).toBe("FATAL");
  });
});

describe("rounding-boundary-risk WARN (C# decimal vs JS double)", () => {
  // Three cells the domain owner confirmed by directly running the live backend's
  // CalculateRewardsWithDynamicTable against this engine's golden-fixture config: the
  // backend paid 1 less than this engine computes, because the exact value sits exactly on
  // an integer and C# decimal / JS double round the intermediate division differently.
  // Real confirmed example: pool 400,000, group "6-9" — backend 6,999, this engine 7,000.
  const DEFAULT_GROUP_DEFS = [
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
  ];
  const baseConfig = (rankingPool: number): RewardConfig => ({
    rankingPool,
    stakingLv2Multiplier: 0.5,
    stakingLv3Multiplier: 1.0,
    couragePassMultiplier: 1.0,
    groupDefinitions: DEFAULT_GROUP_DEFS,
  });

  test.each([
    ["pool 200,000, group 1-2", 200_000, "1-2"],
    ["pool 250,000, group 6-9", 250_000, "6-9"],
    ["pool 400,000, group 6-9", 400_000, "6-9"],
  ])("%s: couragePassStaking3 is flagged as boundary-risk", (_label, rankingPool, rankGroup) => {
    const config = baseConfig(rankingPool);
    const groups = generateTierGroups(config);
    const tiers = convertTierGroupsToRewardTiers(groups, config);
    const tier = tiers[groups.findIndex((g) => g.rankGroup === rankGroup)];
    expect(tier.boundaryRiskFields).toContain("couragePassStaking3");

    const invariants = checkInvariants(config, groups);
    const risk = invariants.find((i) => i.id === "rounding-boundary-risk")!;
    expect(risk.ok).toBe(false);
    expect(risk.level).toBe("WARN");
    expect(risk.detail).toContain(rankGroup);
  });

  test("a genuinely fractional cell (not near a whole number) is not flagged", () => {
    // pool 400,000, group 51-87 (37 players, 18%): far from any integer boundary.
    const config = baseConfig(400_000);
    const groups = generateTierGroups(config);
    const tiers = convertTierGroupsToRewardTiers(groups, config);
    const tier = tiers[groups.findIndex((g) => g.rankGroup === "51-87")];
    expect(tier.boundaryRiskFields).toEqual([]);
  });

  test("clean config (no repeating-fraction division anywhere) has zero risk", () => {
    // Single group, playerCount and percentage chosen so every intermediate division
    // terminates exactly -- genuinely zero rounding-boundary risk, not just "not flagged
    // for this particular field".
    const config: RewardConfig = {
      rankingPool: 600_000,
      stakingLv2Multiplier: 0.5,
      stakingLv3Multiplier: 1.0,
      couragePassMultiplier: 1.0,
      groupDefinitions: [{ playerCount: 100, rewardPercentage: 100 }],
    };
    const groups = generateTierGroups(config);
    const invariants = checkInvariants(config, groups);
    const risk = invariants.find((i) => i.id === "rounding-boundary-risk")!;
    expect(risk.ok).toBe(true);
    expect(risk.level).toBe("OK");
  });
});
