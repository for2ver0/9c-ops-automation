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
  calculateRewards,
  checkInvariants,
  convertTierGroupsToRewardTiers,
  generateTierGroups,
  type RewardConfig,
  type RewardTier,
  type RankingEntry,
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

describe("calculateRewards address matching", () => {
  const tiers: RewardTier[] = [
    {
      rankRangeMin: 1,
      rankRangeMax: 1,
      basicReward: 100,
      staking2Reward: 10,
      staking3Reward: 20,
      couragePassReward: 5,
      couragePassAndStaking2Reward: 15,
      couragePassAndStaking3Reward: 25,
      boundaryRiskFields: [],
    },
  ];
  const ranking: RankingEntry = {
    avatarAddress: "0xAbCdEf0000000000000000000000000000000f",
    agentAddress: "0xAbCdEf0000000000000000000000000000000a",
    nameWithHash: "Player 123",
    rank: 1,
    score: 1000,
    totalWin: 1,
    totalLose: 0,
    level: 1,
  };

  test("staking match is case-insensitive (backend keys it by a Libplanet Address struct)", () => {
    const { results } = calculateRewards(
      tiers,
      [ranking],
      [{ agentAddress: ranking.agentAddress.toUpperCase(), deposit: 100_000 }],
      [],
    );
    expect(results[0].stakingLevel).not.toBe(0);
  });

  test("courage pass match is case-SENSITIVE (backend keys it by a plain C# string), unlike staking", () => {
    // Regression: an earlier version lowercased both sides here, which disagreed with the live
    // backend (ArenaRewardService.cs couragePassByAvatar.ToDictionary(c => c.AvatarAddress, ...) —
    // no case normalization) whenever a leaderboard API and the courage-pass source used
    // differently-cased hex for the same avatar.
    const { results } = calculateRewards(tiers, [ranking], [], [{ avatarAddress: ranking.avatarAddress.toUpperCase(), agentAddress: ranking.agentAddress }]);
    expect(results[0].hasCouragePass).toBe(false);
  });

  test("courage pass matches when casing is identical", () => {
    const { results } = calculateRewards(tiers, [ranking], [], [{ avatarAddress: ranking.avatarAddress, agentAddress: ranking.agentAddress }]);
    expect(results[0].hasCouragePass).toBe(true);
  });
});

// --- 2026-09-03 "조용한 OK" 점검 회귀 ------------------------------------------------------
// 기존 불변식은 "합이 맞는가"만 봤기 때문에 풀·배수가 0이나 음수여도 전부 OK로 통과했다.
// 합 검사는 구조적으로 이걸 못 잡는다(0의 합은 0, 음수의 합은 그 음수라 "합이 맞다"가 참).
// 실측: --pool 0 → 전원 0원 표 / --pool -400000 → 1-1 그룹 -28,000 표 / --staking-lv2 -2 →
// 그 등급만 -9,334. 셋 다 불변식 전부 OK에 exit 0이었고, 그 표가 그대로 PNG·공지가 된다.

const OK_GROUPS = [
  { playerCount: 1, rewardPercentage: 7 },
  { playerCount: 1, rewardPercentage: 8 },
  { playerCount: 3, rewardPercentage: 7 },
  { playerCount: 5, rewardPercentage: 9 },
  { playerCount: 10, rewardPercentage: 12 },
  { playerCount: 30, rewardPercentage: 18 },
  { playerCount: 50, rewardPercentage: 18 },
  { playerCount: 100, rewardPercentage: 12 },
  { playerCount: 150, rewardPercentage: 6 },
  { playerCount: 150, rewardPercentage: 3 },
];

function configWith(over: Partial<RewardConfig>): RewardConfig {
  return {
    rankingPool: 400_000,
    stakingLv2Multiplier: 0.5,
    stakingLv3Multiplier: 1.0,
    couragePassMultiplier: 1.0,
    groupDefinitions: OK_GROUPS,
    ...over,
  };
}

describe("입력 정의역 불변식 (2026-09-03 추가)", () => {
  test("풀이 0이면 FATAL — 전원 0원 표가 '정상'으로 나오던 자리", () => {
    const config = configWith({ rankingPool: 0 });
    const inv = checkInvariants(config, generateTierGroups(config)).find((i) => i.id === "pool-positive")!;
    expect(inv.level).toBe("FATAL");
  });

  test("풀이 음수면 FATAL — 전원 마이너스 지급 표가 나오던 자리", () => {
    const config = configWith({ rankingPool: -400_000 });
    const inv = checkInvariants(config, generateTierGroups(config)).find((i) => i.id === "pool-positive")!;
    expect(inv.level).toBe("FATAL");
  });

  test("배수가 음수면 FATAL — 그 등급만 마이너스 지급되던 자리", () => {
    const config = configWith({ stakingLv2Multiplier: -2 });
    const inv = checkInvariants(config, generateTierGroups(config)).find((i) => i.id === "multipliers-positive")!;
    expect(inv.level).toBe("FATAL");
    expect(inv.detail).toContain("stakingLv2Multiplier=-2");
  });

  test("배수가 0이어도 FATAL — 그 등급이 0원이 된다", () => {
    const config = configWith({ couragePassMultiplier: 0 });
    const inv = checkInvariants(config, generateTierGroups(config)).find((i) => i.id === "multipliers-positive")!;
    expect(inv.level).toBe("FATAL");
  });

  test("1 미만 배수는 정상 — 실측 관측값(stakingLv2=0.5, couragePass=1.2)을 막으면 안 된다", () => {
    const config = configWith({ stakingLv2Multiplier: 0.5, stakingLv3Multiplier: 1, couragePassMultiplier: 1.2 });
    const invs = checkInvariants(config, generateTierGroups(config));
    expect(invs.find((i) => i.id === "multipliers-positive")!.level).toBe("OK");
    expect(invs.find((i) => i.id === "pool-positive")!.level).toBe("OK");
  });
});
