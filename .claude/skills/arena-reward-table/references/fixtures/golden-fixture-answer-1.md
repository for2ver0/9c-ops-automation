# 골든 픽스처 — "답변 1" (미검증 provenance, 산술은 독립 재검증 완료)

> **주의**: 사용자가 "두 답변을 비교해달라"며 보냈으나 이 대화에는 [답변 1]만 도착했다(중간에
> "Request interrupted by user"로 끊겼다가 재전송된 것으로 보임). [답변 2]는 아직 없음 — 도착하면
> 두 답변을 diff하고 이 문서를 갱신해야 한다. 그 전까지 이 파일 하나만으로 최종 확정하지 말 것.
>
> **산술 자체는 이 세션에서 독립적으로 전량 재검증했다** — Odin S39 10개 그룹 전체(그룹별
> `groupReward = pool×pct/100`, `eachPlayerGetsNone = groupReward/인원/3`, 6개 조건 배수 적용 후
> 개별 floor, `maxPayoutAfterTruncation = Σ playerCount×(CP+St3)`)를 손으로 다시 계산해 전부 일치
> 확인함(399,957 / 잔여 43 포함). 즉 **공식 적용이 맞다는 것은 확인됨** — 다만 "실제 Odin
> seasonGroupId=39 / Heimdall seasonGroupId=9 라이브 데이터로부터 나온 값"이라는 provenance
> (RankingPool 400,000/500,000, 실참가자 수 416/403명, 동점 경계 사례 등)는 이 세션에서 직접
> 재현하지 못했다 — 그 소스인 `tools/9c/arena-reward-table.ts`가 이 저장소(`9c-ops-automation`)에는
> 없고, 다른 워크스페이스(`/workspace`, 이전에 확인된 데브컨테이너)에서 나온 결과로 추정된다.

## 케이스 식별 — 픽스처 키가 `id`가 아니라 `network + seasonGroupId`인 이유

두 시즌 모두 `Season.Id = 40`이지만 네트워크가 다른 별개 시즌. `id`만으로 키를 잡으면 충돌하므로
`network + seasonGroupId`로 식별해야 한다는 지적. (이 저장소에서 아직 검증 못 함 — 다음에 라이브
`/seasons` 응답으로 교차 확인 필요.)

## 공통 설정값

| 필드 | 값 |
| --- | --- |
| percentages | 7, 8, 7, 9, 12, 18, 18, 12, 6, 3 (합 100) |
| players | 2, 3, 4, 6, 10, 25, 37, 38, 125, 250 (합 500) |
| staking2Multiplier | 0.5 |
| staking3Multiplier | 1.0 |
| couragePassMultiplier | 1.0 |

(→ `ArenaRewardModels.CreateDefault()`와 그룹 정의가 완전히 동일. `RankingPool`만 시즌별로 다름.)

## Odin S39

| 필드 | 값 |
| --- | --- |
| seasonGroupId | 39 |
| Season.Id (odin-arena) | 40 |
| arenaType | SEASON |
| RankingPool | 400,000 |
| blocks | 19260824-19412023 |

### 기대 출력 (실지급, int 절삭 완료)

```
   Group  Players    %  GroupReward   Basic    Stk2    Stk3      CP  CP+St2  CP+St3
     1-2        2   7%       28,000   4,666   7,000   9,333   9,333  11,666  14,000
     3-5        3   8%       32,000   3,555   5,333   7,111   7,111   8,888  10,666
     6-9        4   7%       28,000   2,333   3,500   4,666   4,666   5,833   7,000
   10-15        6   9%       36,000   2,000   3,000   4,000   4,000   5,000   6,000
   16-25       10  12%       48,000   1,600   2,400   3,200   3,200   4,000   4,800
   26-50       25  18%       72,000     960   1,440   1,920   1,920   2,400   2,880
   51-87       37  18%       72,000     648     972   1,297   1,297   1,621   1,945
  88-125       38  12%       48,000     421     631     842     842   1,052   1,263
 126-250      125   6%       24,000      64      96     128     128     160     192
 251-500      250   3%       12,000      16      24      32      32      40      48
   TOTAL      500 100%      400,000
```

`maxPayoutAfterTruncation = 399,957` (= Σ playerCount × paid.CP+St3), `truncationResidual = 43`.
등호(`== RankingPool`)가 아니라 상한 검사로만 써야 함 — 스펙 문서 §6·§6-2의 "실지급 ≤ 총 풀,
등호 아님" 원칙과 정확히 일치.

`paid.{basic,staking2,...}` (유저 실수령) vs `storedTier.{basicReward,staking2Reward,...}`
(백오피스가 DB에 저장하는 델타 형식) 관계 예시(1-2 그룹):

```json
{
  "paid":       { "basic": 4666, "staking2": 7000, "staking3": 9333,
                  "couragePass": 9333, "couragePassStaking2": 11666, "couragePassStaking3": 14000 },
  "storedTier": { "basicReward": 4666, "staking2Reward": 2334, "staking3Reward": 4667,
                  "couragePassReward": 4667, "couragePassAndStaking2Reward": 7000,
                  "couragePassAndStaking3Reward": 9334 }
}
```
검산: `paid.staking2 = storedTier.basicReward + storedTier.staking2Reward = 4666+2334 = 7000` ✓.
이 세션에서 6개 열 전체 이 관계로 재검증 완료.

## Heimdall CS9

| 필드 | 값 |
| --- | --- |
| seasonGroupId | 9 |
| Season.Id (heimdall-arena) | 40 |
| arenaType | CHAMPIONSHIP |
| RankingPool | 500,000 |
| blocks | 10741181-10892380 |

### 기대 출력 (실지급, int 절삭 완료)

```
   Group  Players    %  GroupReward   Basic    Stk2    Stk3      CP  CP+St2  CP+St3
     1-2        2   7%       35,000   5,833   8,750  11,666  11,666  14,583  17,500
     3-5        3   8%       40,000   4,444   6,666   8,888   8,888  11,111  13,333
     6-9        4   7%       35,000   2,916   4,375   5,833   5,833   7,291   8,750
   10-15        6   9%       45,000   2,500   3,750   5,000   5,000   6,250   7,500
   16-25       10  12%       60,000   2,000   3,000   4,000   4,000   5,000   6,000
   26-50       25  18%       90,000   1,200   1,800   2,400   2,400   3,000   3,600
   51-87       37  18%       90,000     810   1,216   1,621   1,621   2,027   2,432
  88-125       38  12%       60,000     526     789   1,052   1,052   1,315   1,578
 126-250      125   6%       30,000      80     120     160     160     200     240
 251-500      250   3%       15,000      20      30      40      40      50      60
   TOTAL      500 100%      500,000
```

`maxPayoutAfterTruncation = 499,947`, `truncationResidual = 53`.

## 실측(주장)으로 픽스처에 박아둔 두 가지 — 이 세션에서 미검증, provenance 확인 필요

1. **실참가자가 500명 미만**: Odin S39 = 416명, Heimdall CS9 = 403명. 최하위 구간(251-500, 250슬롯)이
   각각 166명/153명만 참. `sum(playerCount)==500` 불변식은 **표 정의**를 보는 것이지 실제 참가자 수를
   보지 않으므로 이 상태에서도 PASS — 불변식의 한계로 명시적으로 짚어둠.
2. **동점이 구간 경계를 넘긴다**: 동점자 전원이 그룹의 "가장 낮은 등수"를 받고 그 위 등수가 결번.
   결번이 구간 경계에 걸리면 한 구간 아래(더 낮은) 보상을 받음.
   - Odin S39: rank 15(10-15 구간) → 16(16-25 구간)로 밀림, basic 2,000 → 1,600 (-400)
   - Heimdall CS9: rank 5(3-5 구간) → 6(6-9 구간)로 밀림, basic 4,444 → 2,916 (-1,528, **-34%**)
   - 두 시즌 다 동점 50건대 중 경계 충돌은 각 1건 — "매 시즌 확률적으로 발생"이라는 평가.
   - **이 세션의 시사점**: `arena-reward-table` 스킬의 불변식 검증에 "동점으로 인한 결번이 구간
     경계와 겹치는가"를 경고(WARN) 항목으로 추가할 근거가 됨. 다만 이 동점 데이터 자체가 실측인지는
     미검증이므로, 검증 로직 설계에는 반영하되 구체적 수치(53건/80건 등)는 실측 확인 전엔 인용하지 않음.

## 도구·검증기 (provenance 미확인, 참고용으로만 보관)

`tools/9c/fixtures/verify-arena-reward-table.ts`, `gen-arena-reward-table-fixture.py`,
mutation-test 쉘스크립트 전문이 함께 제공됨. 이 저장소에는 `tools/9c/arena-reward-table.ts`
(생성기가 호출하는 도구)가 없으므로 이 세션에서 직접 재실행하지 못했다. 코드 자체는 설계 참고용으로
유용함:
- `--no-fetch --pool` 로 라이브 의존성을 끊어 오프라인 결정적 회귀 테스트로 만든 패턴.
- `tier.basicReward + tier[tierKey]`로 합산 비교(델타 저장 형식 vs 실지급 형식 혼동 방지).
- mutation test에 `trap ... EXIT INT TERM`으로 픽스처 원복 보장 + 대조군(무변이)을 마지막에 둬서
  "검증기가 항상 FAIL"인 축퇴 케이스를 배제하는 설계.

전문은 필요 시 이 대화 로그에서 복원 가능. 이 저장소용 계산기를 구현할 때 검증 스크립트 설계
철학(오프라인 결정적 + 델타/실지급 분리 비교 + mutation test)은 그대로 채용할 가치가 있음.
