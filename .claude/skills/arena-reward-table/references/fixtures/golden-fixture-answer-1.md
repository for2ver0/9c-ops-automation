# 골든 픽스처 — "답변 1" (Heimdall CS9는 실측으로 반증됨, Odin S39는 여전히 미검증)

> **2026-09-01 갱신**: 담당자가 실제 백오피스 산출물(`[ Heimdall ] Arena Championship 9 Rewards` PNG
> 스크린샷)을 공유해서 대조한 결과, 아래 **Heimdall CS9의 percentages/couragePassMultiplier는
> 틀렸다는 게 확인됐다** — 실제 값으로 정정했다(아래 "Heimdall CS9" 절 참고). **Odin S39는 대조할
> 실측 이미지가 아직 없어 여전히 미검증 상태**이고, Heimdall이 틀렸던 이상 Odin도 같은 방식으로
> 틀렸을 가능성을 기본값으로 의심해야 한다 — "공통 설정값"이라는 전제 자체가 깨졌으므로, 두 시즌이
> 같은 percentages/배수를 쓴다고 가정하지 말 것.
>
> **주의(원문 유지)**: 사용자가 "두 답변을 비교해달라"며 보냈으나 이 대화에는 [답변 1]만 도착했다(중간에
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
> 없고, 다른 워크스페이스(`/workspace`, 이전에 확인된 데브컨테이너)에서 나온 결과로 추정된다. **이
> 산술 재검증은 공식(수식)이 맞다는 것만 보증하지, percentages/couragePassMultiplier 같은 입력값
> 자체의 provenance는 보증하지 않는다 — Heimdall CS9에서 바로 그 입력값이 틀렸던 것으로 실측
> 확인됨.**

## 케이스 식별 — 픽스처 키가 `id`가 아니라 `network + seasonGroupId`인 이유

두 시즌 모두 `Season.Id = 40`이지만 네트워크가 다른 별개 시즌. `id`만으로 키를 잡으면 충돌하므로
`network + seasonGroupId`로 식별해야 한다는 지적. (이 저장소에서 아직 검증 못 함 — 다음에 라이브
`/seasons` 응답으로 교차 확인 필요.)

## 공통 설정값 (⚠️ "공통"이라는 전제가 Heimdall CS9 실측으로 깨짐 — players/스테이킹 배수만 공통)

| 필드 | 값 | 두 시즌 공통? |
| --- | --- | --- |
| players | 2, 3, 4, 6, 10, 25, 37, 38, 125, 250 (합 500) | 공통 (실측 확인, 두 시즌 동일) |
| staking2Multiplier | 0.5 | 공통 (실측 확인) |
| staking3Multiplier | 1.0 | 공통 (실측 확인) |
| percentages | ~~7, 8, 7, 9, 12, 18, 18, 12, 6, 3~~ — **Heimdall CS9는 아님, 아래 참고** | **아님** |
| couragePassMultiplier | ~~1.0~~ — **Heimdall CS9는 1.2로 실측 확인** | **아님** |

(→ 원래 `ArenaRewardModels.CreateDefault()`와 그룹 정의가 동일하다고 가정했으나, 그 기본값은
`arena-reward-table.ts:18-25` 주석이 이미 경고하는 대로 "form-prefill이지 operational baseline이
아니다" — 실측으로 정확히 그 경고가 맞았음이 확인됨. percentages/couragePassMultiplier는 시즌·타입마다
달라질 수 있으므로 절대 재사용하지 말고 매번 실측/담당자 확인값을 받을 것.)

## Odin S39 (⚠️ 미검증 — 대조할 실측 이미지 없음, 아래 표는 여전히 추정값)

| 필드 | 값 |
| --- | --- |
| seasonGroupId | 39 |
| Season.Id (odin-arena) | 40 |
| arenaType | SEASON |
| RankingPool | 400,000 |
| percentages | 7, 8, 7, 9, 12, 18, 18, 12, 6, 3 (합 100) — **미검증, Heimdall CS9와 같은 방식으로 틀렸을 수 있음** |
| couragePassMultiplier | 1.0 — **미검증. 담당자가 확인한 운영 baseline은 1.2 — Odin S39도 1.2였을 가능성 있음, 실측 이미지로 대조 전엔 신뢰하지 말 것** |
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

## Heimdall CS9 (✅ 2026-09-01 실측 확인 — 담당자 공유 스크린샷, `[ Heimdall ] Arena Championship 9 Rewards`)

| 필드 | 값 |
| --- | --- |
| seasonGroupId | 9 |
| Season.Id (heimdall-arena) | 40 |
| arenaType | CHAMPIONSHIP |
| RankingPool | 500,000 |
| percentages | **8, 8, 8, 10, 12, 19, 17, 10, 5, 3 (합 100)** — 아래 표 전체 재검증된 실측값, 기존 문서의 `7,8,7,9,12,18,18,12,6,3`은 틀렸음 |
| couragePassMultiplier | **1.2** — 기존 문서의 `1.0`은 틀렸음 (CP/Basic 비율 = 2.2 = 1+1.2로 역산 확인) |
| staking2Multiplier / staking3Multiplier | 0.5 / 1.0 (기존값 유지, 실측과 일치) |
| blocks | 10741181-10892380 |

### 기대 출력 (실지급, 실측 스크린샷 값 그대로 — 재계산이 아니라 이미지에서 직접 옮김)

```
   Group  Players    %  GroupReward   Basic    Stk2    Stk3      CP  CP+St2  CP+St3
     1-2        2   8%       40,000   6,250   9,375  12,500  13,750  16,875  20,000
     3-5        3   8%       40,000   4,167   6,250   8,333   9,167  11,250  13,333
     6-9        4   8%       40,000   3,125   4,688   6,250   6,875   8,438  10,000
   10-15        6  10%       50,000   2,604   3,906   5,208   5,729   7,031   8,333
   16-25       10  12%       60,000   1,875   2,813   3,750   4,125   5,063   6,000
   26-50       25  19%       95,000   1,188   1,781   2,375   2,613   3,206   3,800
   51-87       37  17%       85,000     718   1,077   1,436   1,579   1,938   2,297
  88-125       38  10%       50,000     411     617     822     905   1,110   1,316
 126-250      125   5%       25,000      63      94     125     138     169     200
 251-500      250   3%       15,000      19      28      38      41      51      60
   TOTAL      500 100%      500,000
```

`maxPayoutAfterTruncation = 499,994`(= Σ playerCount×paid.CP+St3, 이 세션에서 재계산), `truncationResidual = 6`.
기존(틀렸던) 값 `499,947`/`53`은 잘못된 percentages/couragePassMultiplier로 계산된 것이라 폐기.

⚠️ **basic 열이 "groupReward/players/(1+staking3+couragePass)" 공식의 floor와 정확히 안 맞는 그룹이
있다** — 예: 3-5 그룹 `40,000/3/3.2 = 4166.67` → floor면 4,166인데 실측 이미지는 4,167. 이런 ±1 차이는
`arena-reward-table` 스킬이 이미 잡고 있는 "반올림 경계값"(C# decimal vs 단순 부동소수점 계산 차이)
현상과 일치하는 것으로 보임 — 공식 자체가 틀렸다는 뜻은 아니고, 백엔드의 정확한 decimal 반올림 순서를
모른 채 재계산하면 ±1 gold 오차가 날 수 있다는 기존 경고가 실측으로도 재확인된 것.

## 실측(주장)으로 픽스처에 박아둔 두 가지 — 이 세션에서 미검증, provenance 확인 필요

1. **실참가자가 500명 미만**: Odin S39 = 416명, Heimdall CS9 = 403명. 최하위 구간(251-500, 250슬롯)이
   각각 166명/153명만 참. `sum(playerCount)==500` 불변식은 **표 정의**를 보는 것이지 실제 참가자 수를
   보지 않으므로 이 상태에서도 PASS — 불변식의 한계로 명시적으로 짚어둠.
2. **동점이 구간 경계를 넘긴다**: 동점자 전원이 그룹의 "가장 낮은 등수"를 받고 그 위 등수가 결번.
   결번이 구간 경계에 걸리면 한 구간 아래(더 낮은) 보상을 받음.
   - Odin S39: rank 15(10-15 구간) → 16(16-25 구간)로 밀림, basic 2,000 → 1,600 (-400)
   - Heimdall CS9: rank 5(3-5 구간) → 6(6-9 구간)로 밀림, basic 4,167 → 3,125 (-1,042, **-25%**) —
     ⚠️ 이 수치는 2026-09-01 실측 정정된 표 기준으로 다시 계산한 것(정정 전 문서는 4,444→2,916이었음).
     "동점 경계 충돌 자체가 실제로 일어났는가"라는 주장은 이 스크린샷으로 검증되지 않았다 — 표 정의가
     맞다는 것만 확인됐을 뿐, 이 tie-break 시나리오는 여전히 미검증.
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
