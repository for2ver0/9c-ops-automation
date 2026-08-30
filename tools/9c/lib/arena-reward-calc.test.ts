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
    const tiers = convertTierGroupsToRewardTiers(groups);

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
