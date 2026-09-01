/**
 * Unit test for the SVG builder only (not the PNG rasterizer — that's exercised
 * manually by generating tools/9c/arena-reward-table.ts --png against the golden
 * fixture seasons and visually checking the result; rasterization itself is
 * @resvg/resvg-js's job to get right, not this skill's).
 */
import { describe, expect, test } from "bun:test";
import golden from "../fixtures/arena-reward-table.golden.json";
import { convertTierGroupsToRewardTiers, generateTierGroups, type RewardConfig } from "./arena-reward-calc";
import { buildChampionshipTicketLines, buildSeasonTicketLines, formatRankLabel, renderRewardTableSvg } from "./arena-reward-png";

function flatten(lines: ReturnType<typeof buildSeasonTicketLines>): string {
  return lines.map((line) => line.map((seg) => seg.text).join("")).join(" / ");
}

describe("ticket info wording — confirmed against real screenshots (2026-09-01)", () => {
  test("SEASON: matches the real Odin screenshot verbatim (24 total / 4 per session)", () => {
    const text = flatten(buildSeasonTicketLines(24, 4));
    expect(text).toBe(
      "You can buy up to 24 tickets during the entire Season / " +
        "You can buy up to 4 extra tickets during each session (each refresh, or about 24 hours).",
    );
  });

  test("CHAMPIONSHIP: matches the real Heimdall CS9 screenshot verbatim (0 medals, 14 rounds, 10800 blocks)", () => {
    // This section is NOT about ticket purchases for CHAMPIONSHIP — it's medal
    // eligibility + round schedule. An earlier version of this function produced a
    // "you can buy up to N tickets" bullet here, which was never real (see the
    // function's doc comment in arena-reward-png.ts).
    const text = flatten(buildChampionshipTicketLines(0, 14, 10800));
    expect(text).toBe(
      "You need to collect 0 Medals during the Season to be eligible / " +
        "14 rounds per Championship, each round lasts about 24 hours (10,800 block interval)",
    );
  });
});

for (const fixture of golden.fixtures) {
  test(`${fixture.label}: SVG contains the title and every group's cell values`, () => {
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

    const svg = renderRewardTableSvg({
      title: fixture.expected.title,
      groups,
      tiers,
      rankingPool: config.rankingPool,
      season: { startBlock: fixture.inputs.season.startBlock, endBlock: fixture.inputs.season.endBlock },
    });

    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain(fixture.expected.title);
    expect(svg).toContain(fixture.inputs.season.startBlock.toLocaleString("en-US"));
    expect(svg).toContain(fixture.inputs.season.endBlock.toLocaleString("en-US"));

    for (const g of fixture.expected.groups) {
      expect(svg).toContain(`>${formatRankLabel(g.minRank, g.maxRank)}<`);
      expect(svg).toContain(`>${g.groupReward.toLocaleString("en-US")}<`);
      expect(svg).toContain(`>${g.paid.basic.toLocaleString("en-US")}<`);
      expect(svg).toContain(`>${g.paid.couragePassStaking3.toLocaleString("en-US")}<`);
    }
  });
}

describe("renderRewardTableSvg without season info", () => {
  test("omits block-info line but still renders a valid table", () => {
    const config: RewardConfig = {
      rankingPool: 100_000,
      stakingLv2Multiplier: 0.5,
      stakingLv3Multiplier: 1.0,
      couragePassMultiplier: 1.0,
      groupDefinitions: [{ playerCount: 500, rewardPercentage: 100 }],
    };
    const groups = generateTierGroups(config);
    const tiers = convertTierGroupsToRewardTiers(groups, config);
    const svg = renderRewardTableSvg({ title: "Test Table", groups, tiers, rankingPool: config.rankingPool, season: null });
    expect(svg).toContain("Test Table");
    expect(svg).not.toContain("Block ");
  });

  test("still renders operator-supplied ticketInfo even though season is null", () => {
    // Regression for a real bug: ticket info silently disappeared (no error) when live
    // season lookup failed (e.g. seasonGroupId=0 mid-registration), even though the
    // operator had explicitly confirmed and passed --ticket-total/--ticket-session.
    const config: RewardConfig = {
      rankingPool: 100_000,
      stakingLv2Multiplier: 0.5,
      stakingLv3Multiplier: 1.0,
      couragePassMultiplier: 1.0,
      groupDefinitions: [{ playerCount: 500, rewardPercentage: 100 }],
    };
    const groups = generateTierGroups(config);
    const tiers = convertTierGroupsToRewardTiers(groups, config);
    const svg = renderRewardTableSvg({
      title: "Test Table",
      groups,
      tiers,
      rankingPool: config.rankingPool,
      season: null,
      ticketInfo: { lines: [[{ text: "You can buy up to " }, { text: "5000", color: "amber" }, { text: " tickets" }]] },
    });
    expect(svg).toContain("Ticket");
    expect(svg).toContain("Information");
    expect(svg).toContain("5000");
  });
});
