// SOURCE: NineChronicles.Backoffice / Models/ArenaRewardModels.cs
// Full file (169 lines), file's last commit 630154e (2025-12-18), as of main ba13ff5.
// Pasted verbatim by the domain owner on 2026-08-30 as grounding reference for the
// arena-reward-table skill's config/model shapes.
//
// Two things the owner flagged when reading this:
// - `CompetitionPercentage` is never read anywhere in this file to compute `RankingPool`.
//   Default values happen to have TotalPool == RankingPool == 500000 and
//   CompetitionPercentage == 100, which makes them coincide — but ArenaRewardService only
//   ever reads `RankingPool`. Treating CompetitionPercentage as load-bearing would be wrong.
// - `CouragePassEntry` duplicates its CSV column names in two places: the `[Name(...)]`
//   attributes AND `CouragePassEntryMap` (avatar_addr / product_id / agent_Addr — note the
//   last one has a capital A, inconsistent with the other two). Works fine as-is, but if the
//   column name ever needs to change, both places need editing together.

using System.ComponentModel.DataAnnotations;
using CsvHelper.Configuration;
using CsvHelper.Configuration.Attributes;
using Microsoft.AspNetCore.Components.Forms;

namespace NineChronicles.Backoffice.Models;

public class RewardEntryNotFoundException : Exception
{
    public int Rank { get; }

    public RewardEntryNotFoundException(int rank)
        : base($"랭크 {rank}에 대한 리워드 엔트리를 찾을 수 없습니다.")
    {
        Rank = rank;
    }
}

public class ArenaRewardTier
{
    public int RankRangeMin { get; set; }
    public int RankRangeMax { get; set; }
    public int BasicReward { get; set; }
    public int Staking2Reward { get; set; }
    public int Staking3Reward { get; set; }
    public int CouragePassReward { get; set; }
    public int CouragePassAndStaking2Reward { get; set; }
    public int CouragePassAndStaking3Reward { get; set; }
}

public class ArenaRankingEntry
{
    public string AvatarAddress { get; set; }
    public string AgentAddress { get; set; }
    public string NameWithHash { get; set; }
    public int Ranking { get; set; }
    public int Score { get; set; }
    public int TotalWin { get; set; }
    public int TotalLose { get; set; }
    public int Level { get; set; }
}

public class CouragePassEntry
{
    [Name("avatar_addr")]
    public string AvatarAddress { get; set; } = string.Empty;

    [Name("product_id")]
    public string ProductId { get; set; } = string.Empty;

    [Name("agent_Addr")]
    public string AgentAddress { get; set; } = string.Empty;
}

public class ArenaRewardResult
{
    public string Name { get; set; } = string.Empty;
    public int Rank { get; set; }
    public int Score { get; set; }
    public int WinCount { get; set; }
    public int LossCount { get; set; }
    public int AvatarLevel { get; set; }
    public string AgentAddress { get; set; } = string.Empty;
    public int StakingBonus { get; set; }
    public string AvatarAddress { get; set; } = string.Empty;
    public int BasicRewardAmount { get; set; }
    public int TotalRewardAmount { get; set; }
    public int StakingLevel { get; set; }
    public bool HasCouragePass { get; set; }
}

public class ArenaRewardCalculationRequest
{
    public IBrowserFile? RewardTableFile { get; set; }
    public IBrowserFile? RankingFile { get; set; }
    public IBrowserFile? StakingFile { get; set; }
    public IBrowserFile? CouragePassFile { get; set; }
}

public sealed class CouragePassEntryMap : ClassMap<CouragePassEntry>
{
    public CouragePassEntryMap()
    {
        Map(m => m.AvatarAddress).Name("avatar_addr");
        Map(m => m.ProductId).Name("product_id");
        Map(m => m.AgentAddress).Name("agent_Addr");
    }
}

public sealed class ArenaRankingEntryMap : ClassMap<ArenaRankingEntry>
{
    public ArenaRankingEntryMap()
    {
        Map(m => m.AvatarAddress).Name("avatar_address");
        Map(m => m.AgentAddress).Name("agent_address");
        Map(m => m.NameWithHash).Name("name_with_hash");
        Map(m => m.Ranking).Name("ranking");
        Map(m => m.Score).Name("score");
        Map(m => m.TotalWin).Name("total_win");
        Map(m => m.TotalLose).Name("total_lose");
        Map(m => m.Level).Name("level");
    }
}

public class ArenaRewardGroupDefinition
{
    public int PlayerCount { get; set; }
    public decimal RewardPercentage { get; set; }
}

public class ArenaRewardConfiguration
{
    public decimal TotalPool { get; set; }
    public decimal CompetitionPercentage { get; set; }
    public decimal RankingPool { get; set; }
    public decimal StakingLv2Multiplier { get; set; }
    public decimal StakingLv3Multiplier { get; set; }
    public decimal CouragePassMultiplier { get; set; }
    public List<ArenaRewardGroupDefinition> GroupDefinitions { get; set; } = new();

    public static ArenaRewardConfiguration CreateDefault()
    {
        return new ArenaRewardConfiguration
        {
            TotalPool = 500000,
            CompetitionPercentage = 100,
            RankingPool = 500000,
            StakingLv2Multiplier = 0.5m,
            StakingLv3Multiplier = 1.0m,
            CouragePassMultiplier = 1.0m,
            GroupDefinitions = new List<ArenaRewardGroupDefinition>
            {
                new() { PlayerCount = 2, RewardPercentage = 7 },
                new() { PlayerCount = 3, RewardPercentage = 8 },
                new() { PlayerCount = 4, RewardPercentage = 7 },
                new() { PlayerCount = 6, RewardPercentage = 9 },
                new() { PlayerCount = 10, RewardPercentage = 12 },
                new() { PlayerCount = 25, RewardPercentage = 18 },
                new() { PlayerCount = 37, RewardPercentage = 18 },
                new() { PlayerCount = 38, RewardPercentage = 12 },
                new() { PlayerCount = 125, RewardPercentage = 6 },
                new() { PlayerCount = 250, RewardPercentage = 3 }
            }
        };
    }
}

public class ArenaRewardTierGroup
{
    public string RankGroup { get; set; } = string.Empty;
    public int PlayerCount { get; set; }
    public decimal RewardPercentage { get; set; }
    public decimal GroupReward { get; set; }
    public decimal EachPlayerGetsNone { get; set; }
    public decimal EachPlayerGetsStakingLv2 { get; set; }
    public decimal EachPlayerGetsStakingLv3 { get; set; }
    public decimal EachPlayerGetsCouragePass { get; set; }
    public decimal EachPlayerGetsStakingLv2Courage { get; set; }
    public decimal EachPlayerGetsStakingLv3Courage { get; set; }
    public decimal FullSum { get; set; }
}

public class ArenaRewardCalculationResult
{
    public List<ArenaRewardTier> RewardTiers { get; set; } = new();
    public List<ArenaRewardTierGroup> RewardTierGroups { get; set; } = new();
    public List<ArenaRewardResult> Results { get; set; } = new();
    public ArenaRewardConfiguration Configuration { get; set; } = new();
}
