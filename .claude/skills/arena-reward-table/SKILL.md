---
name: arena-reward-table
description: Nine Chronicles 아레나 시즌 상금 표를 계산하고 검증할 때 사용. RankingPool·배분 비율·보너스 배수 3종(스테이킹 lv2/lv3, 용기패스)을 받아 10개 랭크 구간별 지급액 표를 백오피스(ArenaRewardService)와 동일한 로직으로 재현하고, 백오피스가 검증하지 않는 불변식(인원 합 500, 비율 합 100%, 실지급 ≤ 총 풀)과 위험 항목(테이블 밖 랭크 스킵, 용기패스 프리미엄 100명 초과, 스테이킹/용기패스 매칭 실패, 동점으로 인한 구간 경계 이동)을 검출한다. "아레나 상금 표 만들어줘", "이번 시즌 상금 계산해줘", "상금 표 검증해줘" 같은 요청에 사용. 시즌 등록(ManageSeasons)이나 정산 실행(NCG 지급 서명·전송)은 이 스킬의 범위 밖이다.
---

# 아레나 상금 표 계산

> 이 스킬은 2026-08-30 세션에서 처음 SKILL.md로 작성됐다. 5개 스킬 중 1순위(`arena-reward-table`)만
> 구현했다 — 나머지(`arena-season-preview`/`arena-announce`/`arena-settlement-check`/
> `arena-season-checklist`)는 설계·값 차단 해소를 기다리는 미착수 상태다. 상위 컨텍스트는
> `docs/arena-season-prep-spec.md`(저장소 루트 기준)를 참고.

## 도구 현황 (2026-08 기준)

| 도구 | 위치 | 역할 |
| --- | --- | --- |
| `arena-reward-table.ts` | `tools/9c/arena-reward-table.ts` (bun) | CLI 본체. 표 계산 + 라이브 데이터 조회 + 불변식 검사 |
| `arena-reward-calc.ts` | `tools/9c/lib/arena-reward-calc.ts` | 순수 계산 로직 (I/O 없음, 결정적) |
| `arena-reward-sources.ts` | `tools/9c/lib/arena-reward-sources.ts` | 랭킹/스테이킹/용기패스 조회 어댑터 (API + CSV 폴백) |
| `arena-network.ts` | `tools/9c/lib/arena-network.ts` | 네트워크별 호스트·planet-id 매핑 (스킴 2종, 혼동 주의) |
| `arena-reward-png.ts` | `tools/9c/lib/arena-reward-png.ts` | SVG 빌드 + `@resvg/resvg-js`로 PNG 래스터화 (근사 재현) |
| 골든 픽스처 | `tools/9c/fixtures/arena-reward-table.golden.json` | Odin S39 / Heimdall CS9, 라이브로 실측·교차검증됨 |
| 회귀 검증기 | `tools/9c/fixtures/verify-arena-reward-table.ts` | CLI를 실제로 실행해 골든 픽스처와 대조 (`--live` 옵션으로 라이브 API까지 검증) |
| 유닛 테스트 | `tools/9c/lib/*.test.ts` | `bun test`. 계산 로직 + SVG 빌더를 골든 픽스처로 검증 |

의존성: `@resvg/resvg-js`(PNG 래스터화, 저장소 루트 `package.json`) — `bun install` 필요.

실행: `bun test tools/9c/lib/` (31 pass) / `bun run tools/9c/fixtures/verify-arena-reward-table.ts [--live]`.

---

## 한눈에 보기 (TL;DR)

- **무엇을 하는 스킬인가**: RankingPool·그룹별 배분 비율·보너스 배수 3종을 사람이 입력하면, 그걸로 10개
  랭크 구간의 지급액 표를 백오피스와 동일한 공식으로 계산하고, 랭킹·스테이킹·용기패스 데이터를 붙여
  실제 유저별 지급액까지 낸다. 백오피스가 스스로 검증하지 않는 항목(인원/비율 불변식, 테이블 밖 랭크
  스킵, 프리미엄 100명 상한, 매칭 실패, 동점 경계 이동, C# decimal ↔ JS double 반올림 경계값 — §4-1)을
  표면화하는 게 이 스킬의 존재 이유다.
- **핵심 원칙**: 계산은 백오피스(`ArenaRewardService.GenerateTierGroups` /
  `ConvertTierGroupsToRewardTiers` / `CalculateRewards`)와 **동일한 로직**을 재구현한 것이다 —
  다른 답을 내면 그게 버그다. 이 스킬이 새로 추가하는 건 계산 자체가 아니라 **불변식 검증과 위험
  항목 표면화**다.
- **꼭 알아야 할 핵심 사실 6가지** (근거는 각 단계·`references/`에):
    1. 계산에 쓰이는 풀은 `RankingPool` 하나뿐이다. `TotalPool`/`CompetitionPercentage`는 코드가
       절대 읽지 않는 inert 필드다 — UI에 세 칸이 있다고 셋 다 쓰이는 게 아니다.
    2. **절삭(정수 버림)은 `ConvertTierGroupsToRewardTiers`에서만 일어난다.** 그룹 금액 산출
       (`GenerateTierGroups`)은 전부 decimal이라 `FullSum == GroupReward`가 항상 성립한다. 절삭은
       조건별로 **독립적으로** 이뤄진 뒤 basic을 뺀 델타로 저장되므로, 보너스가 "정확히 basic×배수"가
       아니라 최대 1 gold 어긋날 수 있다.
    3. 스테이킹 레벨은 `deposit≥5000→lv3`, `≥500→lv2`, 그 외 `0` 딱 두 단계뿐이다. lv1은 없다.
    4. 매칭 키가 다르다 — **스테이킹은 agentAddress, 용기패스는 avatarAddress** 기준. 매칭 실패
       리포트도 이 둘을 분리해서 낸다.
    5. **실지급 ≤ 총 풀은 등호가 아니라 상한이다.** 전원이 스테이킹 lv3 + 용기패스를 들어야 상한에
       닿고, 거기에 절삭까지 겹쳐 항상 조금 못 미친다. 등호로 두면 매 시즌 오탐이 난다.
    6. 백엔드는 인원 합(500)·비율 합(100%) 불변식을 **검증하지 않는다.** 어긋난 설정을 넣어도 그대로
       계산된다 — 이 스킬이 대신 잡는다.
- **범위 밖**: 시즌 등록(`ManageSeasons` 9개 입력), NCG 지급 서명·전송, 디스코드 공지는 이 스킬이 하지
  않는다. PNG는 만든다(스펙 문서 §7-2 레이아웃 근사 재현) — 단 **"티켓 정보" 블록은 뺐다.** 시즌
  타입별 문구 틀 확보는 `arena-announce`(3순위)의 값 차단 항목이라, 문구 없이 숫자만 넣으면 완성된
  것처럼 보이지만 실제로는 틀린 레이아웃이 된다. "블록 정보"(시작/종료 블록)는 넣되 **추정 날짜는
  안 넣는다** — 블록↔시간 환산은 `arena-season-preview`가 만들 공용 모듈(§6-3) 소관이라 여기서
  중복 구현하지 않는다.
- **시작 전 필수 확인**: 이 스킬은 몇 가지 미해결 항목 위에 있다. 맨 아래 "아직 해소되지 않은 것"을
  먼저 본다.

### 스킬 설계 철학

담당자가 손으로 계산기를 두드리거나 스프레드시트를 만드는 대신, RankingPool·비율·배수 같은 **몇 개
숫자만 입력**하면 나머지(그룹 경계, 조건별 지급액, 불변식 검증, 실제 랭킹 데이터 대입)는 스킬이
채운다. 다만 "무엇을 조절할지"는 항상 담당자 몫이다 — 스킬은 조용히 지난 시즌 값이나 코드 기본값을
재사용하지 않는다(아래 "도구 기본값 정책" 참고). 계산이 백엔드와 갈릴 위험은 골든 픽스처 회귀
테스트로 막는다.

---

## 0. 적용 범위 확인

이 스킬은 **이미 등록·진행 중이거나 완료된 시즌의 상금 표를 계산·검증**하는 것에만 적용된다. 아래
중 하나라도 해당하면 이 스킬 범위 밖이다:

- 새 시즌을 `ManageSeasons`에 등록하는 것 (→ `arena-season-preview`, 미착수)
- 공지 문구 작성이나 디스코드 전송 (→ `arena-announce`, 미착수)
- 실제 NCG 지급 서명·전송 (→ `arena-settlement-check` + 사람의 수동 실행, `arena-settlement-check`는
  미착수)
- 상금 계산 로직 자체를 바꾸는 것 (예: 새로운 보너스 조건 추가) — 이건 `ArenaRewardService.cs` 코드
  변경이 필요한 별도 작업이지 이 스킬로 다룰 수 없다

## 1. 입력 — 담당자가 매번 명시적으로 줘야 하는 것

**"도구 기본값 정책" (스펙 문서 §8-1 결정사항)**: 아래 6개 값은 CLI가 **절대 조용히 채우지 않는다.**
하나라도 빠지면 즉시 중단하고 무엇이 빠졌는지 알려준다. `ArenaRewardModels.CreateDefault()`의
`couragePassMultiplier=1.0`은 폼 프리필 초기값일 뿐 운영 baseline이 아니다 — 코드 기본값을 스킬이
대신 판단해서 채우면 매 시즌 값이 다른데도 옛 값이 재사용되는 사고가 조용히 날 수 있다.
⚠️ **"1.2"도 안정된 상수로 취급하지 말 것.** Heimdall CS9은 담당자 실측 스크린샷으로 1.2가
역산 확인됐지만(`references/fixtures/golden-fixture-answer-1.md`), 이건 그 시즌 한 건의 관측값이지
"운영 baseline"이 아니다 — Odin S39는 같은 방식으로 확인된 적이 없고, percentages·
couragePassMultiplier는 시즌·타입마다 다를 수 있음이 그 실측으로 드러났다. 게다가 백오피스에
표시되는 값 자체가 최신이 아닐 수 있고, 지난 시즌 실데이터로 대사해 보면 배수가 다르게 나온
사례도 보고됐다(2026-09-02) — 1.0이든 1.2든 과거 문서 값이든, **그 시즌 담당자가 확인해 준 값이
아니면 신뢰하지 말 것.**

| 값 | CLI 플래그 | 비고 |
| --- | --- | --- |
| RankingPool(총 풀) | `--pool` | 코드상 `Season.TotalPrize`와 연결 없음(운영 관례일 뿐) — 다르면 WARN으로 표시, 담당자 판단 |
| 그룹별 배분 비율 10개 | `--percentages 7,8,7,9,12,18,18,12,6,3` | 합 100이어야 함(불변식, 안 지키면 FATAL). 시즌·타입마다 다를 수 있음 — Heimdall CS9 실측값은 `8,8,8,10,12,19,17,10,5,3`이었다 |
| 그룹별 인원 10개 | `--players 2,3,4,6,10,25,37,38,125,250` | 합 500이어야 함(불변식, 안 지키면 FATAL) |
| 스테이킹 lv2 배수 | `--staking-lv2` | 코드 기본값 0.5 |
| 스테이킹 lv3 배수 | `--staking-lv3` | 코드 기본값 1.0 |
| 용기패스 배수 | `--courage-pass` | 코드 기본값(폼 프리필) 1.0. **시즌마다 다름** — 반드시 해당 시즌 담당자 확인값을 받아 입력할 것, 과거 관측값(1.2 등)을 재사용하지 말 것 |

여섯 개를 매번 반복 입력하기 번거로우면 `--config <path.json>`으로 한 번에 줄 수 있다(내용은 위
6개 키를 담은 JSON) — 다만 이것도 "명시 입력"이지 조용한 기본값이 아니다: 파일이 없으면 그대로
중단된다.

## 2. 데이터 소스 — 랭킹 · 스테이킹 · 용기패스

세 데이터 모두 **API 기본 + CSV 폴백** 하이브리드다(설계 논의는
`references/data-sources.md` 참고). 상금 표 자체(그룹/티어) 계산에는 랭킹·스테이킹·용기패스가
필요 없다 — `--table-only`로 그룹/티어/불변식만 뽑을 수 있다. 유저별 실지급까지 내려면(기본 모드)
세 소스가 다 필요하다.

| 소스 | API (기본) | 상태 | CSV 폴백 |
| --- | --- | --- | --- |
| 랭킹 | `GET {host}/leaderboard/completed?seasonId=` | ✅ 인증 불필요, 실측 확인 | `--ranking-csv` (컬럼: `avatar_address,agent_address,name_with_hash,ranking,score,total_win,total_lose,level`) |
| 스테이킹 | `GET garage.nine-chronicles.dev/staking-for-arena/main/{Planet}/{seasonId}.json` | ✅ 인증 불필요, 시즌 종료 시점 스냅샷 구조 | `--staking-csv` (컬럼: `agent_address,deposit` — **이 스킬이 추가한 폴백. 실제 백엔드엔 스테이킹 CSV 경로 자체가 없다**, garage뿐) |
| 용기패스 | `GET {SEASONPASS_API_URL}/api/admin/premium-users?...` | ❌ HS256 JWT 필요, 서명 시크릿이 k8s Secret 전용이라 이 환경엔 없음. 호출 시 `NoJwtSecretError` | `--courage-pass-csv` (컬럼: `avatar_addr,product_id,agent_Addr` — **`agent_Addr`만 대문자 A**, 백엔드 실제 CSV 포맷과 동일) |

`--courage-pass-csv` 없이 돌리면 전원 용기패스 미보유로 계산되고 경고가 출력된다 — 실제로 패스를
가진 유저가 있다면 **과소지급**으로 계산된다는 뜻이므로, 결과를 그대로 지급 리스트로 쓰면 안 된다.

⚠️ **`/leaderboard/completed`는 서버의 캐시된 블록 높이(`cached-block-info`) 기준으로 "완료
여부"를 판정하는 것으로 보인다.** 실측(2026-08-30): 캐시가 실제 체인보다 58만 블록 이상 뒤처져
있었고, 그 상태에서 방금 끝난 시즌은 `400 "ongoing or future"`를 반환했다(오래된 완료 시즌은
정상). CLI는 이 400을 지수 백오프로 3회까지 재시도한다(`fetchCompletedLeaderboard`) — 그래도
실패하면 캐시가 아직 안 따라온 것일 수 있으니 잠시 후 재시도하거나 `--ranking-csv`로 우회한다.

⚠️ **`/seasons`의 페이지 파라미터는 `pageNumber`/`pageSize`이지 `limit`이 아니다.** `limit`을 주면
조용히 무시되고 기본 10건만 온다 — 이 세션에서 실제로 걸렸던 함정. `pageSize` 상한은 서버가 100으로
못박아뒀다(`fetchSeasons`가 100씩 페이지네이션).

⚠️ **Season.Id가 네트워크 간에 충돌한다.** Odin S39와 Heimdall CS9이 둘 다 `Season.Id=40`이다(실측
확인). 시즌은 `network + arenaType + seasonGroupId`로 식별해야 한다 — CLI의
`--network`/`--season-type`/`--season-group-id` 세 플래그가 이 조합이고, `resolveSeasonId`가 내부
`Season.Id`로 변환해준다.

⚠️ **Thor는 아레나 엔드포인트가 없다.** `thor-arena.9c.gg` DNS 미해석 확인(2026-08-30). `--network
thor`는 즉시 명확한 에러로 거부되지, 조용히 빈 결과를 내지 않는다.

## 3. 실행

⚠️ 아래 예시의 `--percentages`/`--courage-pass` 값은 **Heimdall CS9 실측값이 아니라 코드
`CreateDefault()`의 폼 프리필 값**이다 — 명령어 형태를 보여주기 위한 자리표시자일 뿐, 그대로
복사해서 실제 시즌에 쓰면 안 된다. 실행 전 반드시 그 시즌 담당자에게 확인받은 값으로 바꿀 것.

```bash
# 표만 (오프라인, 라이브 데이터 불필요)
bun run "$(git rev-parse --show-toplevel)/tools/9c/arena-reward-table.ts" --table-only --json --pool 400000 --percentages "7,8,7,9,12,18,18,12,6,3" --players "2,3,4,6,10,25,37,38,125,250" --staking-lv2 0.5 --staking-lv3 1.0 --courage-pass 1.2

# 실제 유저별 지급액까지 (라이브 랭킹+스테이킹, 용기패스는 CSV)
bun run "$(git rev-parse --show-toplevel)/tools/9c/arena-reward-table.ts" --network odin --season-type SEASON --season-group-id 39 --pool 400000 --percentages "7,8,7,9,12,18,18,12,6,3" --players "2,3,4,6,10,25,37,38,125,250" --staking-lv2 0.5 --staking-lv3 1.0 --courage-pass 1.2 --courage-pass-csv ./courage-pass.csv

# PNG까지 (다른 플래그와 함께 --png <경로>만 추가하면 됨)
bun run "$(git rev-parse --show-toplevel)/tools/9c/arena-reward-table.ts" --table-only --pool 400000 --percentages "7,8,7,9,12,18,18,12,6,3" --players "2,3,4,6,10,25,37,38,125,250" --staking-lv2 0.5 --staking-lv3 1.0 --courage-pass 1.2 --png ./odin-s39-rewards.png
```

`--json` 없이 실행하면 사람이 읽기 좋은 표 + 불변식 리포트를 콘솔에 출력한다. 결과의 `title`은
`[ {네트워크} ] Arena {Season|Championship} {번호} Rewards` 형식이다 — 스펙 문서 §7-2: **구분은
네트워크가 아니라 시즌 타입에서 온다** (Odin 챔피언십도 "Season"이 아니라 "Championship"으로 찍힘).

## 4. 판정 기준

| 등급 | 동작 | 예시 |
| --- | --- | --- |
| **OK** | 계속 | 인원 합 500, 비율 합 100%, 실지급 ≤ 풀 |
| **WARN** | 계속하되 리포트에 표기, 판단은 사람에게 | `TotalPrize ≠ RankingPool`, 테이블 밖 랭크 스킵, 스테이킹 매칭 실패, 용기패스 100명 도달, 부동소수점 반올림 경계값 |
| **FATAL** | 중단(exit 1) | 인원 합 ≠ 500, 비율 합 ≠ 100%, `sum(groupReward) ≠ RankingPool`, 실지급 상한 초과(총합 또는 그룹별) |

`checkInvariants`(순수 함수, `tools/9c/lib/arena-reward-calc.ts`)가 5개 기본 불변식(`players-sum` /
`percent-sum` / `group-reward-sum` / `payout-upper-bound` / `rounding-boundary-risk`)을 내고, CLI가
라이브/CSV 데이터가 있을 때 추가로 `total-prize-vs-ranking-pool`(WARN) / `skipped-ranks`(WARN) /
`staking-match-failures`(WARN) / `courage-pass-premium-100`(WARN)을 더한다.
`payout-upper-bound`는 총합(`sum <= RankingPool`)뿐 아니라 그룹별(각 그룹의 최대 지급액 <= 그 그룹의
`groupReward`)로도 확인한다 — 한 그룹이 초과 지급되고 다른 그룹이 그만큼 덜 나가 총합에서는 상쇄되는
경우를 총합 검사만으로는 못 잡기 때문.

### 4-1. `rounding-boundary-risk` — C# decimal vs JS double (2026-08-31 확인)

도메인 담당자가 실제 백엔드(`CalculateRewardsWithDynamicTable`)를 직접 실행해 이 스킬의 골든
픽스처와 셀 단위로 대조한 결과, **불일치 1건이 실제로 확인됐다**: pool 400,000·구간 "6-9"·
용기패스+스테이킹lv3 조건에서 백엔드는 **6,999**를 주는데 이 스킬(과 골든 픽스처)은 **7,000**을
계산한다. 200,000(1-2 구간)·250,000(6-9 구간)도 같은 유형.

**원인**: 이 조건 셀은 수식을 풀면 배수 값과 무관하게 항상 정확히 `그룹상금/인원수`와 같아지는데
(`eachPlayerGetsNone`을 만들 때 나눈 값을 그대로 다시 곱하기 때문), 그 중간 나눗셈이 정수로 안
떨어질 때 **JS의 double과 C#의 decimal이 반올림 방향을 다르게 처리**해서 결과가 정수 경계 바로
위/아래로 갈린다. 이 스킬의 7,000은 수식이 의도한 "정확한" 값이지만, 실제 지급은 백엔드가 하는
대로 6,999다.

**선택한 대응 (계산 로직은 안 바꿈)**: `arena-reward-calc.ts`의 `computeBoundaryRiskFields`가
BigInt 유리수 연산으로 "이 칸의 참값이 정수에 정확히 걸쳐 있고, 그 중간 나눗셈이 double/decimal
양쪽 모두에서 오차 없이 표현 가능하지 않은 경우"만 정확히 골라내 `RewardTier.boundaryRiskFields`에
표시하고, `checkInvariants`가 이를 WARN(`rounding-boundary-risk`)으로 올린다 — 계산값을 억지로
"수정"하지 않는다(단서 3개뿐이라 C# decimal의 반올림 규칙을 100% 확신 못 함 — 계산 로직을 잘못
바꾸는 게 더 위험하다고 판단, 2026-08-31 결정). 흔한 경우다 — 기본 배수(0.5/1.0/1.0)로 훑어보면
1만~100만 풀 범위에서 약 15%의 칸이 이 경계에 걸린다.

`X-API-Key`를 확보하면 `/calculate`의 원시 decimal 값으로 더 많은 사례를 검증해 이 대응을
재평가할 수 있다(`arena-settlement-check` SKILL.md §6 참고, 같은 키가 필요).

**⚠️ 검증 함정**: 위 성질(배수 무관하게 `그룹상금/인원`과 같아짐) 때문에, CP+St3(또는 다른 "풀스택
조합" 열)로 설정값(특히 `couragePassMultiplier`)이 맞는지 검증하면 안 된다 — 값이 맞든 틀리든
똑같이 나온다. 실측 스크린샷/골든 픽스처와 대조할 땐 **Basic 열이나 단일 보너스 열(CP만, Stk2만
등)**을 써야 배수 차이를 실제로 잡아낼 수 있다. (2026-09-01, 이 세션에서 실제로 이 함정에 걸려
couragePassMultiplier 불일치를 한 번 놓친 뒤 확인. §5의 CSV 폴백 검증 근거도 이 함정에 해당하는
CP+St3 하나만 썼다는 점 참고 — 그 검증 자체가 재검토 대상일 수 있다.)

## 5. 수용 기준 (완료 판정) — 현재 상태

| 항목 | 상태 |
| --- | --- |
| Odin S39 / Heimdall CS9 골든 픽스처 셀 값(10그룹×6열) 오차 없이 재현 | ✅ `bun test tools/9c/lib/arena-reward-calc.test.ts tools/9c/lib/arena-reward-png.test.ts` (36 pass, 419 assertions) |
| CLI가 라이브 API로 같은 두 시즌을 재현(시즌 메타·참가자 수) | ✅ `bun run tools/9c/fixtures/verify-arena-reward-table.ts --live` |
| CSV 폴백(스테이킹+용기패스) 경로가 API와 동일한 결과를 냄 | ✅ 수동 검증 — Odin S39 rank1("Mazi")에 스테이킹 lv3+용기패스 CSV를 먹였더니 골든 픽스처의 CP+St3(14,000)와 정확히 일치 |
| 인원/비율 불변식이 깨진 설정에서 FATAL로 잡음 | ✅ `arena-reward-calc.test.ts`의 "invariant checks catch broken configs" 스위트 |
| PNG 렌더링 (스펙 §7-2 레이아웃 근사 재현) | ✅ `arena-reward-png.ts` — 골든 픽스처 두 시즌 모두 육안 확인(제목·10그룹·합계 행 전부 일치). 추정 날짜는 `arena-season-preview`의 공용 블록타임 모듈(`arena-block-time.ts`)이 생긴 뒤 연결 완료(2026-08-30) — Odin S39로 라이브 재생성해 실제 백테스트 값(§`arena-season-preview` 참고, 시작 08:48:16 UTC·종료 07:13:56 UTC)과 마진 이내 일치 확인. **티켓 정보 블록만 의도적으로 계속 제외**(스코프 노트 위 참고 — `arena-announce` 조사로 애초에 공지에도 안 들어간다는 게 확인돼 계속 제외가 맞는 결정으로 굳어짐) |
| 용기패스 API(JWT) 실사용 | ❌ 미해결 — 시크릿 미보유, CSV 폴백만 실사용 가능 |

---

## 6. 근거 (확인됨)

> 이 장은 이 세션에서 소스 코드 열람 + 라이브 API 실측으로 확인된 것만 담는다.
> `references/backend-source/`에 원본 C# 전문, `references/data-sources.md`에 데이터 소스별
> 상세 조사, `references/fixtures/golden-fixture-answer-1.md`에 골든 픽스처 교차검증 기록이 있다.

| 사실 | 근거 |
| --- | --- |
| 계산 체인: `GenerateTierGroups`(decimal, 절삭 없음) → `ConvertTierGroupsToRewardTiers`(여기서만 int 절삭, 조건별 독립 floor 후 basic 차감) → `CalculateRewards`(랭크→티어 매칭, 스테이킹/용기패스 보너스 합산) | `ArenaRewardService.cs:557-628`, 사용자가 전문 확인·전달(main `ba13ff5`) |
| `RankingPool`만 쓰임, `TotalPool`/`CompetitionPercentage`는 inert | 위와 동일, `ArenaRewardModels.cs:113-115` |
| `GenerateTierGroups`의 `totalPlayers` 매개변수는 본문에서 안 쓰임 — 그룹 구성은 `GroupDefinitions`로만 결정 | 사용자 확인 |
| 스테이킹 레벨: `deposit≥5000→3`, `≥500→2`, 그 외 `0`. lv1 없음 | `ArenaRewardService.cs` `GetStakingLevel` |
| 매칭 키: 스테이킹=agentAddress, 용기패스=avatarAddress | `ArenaRewardService.cs` `CalculateRewards` |
| `CreateDefault()` 값: RankingPool 500,000 / staking2 0.5 / staking3 1.0 / couragePass 1.0(폼 프리필) / 그룹 인원 [2,3,4,6,10,25,37,38,125,250] / 비율 [7,8,7,9,12,18,18,12,6,3] | `ArenaRewardModels.cs:121-145`(전문 확인) |
| `CouragePassEntry` CSV 컬럼: `avatar_addr`/`product_id`/`agent_Addr`(마지막만 대문자 A) | `ArenaRewardModels.cs` `[Name]` 속성 + `CouragePassEntryMap`(전문 확인) |
| `ArenaRankingEntry` CSV 컬럼: `avatar_address`/`agent_address`/`name_with_hash`/`ranking`/`score`/`total_win`/`total_lose`/`level` | `ArenaRankingEntryMap`(전문 확인) |
| `/leaderboard/completed?seasonId=` 인증 불필요, `LeaderboardEntryResponse` 필드가 `ArenaRankingEntry`와 1:1 | Swagger(`odin-arena.9c.gg/swagger/v1/swagger.json`) + 라이브 curl 실측 |
| garage 스테이킹 JSON은 시즌 종료 시점 스냅샷(`metadata.timestamp`/`currentBlockIndex` 내장) — 라이브 조회가 아님 | 라이브 curl 실측(`garage.nine-chronicles.dev/staking-for-arena/main/Odin/38.json`) |
| 용기패스 API는 SeasonPass 어드민 API(`/api/admin/premium-users`), HS256 JWT 필요, 시크릿은 k8s Secret 전용 | 사용자 조사(SeasonPass 레포 `apps/api/app/api/admin.py:226`, `apps/api/app/utils.py:12`) |
| `season_index`가 존재하지 않으면 필터가 조용히 안 걸려 전체 시즌 프리미엄 유저가 반환됨(`season_index=0`도 falsy라 같은 함정) | 사용자 조사, `get_pass()` 동작 |
| `/seasons`는 `pageNumber`/`pageSize` 파라미터(최대 100), `limit`은 무시됨 | 라이브 curl 실측 — `limit=200`을 줘도 기본 10건만 옴을 확인, Swagger로 진짜 파라미터명 확인 |
| Odin S39(seasonGroupId=39, arenaType=SEASON)와 Heimdall CS9(seasonGroupId=9, CHAMPIONSHIP)는 둘 다 내부 `Season.Id=40` | 라이브 curl 실측(양쪽 `/seasons`) |
| Thor 아레나 엔드포인트 없음 (`thor-arena.9c.gg` DNS 미해석) | 이 세션에서 curl 확인 |
| `/leaderboard/completed`가 캐시된 블록 높이 기준으로 완료 여부를 판정하는 것으로 보임 — 캐시가 58만+ 블록 뒤처진 상태에서 최근 시즌에 400 반환, 오래된 완료 시즌은 정상 | 라이브 curl 실측(`cached-block-info` vs `/leaderboard/completed?seasonId=41,42`) |

## 7. 아직 해소되지 않은 것

| 항목 | 상태 | 필요한 것 |
| --- | --- | --- |
| 용기패스 API 실사용 | 시크릿 미보유 | `NC_MAINNET_SEASONPASS_JWT_KEY` 별도 전달 — 받으면 `fetchCouragePassEntries`의 스텁만 채우면 됨(호출 형태는 이미 정의돼 있음) |
| PNG의 "티켓 정보" 블록 | 의도적으로 미포함(스코프 노트, §2 위 참고) | `arena-announce`가 시즌 타입별 문구 틀을 확보하면 그때 같이 재검토 |
| ~~PNG의 추정 날짜(블록→시간 환산)~~ | ✅ **해소됨** (2026-08-30) — `arena-block-time.ts` 연결 완료, `--png` 사용 시 네트워크가 지정돼 있으면 자동으로 날짜 라인 추가 | — |
| PNG가 실제 백오피스 산출물과 시각적으로 얼마나 비슷한지 | 미확인 — 이 세션은 스펙 문서 §7-2의 텍스트 설명만 근거로 만듦, 실제 샘플 PNG(Heimdall CS9·Odin S39)를 직접 보고 대조한 적 없음 | 실물 샘플과 나란히 놓고 비교 |
| `/leaderboard/completed`의 캐시-지연 400이 정말 일시적인지 | 추정(재시도로 통과하는 사례를 아직 직접 관측 못함 — 오래된 시즌에서 우회 확인만 함) | 시즌 종료 직후 실제로 이 스킬을 돌려서 재시도가 통과하는지 관측 |
| 스테이킹 CSV 폴백 포맷 | 이 스킬이 임의로 정의(`agent_address,deposit`) — 백엔드에 대응 포맷 없음 | 실사용 전 담당자 검토 |
