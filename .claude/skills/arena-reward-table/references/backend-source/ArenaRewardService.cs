// SOURCE: NineChronicles.Backoffice / Services/ArenaRewardService.cs
// Pasted by user (owner) in 3 parts on 2026-08-30 as grounding reference for the
// arena-reward-table skill's reward calculation logic. Do not treat as fully
// verified against a live checkout — provenance is "pasted by domain owner",
// not a repo clone. Cross-check specific claims in the spec doc's §7-1 against
// this file when they conflict.
//
// PART 1/3 — usings/interface/constructor, CSV ranking parsing, garage staking
// lookup, planet-id mapping.

using System.Globalization;
using CsvHelper;
using CsvHelper.Configuration;
using Libplanet.Crypto;
using Microsoft.AspNetCore.Components.Forms;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using NineChronicles.Backoffice.Client;
using NineChronicles.Backoffice.Models;
using System.Net.Http;
using System.Text.Json;

namespace NineChronicles.Backoffice.Services;

public interface IArenaRewardService
{
    Task<List<ArenaRankingEntry>> ParseRankingFileAsync(IBrowserFile file);
    Task<List<ArenaRankingEntry>> ParseRankingFileAsync(Stream stream);
    Task<List<StakeState>> GetStakingEntriesFromGarageAsync(string planet, int seasonId, CancellationToken cancellationToken = default);
    Task<List<CouragePassEntry>> ParseCouragePassFileAsync(IBrowserFile file);
    Task<List<CouragePassEntry>> ParseCouragePassFileAsync(Stream stream);
    Task<List<CouragePassEntry>> GetCouragePassEntriesAsync(string planet, int seasonIndex, CancellationToken cancellationToken = default);
    Task<List<ArenaSeason>> GetSeasonsAsync(string planet, CancellationToken cancellationToken = default);
    Task<List<ArenaSeason>> GetCompletedSeasonsAsync(string planet, CancellationToken cancellationToken = default);
    Task<List<ArenaLeaderboardEntry>> GetCompletedLeaderboardAsync(string planet, int seasonId, CancellationToken cancellationToken = default);
    List<ArenaRewardResult> CalculateRewards(
        List<ArenaRewardTier> rewardTable,
        List<ArenaRankingEntry> rankings,
        List<StakeState> stakings,
        List<CouragePassEntry> couragePasses
    );
    ArenaRewardCalculationResult CalculateRewardsWithDynamicTable(
        ArenaRewardConfiguration config,
        List<ArenaRankingEntry> rankings,
        List<StakeState> stakings,
        List<CouragePassEntry> couragePasses
    );
}

public class ArenaRewardService : IArenaRewardService
{
    private readonly ILogger<ArenaRewardService> _logger;
    private readonly IArenaServiceClient _arenaServiceClient;
    private readonly ISeasonPassRepository _seasonPassRepository;
    private readonly IHttpClientFactory _httpClientFactory;

    public ArenaRewardService(
        ILogger<ArenaRewardService> logger,
        IArenaServiceClient arenaServiceClient,
        ISeasonPassRepository seasonPassRepository,
        IHttpClientFactory httpClientFactory)
    {
        _logger = logger;
        _arenaServiceClient = arenaServiceClient;
        _seasonPassRepository = seasonPassRepository;
        _httpClientFactory = httpClientFactory;
    }

    public async Task<List<ArenaRankingEntry>> ParseRankingFileAsync(IBrowserFile file)
    {
        _logger.LogInformation(
            "랭킹 정보 파싱 시작: {FileName}, 크기: {Size} bytes",
            file.Name,
            file.Size
        );

        try
        {
            var entries = new List<ArenaRankingEntry>();
            using var stream = file.OpenReadStream();
            using var reader = new StreamReader(stream);

            var config = new CsvConfiguration(CultureInfo.InvariantCulture)
            {
                HeaderValidated = null,
                MissingFieldFound = null,
            };

            using var csv = new CsvReader(reader, config);
            csv.Context.RegisterClassMap<ArenaRankingEntryMap>();

            await foreach (var record in csv.GetRecordsAsync<ArenaRankingEntry>())
            {
                entries.Add(record);
            }

            _logger.LogInformation("랭킹 정보 파싱 완료: {Count} 개 항목", entries.Count);
            return entries;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "랭킹 정보 파싱 중 오류 발생: {FileName}", file.Name);
            throw;
        }
    }

    public async Task<List<ArenaRankingEntry>> ParseRankingFileAsync(Stream stream)
    {
        _logger.LogInformation("랭킹 정보 파싱 시작 (Stream)");

        try
        {
            var entries = new List<ArenaRankingEntry>();
            using var reader = new StreamReader(stream);

            var config = new CsvConfiguration(CultureInfo.InvariantCulture)
            {
                HeaderValidated = null,
                MissingFieldFound = null,
            };

            using var csv = new CsvReader(reader, config);
            csv.Context.RegisterClassMap<ArenaRankingEntryMap>();

            await foreach (var record in csv.GetRecordsAsync<ArenaRankingEntry>())
            {
                entries.Add(record);
            }

            _logger.LogInformation("랭킹 정보 파싱 완료: {Count} 개 항목", entries.Count);
            return entries;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "랭킹 정보 파싱 중 오류 발생 (Stream)");
            throw;
        }
    }

    public async Task<List<StakeState>> GetStakingEntriesFromGarageAsync(string planet, int seasonId, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("garage에서 스테이킹 정보 조회 시작: planet={Planet}, seasonId={SeasonId}", planet, seasonId);

        try
        {
            var client = _httpClientFactory.CreateClient();
            var planetName = GetPlanetNameFromId(planet);
            var url = $"https://garage.nine-chronicles.dev/staking-for-arena/main/{planetName}/{seasonId}.json";

            _logger.LogInformation("garage URL 요청: {Url}", url);

            var response = await client.GetAsync(url, cancellationToken);

            if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                _logger.LogWarning("garage에서 스테이킹 파일을 찾을 수 없음: planet={Planet}, seasonId={SeasonId}", planet, seasonId);
                throw new FileNotFoundException($"해당 시즌({seasonId})의 스테이킹 정보 파일을 찾을 수 없습니다.");
            }

            response.EnsureSuccessStatusCode();
            var json = await response.Content.ReadAsStringAsync(cancellationToken);

            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            if (!root.TryGetProperty("stakingInfo", out var stakingInfo))
            {
                _logger.LogWarning("garage JSON에서 stakingInfo 필드를 찾을 수 없음: planet={Planet}, seasonId={SeasonId}", planet, seasonId);
                throw new InvalidOperationException("스테이킹 정보 파일의 형식이 올바르지 않습니다. 'stakingInfo' 필드를 찾을 수 없습니다.");
            }

            var result = new List<StakeState>();
            foreach (var item in stakingInfo.EnumerateArray())
            {
                if (!item.TryGetProperty("address", out var addressProp) || addressProp.ValueKind == JsonValueKind.Null)
                {
                    throw new InvalidOperationException("스테이킹 정보에서 'address' 필드가 누락되었거나 null입니다.");
                }

                if (!item.TryGetProperty("agentAddress", out var agentAddressProp) || agentAddressProp.ValueKind == JsonValueKind.Null)
                {
                    throw new InvalidOperationException("스테이킹 정보에서 'agentAddress' 필드가 누락되었거나 null입니다.");
                }

                if (!item.TryGetProperty("deposit", out var depositProp) || depositProp.ValueKind == JsonValueKind.Null)
                {
                    throw new InvalidOperationException("스테이킹 정보에서 'deposit' 필드가 누락되었거나 null입니다.");
                }

                if (!item.TryGetProperty("startedBlockIndex", out var startedBlockIndexProp) || startedBlockIndexProp.ValueKind == JsonValueKind.Null)
                {
                    throw new InvalidOperationException("스테이킹 정보에서 'startedBlockIndex' 필드가 누락되었거나 null입니다.");
                }

                if (!item.TryGetProperty("receivedBlockIndex", out var receivedBlockIndexProp) || receivedBlockIndexProp.ValueKind == JsonValueKind.Null)
                {
                    throw new InvalidOperationException("스테이킹 정보에서 'receivedBlockIndex' 필드가 누락되었거나 null입니다.");
                }

                if (!item.TryGetProperty("cancellableBlockIndex", out var cancellableBlockIndexProp) || cancellableBlockIndexProp.ValueKind == JsonValueKind.Null)
                {
                    throw new InvalidOperationException("스테이킹 정보에서 'cancellableBlockIndex' 필드가 누락되었거나 null입니다.");
                }

                result.Add(new StakeState
                {
                    Address = addressProp.GetString() ?? throw new InvalidOperationException("스테이킹 정보의 'address' 필드가 문자열이 아닙니다."),
                    AgentAddress = agentAddressProp.GetString() ?? throw new InvalidOperationException("스테이킹 정보의 'agentAddress' 필드가 문자열이 아닙니다."),
                    Deposit = depositProp.GetString() ?? throw new InvalidOperationException("스테이킹 정보의 'deposit' 필드가 문자열이 아닙니다."),
                    StartedBlockIndex = startedBlockIndexProp.GetInt64(),
                    ReceivedBlockIndex = receivedBlockIndexProp.GetInt64(),
                    CancellableBlockIndex = cancellableBlockIndexProp.GetInt64(),
                });
            }

            _logger.LogInformation("garage에서 스테이킹 정보 조회 완료: {Count}개", result.Count);
            return result;
        }
        catch (HttpRequestException ex) when (ex.Message.Contains("404"))
        {
            _logger.LogWarning("garage에서 스테이킹 파일을 찾을 수 없음: planet={Planet}, seasonId={SeasonId}", planet, seasonId);
            throw new FileNotFoundException($"해당 시즌({seasonId})의 스테이킹 정보 파일을 찾을 수 없습니다.", ex);
        }
        catch (Exception ex) when (ex is not FileNotFoundException)
        {
            _logger.LogError(ex, "garage에서 스테이킹 정보 조회 중 오류 발생: planet={Planet}, seasonId={SeasonId}", planet, seasonId);
            throw;
        }
    }

    private string GetPlanetNameFromId(string planetId)
    {
        return planetId switch
        {
            "0x000000000000" => "Odin",
            "0x000000000001" => "Heimdall",
            "0x000000000003" => "Thor",
            "0x100000000000" => "Odin",
            "0x100000000001" => "Heimdall",
            "0x100000000003" => "Thor",
            _ => planetId
        };
    }

// --- END OF PART 1/3 ---

// PART 2/3 — courage pass parsing/API lookup, season/leaderboard lookup,
// CalculateRewards body.

    public async Task<List<CouragePassEntry>> ParseCouragePassFileAsync(IBrowserFile file)
    {
        _logger.LogInformation(
            "용기패스 정보 파싱 시작: {FileName}, 크기: {Size} bytes",
            file.Name,
            file.Size
        );

        try
        {
            var entries = new List<CouragePassEntry>();
            using var stream = file.OpenReadStream();
            using var reader = new StreamReader(stream);

            var config = new CsvConfiguration(CultureInfo.InvariantCulture)
            {
                HeaderValidated = null,
                MissingFieldFound = null,
            };

            using var csv = new CsvReader(reader, config);
            csv.Context.RegisterClassMap<CouragePassEntryMap>();

            await foreach (var record in csv.GetRecordsAsync<CouragePassEntry>())
            {
                entries.Add(record);
            }

            _logger.LogInformation("용기패스 정보 파싱 완료: {Count} 개 항목", entries.Count);
            return entries;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "용기패스 정보 파싱 중 오류 발생: {FileName}", file.Name);
            throw;
        }
    }

    public async Task<List<CouragePassEntry>> ParseCouragePassFileAsync(Stream stream)
    {
        _logger.LogInformation("용기패스 정보 파싱 시작 (Stream)");

        try
        {
            var entries = new List<CouragePassEntry>();
            using var reader = new StreamReader(stream);

            var config = new CsvConfiguration(CultureInfo.InvariantCulture)
            {
                HeaderValidated = null,
                MissingFieldFound = null,
            };

            using var csv = new CsvReader(reader, config);
            csv.Context.RegisterClassMap<CouragePassEntryMap>();

            await foreach (var record in csv.GetRecordsAsync<CouragePassEntry>())
            {
                entries.Add(record);
            }

            _logger.LogInformation("용기패스 정보 파싱 완료: {Count} 개 항목", entries.Count);
            return entries;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "용기패스 정보 파싱 중 오류 발생 (Stream)");
            throw;
        }
    }

    public async Task<List<CouragePassEntry>> GetCouragePassEntriesAsync(string planet, int seasonIndex, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation(
            "용기패스 정보 API 조회 시작: Planet={Planet}, SeasonIndex={SeasonIndex}",
            planet,
            seasonIndex
        );

        try
        {
            var response = await _seasonPassRepository.GetPremiumUsers(IapEnvironment.Mainnet, "CouragePass", seasonIndex, planet, 100, 0);

            var entries = response.Items.Select(user => new CouragePassEntry
            {
                AvatarAddress = user.AvatarAddr,
                AgentAddress = user.AgentAddr,
                ProductId = user.SeasonPassId.ToString()
            }).ToList();

            _logger.LogInformation("용기패스 정보 API 조회 완료: {Count} 개 항목", entries.Count);
            return entries;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "용기패스 정보 API 조회 중 오류 발생: Planet={Planet}, SeasonIndex={SeasonIndex}", planet, seasonIndex);
            throw;
        }
    }

    public async Task<List<ArenaSeason>> GetSeasonsAsync(string planet, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("시즌 정보 조회 시작: Planet={Planet}", planet);
        var seasons = await _arenaServiceClient.GetSeasonsAsync(planet, cancellationToken);
        _logger.LogInformation("시즌 정보 조회 완료: {Count} 개", seasons.Count);
        return seasons;
    }

    public async Task<List<ArenaSeason>> GetCompletedSeasonsAsync(string planet, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("완료된 시즌 조회 시작: Planet={Planet}", planet);
        var completedSeasons = await _arenaServiceClient.GetCompletedSeasonsAsync(planet, cancellationToken);
        _logger.LogInformation("완료된 시즌 조회 완료: {Count} 개", completedSeasons.Count);
        return completedSeasons;
    }

    public async Task<List<ArenaLeaderboardEntry>> GetCompletedLeaderboardAsync(string planet, int seasonId, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("완료된 리더보드 조회 시작: Planet={Planet}, SeasonId={SeasonId}", planet, seasonId);
        var leaderboard = await _arenaServiceClient.GetCompletedLeaderboardAsync(planet, seasonId, cancellationToken);
        _logger.LogInformation("완료된 리더보드 조회 완료: {Count} 개", leaderboard.Count);
        return leaderboard;
    }

    public List<ArenaRewardResult> CalculateRewards(
        List<ArenaRewardTier> rewardTable,
        List<ArenaRankingEntry> rankings,
        List<StakeState> stakings,
        List<CouragePassEntry> couragePasses
    )
    {
        _logger.LogInformation(
            "리워드 계산 시작 - 랭킹: {RankingCount}, 스테이킹: {StakingCount}, 용기패스: {CourageCount}",
            rankings.Count,
            stakings.Count,
            couragePasses.Count
        );

        try
        {
            var results = new List<ArenaRewardResult>();
            var stakingByAgent = stakings
                .Where(s => s != null && !string.IsNullOrEmpty(s.AgentAddress))
                .ToDictionary(s => new Address(s.AgentAddress), s => s);
            var couragePassByAvatar = couragePasses.ToDictionary(c => c.AvatarAddress, c => c);

            _logger.LogInformation(
                "스테이킹 정보 딕셔너리 생성: {StakingDictCount} 개",
                stakingByAgent.Count
            );

            _logger.LogInformation(
                "용기패스 정보 딕셔너리 생성: {CourageDictCount} 개",
                couragePassByAvatar.Count
            );

            foreach (var ranking in rankings)
            {
                try
                {
                var name = ExtractNameFromHash(ranking.NameWithHash);
                var stakingLevel = GetStakingLevel(
                    new Address(ranking.AgentAddress),
                    stakingByAgent
                );
                var hasCouragePass = couragePassByAvatar.ContainsKey(ranking.AvatarAddress);

                _logger.LogDebug(
                    "플레이어 처리: {Name}, 랭크: {Rank}, 스테이킹레벨: {StakingLevel}, 용기패스: {HasCouragePass}",
                    name,
                    ranking.Ranking,
                    stakingLevel,
                    hasCouragePass
                );

                var rewardEntry = GetRewardEntryForRank(ranking.Ranking, rewardTable);
                var stakingBonus = GetStakingBonus(rewardEntry, stakingLevel, hasCouragePass);
                var totalReward = rewardEntry.BasicReward + stakingBonus;

                results.Add(
                    new ArenaRewardResult
                    {
                        Name = name,
                        Rank = ranking.Ranking,
                        Score = ranking.Score,
                        WinCount = ranking.TotalWin,
                        LossCount = ranking.TotalLose,
                        AvatarLevel = ranking.Level,
                        AgentAddress = ranking.AgentAddress,
                        StakingBonus = stakingBonus,
                        AvatarAddress = ranking.AvatarAddress,
                        BasicRewardAmount = rewardEntry.BasicReward,
                        TotalRewardAmount = totalReward,
                        StakingLevel = stakingLevel,
                        HasCouragePass = hasCouragePass,
                    }
                );
                }
                catch (RewardEntryNotFoundException ex)
                {
                    _logger.LogWarning("랭크 {Rank} 스킵됨: {Message}", ex.Rank, ex.Message);
                    continue;
                }
            }

            _logger.LogInformation("리워드 계산 완료: {ResultCount} 개 결과", results.Count);
            return results.OrderBy(r => r.Rank).ToList();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "리워드 계산 중 오류 발생");
            throw;
        }
    }

// --- END OF PART 2/3 ---

// PART 3/3 — name extraction, staking level/bonus determination, dynamic
// reward table generation and tier conversion (end of file).

    private string ExtractNameFromHash(string nameWithHash)
    {
        if (string.IsNullOrEmpty(nameWithHash))
            return string.Empty;

        var spaceIndex = nameWithHash.IndexOf(' ');
        var result = spaceIndex > 0 ? nameWithHash.Substring(0, spaceIndex) : nameWithHash;
        _logger.LogDebug("이름 추출: {Original} -> {Extracted}", nameWithHash, result);
        return result;
    }

    private int GetStakingLevel(
        Address agentAddress,
        Dictionary<Address, StakeState> stakingByAgent
    )
    {
        if (!stakingByAgent.TryGetValue(agentAddress, out var staking))
        {
            _logger.LogDebug("스테이킹 정보 없음: {AgentAddress}", agentAddress);
            return 0;
        }
        var deposit = decimal.Parse(staking.Deposit);

        int level;
        if (deposit >= 5000)
            level = 3;
        else if (deposit >= 500)
            level = 2;
        else
            level = 0;

        _logger.LogDebug(
            "스테이킹 레벨 계산: {AgentAddress}, 금액: {Amount}, 레벨: {Level}",
            agentAddress,
            deposit,
            level
        );
        return level;
    }

    private ArenaRewardTier GetRewardEntryForRank(int rank, List<ArenaRewardTier> rewardTable)
    {
        foreach (var entry in rewardTable)
        {
            if (rank >= entry.RankRangeMin && rank <= entry.RankRangeMax)
            {
                _logger.LogDebug(
                    "랭크 {Rank}에 대한 리워드 엔트리 찾음: {Range}",
                    rank,
                    entry.RankRangeMin
                );
                return entry;
            }
        }

        _logger.LogWarning("랭크 {Rank}에 대한 리워드 엔트리를 찾을 수 없음", rank);
        throw new RewardEntryNotFoundException(rank);
    }

    private int GetStakingBonus(ArenaRewardTier entry, int stakingLevel, bool hasCouragePass)
    {
        int reward;
        if (stakingLevel == 3 && hasCouragePass)
            reward = entry.CouragePassAndStaking3Reward;
        else if (stakingLevel == 2 && hasCouragePass)
            reward = entry.CouragePassAndStaking2Reward;
        else if (hasCouragePass)
            reward = entry.CouragePassReward;
        else if (stakingLevel == 3)
            reward = entry.Staking3Reward;
        else if (stakingLevel == 2)
            reward = entry.Staking2Reward;
        else
            reward = 0;

        _logger.LogDebug(
            "스테이킹 보너스 계산: 스테이킹레벨={StakingLevel}, 용기패스={HasCouragePass}, 보상={Reward}",
            stakingLevel,
            hasCouragePass,
            reward
        );
        return reward;
    }

    public ArenaRewardCalculationResult CalculateRewardsWithDynamicTable(
        ArenaRewardConfiguration config,
        List<ArenaRankingEntry> rankings,
        List<StakeState> stakings,
        List<CouragePassEntry> couragePasses
    )
    {
        _logger.LogInformation("동적 리워드 테이블 생성 및 계산 시작");

        var tierGroups = GenerateTierGroups(config, rankings.Count);
        var rewardTiers = ConvertTierGroupsToRewardTiers(tierGroups);

        var results = CalculateRewards(rewardTiers, rankings, stakings, couragePasses);

        return new ArenaRewardCalculationResult
        {
            RewardTiers = rewardTiers,
            RewardTierGroups = tierGroups,
            Results = results,
            Configuration = config
        };
    }

    private List<ArenaRewardTierGroup> GenerateTierGroups(ArenaRewardConfiguration config, int totalPlayers)
    {
        var tierGroups = new List<ArenaRewardTierGroup>();
        var currentRank = 1;

        foreach (var groupDef in config.GroupDefinitions)
        {
            var playerCount = groupDef.PlayerCount;
            var maxRank = currentRank + playerCount - 1;

            // Group Reward = Ranking Pool * Reward % / 100
            var groupReward = config.RankingPool * groupDef.RewardPercentage / 100;

            // Each Player Gets (None) = Group Reward / no of Players / (1 + staking lv 3 + couragepass)
            var eachPlayerGetsNone = groupReward / playerCount / (1 + config.StakingLv3Multiplier + config.CouragePassMultiplier);

            var group = new ArenaRewardTierGroup
            {
                RankGroup = $"{currentRank}-{maxRank}",
                PlayerCount = playerCount,
                RewardPercentage = groupDef.RewardPercentage,
                GroupReward = groupReward,
                EachPlayerGetsNone = eachPlayerGetsNone,
                // Each Player Gets (staking lv2) = Each Player Gets(None) * (1 + staking lv 2)
                EachPlayerGetsStakingLv2 = eachPlayerGetsNone * (1 + config.StakingLv2Multiplier),
                // Each Player Gets (staking lv 3) = Each Player Gets (None) * (1 + staking lv 3)
                EachPlayerGetsStakingLv3 = eachPlayerGetsNone * (1 + config.StakingLv3Multiplier),
                // Each Player Gets (couragepass) = Each Player Gets (None) * (1 + couragepass)
                EachPlayerGetsCouragePass = eachPlayerGetsNone * (1 + config.CouragePassMultiplier),
                // Each Player Gets (staking lv 2+courage) = Each Player Gets (None) * (1 + staking lv 2 + couragepass)
                EachPlayerGetsStakingLv2Courage = eachPlayerGetsNone * (1 + config.StakingLv2Multiplier + config.CouragePassMultiplier),
                // Each Player Gets (staking lv 3+courage) = Each Player Gets (None) * (1 + staking lv 3 + couragepass)
                EachPlayerGetsStakingLv3Courage = eachPlayerGetsNone * (1 + config.StakingLv3Multiplier + config.CouragePassMultiplier),
                // Full Sum = no of players * Each Player Gets (Full : staking lv 3+courage)
                FullSum = playerCount * eachPlayerGetsNone * (1 + config.StakingLv3Multiplier + config.CouragePassMultiplier)
            };

            tierGroups.Add(group);
            currentRank = maxRank + 1;
        }

        return tierGroups;
    }

    private List<ArenaRewardTier> ConvertTierGroupsToRewardTiers(List<ArenaRewardTierGroup> tierGroups)
    {
        var rewardTiers = new List<ArenaRewardTier>();

        foreach (var group in tierGroups)
        {
            var parts = group.RankGroup.Split('-');
            var minRank = int.Parse(parts[0]);
            var maxRank = int.Parse(parts[1]);

            var basicReward = (int)group.EachPlayerGetsNone;

            rewardTiers.Add(new ArenaRewardTier
            {
                RankRangeMin = minRank,
                RankRangeMax = maxRank,
                BasicReward = basicReward,
                Staking2Reward = (int)group.EachPlayerGetsStakingLv2 - basicReward,
                Staking3Reward = (int)group.EachPlayerGetsStakingLv3 - basicReward,
                CouragePassReward = (int)group.EachPlayerGetsCouragePass - basicReward,
                CouragePassAndStaking2Reward = (int)group.EachPlayerGetsStakingLv2Courage - basicReward,
                CouragePassAndStaking3Reward = (int)group.EachPlayerGetsStakingLv3Courage - basicReward
            });
        }

        return rewardTiers.OrderBy(t => t.RankRangeMin).ToList();
    }

}

// --- END OF FILE (3/3) ---
