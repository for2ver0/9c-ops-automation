# 계산 체인 요약 — 근거 확정 (사용자 확인, 2026-08-30)

> 출처: `NineChronicles.Backoffice/Services/ArenaRewardService.cs` (main `ba13ff5`, 629줄). 계산에
> 관여하는 부분은 359-629줄. 전체 소스는 `ArenaRewardService.cs`(이 디렉터리, 사용자가 3부로 전달)에
> 있음 — 이 파일은 그 위에 사용자가 덧붙인 확인/해설만 정리한 것.

## 체인

`CalculateRewardsWithDynamicTable` → `GenerateTierGroups`(설정→그룹별 금액, 559-599행) →
`ConvertTierGroupsToRewardTiers`(그룹→랭크구간 티어, **여기서만 int 절삭**, 601-628행) →
`CalculateRewards`(유저별 매칭·합산, 359-446행). 유저별 룩업 헬퍼는 490-533행
(`GetRewardEntryForRank`/`GetStakingLevel`/`GetStakingBonus`).

⚠️ **모든 필드가 C# `decimal`이다** (`ArenaRewardModels.cs`) — 이 스킬(`arena-reward-calc.ts`)은
JS `number`(IEEE-754 double)로 재현하는데, 나눗셈 중간값이 정수 경계에 정확히 걸치는 극히 일부
칸에서 두 타입이 반올림 방향을 다르게 처리해 결과가 ±1 갈릴 수 있음이 2026-08-31 실측으로
확인됐다(도메인 담당자가 실제 백엔드를 직접 실행해 골든 픽스처와 대조). 자세한 내용·재현 사례·
대응 방식은 `arena-reward-table` SKILL.md §4-1 참고.

## 확정된 수치적 사실

- `EachPlayerGetsNone = groupReward / playerCount / (1 + StakingLv3Multiplier + CouragePassMultiplier)`.
  기본 승수(1.0 + 1.0)면 분모가 3 — 무조건 유저는 그룹 1인분의 1/3, 풀조건(lv3+용기패스)만 정확히 1인분.
- **스테이킹 레벨 1은 없다.** `deposit>=5000→3`, `>=500→2`, 그 외 `0`. (2단계뿐, 소스에 레벨1 없음)
- `GenerateTierGroups(config, totalPlayers)`의 `totalPlayers` 인자는 **본문에서 안 쓰인다** — 그룹 구성은
  전적으로 `config.GroupDefinitions`로만 결정. 테이블 범위 밖 랭크(기본 501위 이하)는
  `RewardEntryNotFoundException`으로 조용히 스킵(참고: [[arena-reward-table-invariants]]).
- **`GenerateTierGroups`는 전부 decimal, 절삭 없음.** 절삭은 `ConvertTierGroupsToRewardTiers`에서
  `(int)group.Each...` 캐스팅으로만 발생. 각 조건(Staking2/3, CouragePass, CouragePass+Staking2/3)이
  **독립적으로 floor된 뒤 basicReward를 뺀 증분**으로 저장되므로, 보너스가 "정확히 basic×배수"가 아니라
  최대 1 gold 오차가 날 수 있다. → 실제 총 지급액은 `FullSum`(그룹 예산과 수학적으로 동일) 합계보다
  같거나 항상 조금 적다.
- 서비스 코드는 인원 합(500)·비율 합(100%) **불변식을 검증하지 않는다** — 어긋난 설정도 그대로 계산됨.
  이 검증은 스킬(`arena-reward-table`)의 책임.

## `CreateDefault()` 실측값 (`Models/ArenaRewardModels.cs:121`)

| 필드 | 값 |
| --- | --- |
| `TotalPool` | 500,000 (미사용 inert 필드 — [[arena-reward-service-facts]] 참고) |
| `CompetitionPercentage` | 100 (미사용 inert 필드) |
| `RankingPool` | 500,000 |
| `StakingLv2Multiplier` | 0.5 |
| `StakingLv3Multiplier` | 1.0 |
| `CouragePassMultiplier` | 1.0 (⚠️ 폼 프리필값일 뿐, 안정된 "운영 baseline"은 없다 — Heimdall CS9는 1.2로 실측 확인됐지만 그 시즌 한 건일 뿐, Odin S39는 미확인이고 시즌마다 다를 수 있다. 스펙 문서 §5 참고) |

`GroupDefinitions` (10구간):

| 구간 | 인원 | 비율(%) |
| --- | --- | --- |
| 1 | 2 | 7 (⚠️ 라이브 baseline은 8%) |
| 2 | 3 | 8 |
| 3 | 4 | 7 |
| 4 | 6 | 9 |
| 5 | 10 | 12 |
| 6 | 25 | 18 |
| 7 | 37 | 18 |
| 8 | 38 | 12 |
| 9 | 125 | 6 |
| 10 | 250 | 3 |

인원 합 = 500, 비율 합 = 100. (코드 기본값 기준. 실제 시즌 운영값은 담당자가 조절 — §8-1 결정사항)

## 매칭 키

스테이킹 매칭 = **AgentAddress**, 용기패스 매칭 = **AvatarAddress**. 서로 다른 주소 축이므로 스킬의
매칭 실패 리포트도 이 둘을 분리해서 집계해야 함(스펙 문서 §6-1 "매칭 실패 2종 구분"과 일치).

## 아직 없는 것

- `ArenaRewardModels.cs` 전체 원문(필드 타입까지 정확히) — 위 표는 사용자의 요약 설명 기반이라
  실제 C# 타입(예: `decimal` vs `double`, nullable 여부)은 미확인. 계산기 구현 시 필요하면 요청.
- Heimdall CS9 / Odin S39 골든 픽스처 — 아직 미수령.
