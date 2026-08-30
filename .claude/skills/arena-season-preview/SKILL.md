---
name: arena-season-preview
description: Nine Chronicles 아레나 시즌을 ManageSeasons(시즌 관리 백오피스)에 등록하기 전에, 9개 입력값(Season Group ID·Start Block·Round Interval·Round Count·Arena Type·Required Medal Count·Total Prize·Battle/Refresh Policy ID)의 블록↔날짜 프리뷰와 서버가 검증하지 않는 항목(정책 ID↔시즌 타입 관측 일치, 직전 시즌과의 gap, round_interval 관측 기준값, Total Prize 관측 기준값)을 대사할 때 사용. "이번 시즌 등록 전에 확인해줘", "시즌 프리뷰 뽑아줘", "블록 날짜 환산해줘" 같은 요청에 사용. 실제 ManageSeasons 등록·시즌 저장은 이 스킬의 범위 밖 — 사람이 백오피스에서 직접 한다.
---

# 아레나 시즌 프리뷰 · 등록 전 대사

> 이 스킬은 2026-08-30 세션에서 처음 SKILL.md로 작성됐다. 5개 스킬 중 2순위. 1순위
> `arena-reward-table`과 같은 세션에서 이어서 만들어졌고, 유일한 설계 차단이었던 "정책 ID 검증
> 경로 유무"를 이 세션이 직접 조사해 해소한 뒤 착수했다 — 조사 기록은
> `references/policy-id-investigation.md`.

## 도구 현황 (2026-08 기준)

| 도구 | 위치 | 역할 |
| --- | --- | --- |
| `arena-season-preview.ts` | `tools/9c/arena-season-preview.ts` (bun) | CLI 본체 |
| `arena-block-time.ts` | `tools/9c/lib/arena-block-time.ts` | **공용** 블록↔시간 환산 모듈 (스펙 §6-3, `arena-reward-table`의 PNG 블록 정보도 이걸 가져다 씀) |
| `arena-policy-fingerprint.ts` | `tools/9c/lib/arena-policy-fingerprint.ts` | 정책 ID↔시즌 타입 "관측된 관습" 대조 (정본 아님, 절대 FATAL 안 됨) |
| `arena-network.ts` | `tools/9c/lib/arena-network.ts` | (스킬 1과 공유) 네트워크별 호스트 매핑에 Mimir 호스트 추가 |
| 회귀 검증기 | `tools/9c/fixtures/verify-arena-season-preview.ts` | 라이브 데이터로 실제 시즌 재현 2건(Odin S39·Heimdall CS9) + 대조군 1건 + 합성 양성 케이스 2건(스펙 §6-4) + **날짜 추정 백테스트 2건** 실행 |
| 유닛 테스트 | `tools/9c/lib/arena-block-time.test.ts`, `arena-policy-fingerprint.test.ts` | `bun test`. 순수 함수(추정 수식, 지문 대조)만 검증 |

실행: `bun test tools/9c/lib/` / `bun run tools/9c/fixtures/verify-arena-season-preview.ts` (라이브 필요).

---

## 한눈에 보기 (TL;DR)

- **무엇을 하는 스킬인가**: 담당자가 `ManageSeasons`의 "Add New Season" 화면에 값을 넣기 **전에**,
  같은 9개 값을 이 스킬에 먼저 넣어서 (a) 시작/종료 블록이 실제로 언제쯤인지 날짜로 미리 보고,
  (b) 서버가 절대 검증하지 않는 것들(정책 ID 정합성·gap·Total Prize)을 미리 대사한다.
- **핵심 원칙**: 서버(`ManageSeasons` + `AddSeasonWithRoundsAsync`)가 이미 자동으로 하는 일
  (종료 블록 계산, 라운드 전개, **블록 범위 겹침** 검사)은 다시 만들지 않는다. 이 스킬이 새로 하는
  건 **서버가 안 하는 것**뿐이다 — §5-1 참고.
- **꼭 알아야 할 핵심 사실 5가지**:
    1. **정책 ID 검증은 구조적으로 FATAL이 될 수 없다.** 공개 API(Swagger 전수 확인)도, DB 스키마도
       "이 정책 ID = 이 시즌 타입"을 보증하지 않는다. `Name`은 운영자가 자유 입력한 문자열이고, 실측으로
       관습이 깨진 사례(thor 시즌 2, 진짜 운영 구간)까지 있다. 그래서 이 체크는 **항상 WARN**이고,
       "이 정책은 X 전용이다"라고 절대 말하지 않는다 — "지금까지 관측된 바로는 X에서만 쓰였다"까지만.
    2. **헤드리스 RPC로 블록 timestamp를 못 읽는다.** `ExplorerQuery.blockQuery`가 스키마엔 있지만 이
       배포의 쿼리 루트엔 연결이 안 돼 있다(introspection으로 확인). **Mimir**(`block(index:)`)만
       된다.
    3. **Mimir 인덱서가 헤드리스 tip보다 몇 초 뒤처진다.** 헤드리스 tip을 그대로 Mimir에 조회하면
       "Document not found" 레이스가 난다. `blocks(take: 1)`로 **Mimir 자체의 최신 블록**을
       기준점으로 삼아야 한다.
    4. `battle_ticket_policy_id`와 `refresh_ticket_policy_id`는 실측 시즌 전부에서 항상 같은 값이었다
       — 다르면 그 자체가 WARN.
    5. **Total Prize도 정책 ID와 같은 처지다** — 코드 연결이 없는 관례일 뿐이라 절대 FATAL이 아니고,
       타입별 관측 기준값(SEASON 400,000 / CHAMPIONSHIP 500,000 / OFF_SEASON 0)과의 차이는 WARN.
- **범위 밖**: 실제 시즌 등록(`ManageSeasons` 클릭), 시즌 저장은 이 스킬이 하지 않는다. 이 스킬은
  등록 **전에** 사람이 보는 대사 리포트만 만든다.
- **날짜 정확도는 "값 차단"이지 "설계 차단"이 아니다** (스펙 §6-3·§8-2) — 블록타임이 앞으로 바뀌어도
  이 스킬의 구조는 안 바뀐다. 아래 "아직 해소되지 않은 것"에 날짜 추정치의 정확도 검증 상태를 남긴다.

---

## 0. 적용 범위 확인

**이미 결정된 9개 입력값을 등록 전에 미리보기·대사하는 것**에만 적용된다. 아래는 범위 밖:

- 시즌 일정을 처음부터 기획하는 것(어떤 테마로 며칠짜리 시즌을 열지) — 그건 기획자 결정 사항
  (스펙 §8-1: "시즌 일정 결정 주체 = 기획자가 매 시즌 결정")
- 실제 `ManageSeasons` 등록 실행 — 사람이 백오피스에서 직접 클릭
- 공지 작성(`arena-announce`), 상금 표 계산(`arena-reward-table`, 이미 있음) — 별도 스킬

## 1. 입력 — ManageSeasons의 9개와 정확히 대응

`arena-reward-table`과 같은 "명시 입력 필수" 원칙이다. 아래 중 하나라도 빠지면 중단한다.

| CLI 플래그 | ManageSeasons 필드 | 비고 |
| --- | --- | --- |
| `--network` | (화면 자체가 네트워크별) | odin / heimdall / thor. thor는 Mimir가 없어 이 스킬 자체가 동작 안 함 |
| `--season-group-id` | Season Group ID | |
| `--arena-type` | Arena Type | SEASON / CHAMPIONSHIP / OFF_SEASON |
| `--season-start-block` **또는** `--season-start-date` | Season Start Block | 서버는 `직전 시즌 end+1`로 **프리필**하고 담당자가 수정 가능(§7-1). 프리필 그대로면 `--season-start-block`, 새로 날짜부터 정하는 보조 모드면 `--season-start-date` — 정확히 하나만 |
| `--round-interval` | Round Interval | 전 시즌·전 타입 관측값 10,800(§7-1). 다르면 WARN |
| `--round-count` | Total Number of Rounds | |
| `--required-medal-count` | Required Medal Count | |
| `--total-prize` | Total Prize | 타입별 관측 기준값과 대사(WARN만, §6-2) |
| `--battle-policy-id` | Battle Policy ID | 관측 지문과 대사(WARN만) |
| `--refresh-policy-id` | Refresh Policy ID | 관측 지문과 대사(WARN만) |

선택: `--reward-table-pool <n>` — `arena-reward-table`에서 이미 정한 `RankingPool`이 있으면 넘겨서
Total Prize와 직접 대사(§6-2 "Total Prize ↔ RankingPool"). 안 주면 이 항목은 생략된다.

## 2. 계산 흐름

1. **Mimir로 현재 블록타임 모델을 측정**한다 (`arena-block-time.ts`) — tip + ~1일/~7일/~30일 전
   블록의 timestamp를 읽어 초/블록을 3구간 독립 측정하고, 구간 간 편차를 "블록당 오차"로 삼는다.
   오차는 변환하려는 블록 거리에 비례해서 커진다(§6-3).
2. `--season-start-date`면 이 모델로 날짜→블록 역산(보조 모드). `--season-start-block`이면 그대로
   기준 블록으로 쓴다(기본 모드).
3. `종료 블록 = 시작 블록 + round_interval × round_count - 1` — **서버와 동일한 공식**
   (`SeasonRepository.cs`의 `end = start + interval × count - 1`), 재구현이 아니라 재현.
4. 시작/종료 블록을 각각 날짜로 환산(마진 동반).
5. 라이브 `/seasons`에서 이 네트워크의 직전 시즌(끝 블록이 이번 시작 블록보다 작은 것 중 가장 큰
   것)을 찾아 gap을 계산.
6. `round_interval`이 관측 상수(10,800)와 다른지, policy id 두 개가 서로 같은지, 각각의 지문이
   arenaType과 맞는지, Total Prize가 타입별 관측 기준값과 맞는지 대사.

## 3. 실행

```bash
# 기본 모드 — 시작 블록이 이미 정해진 경우 (보통 프리필값 그대로)
bun run tools/9c/arena-season-preview.ts --network odin --season-group-id 46 --arena-type SEASON \
  --season-start-block 20265224 --round-interval 10800 --round-count 14 \
  --required-medal-count 0 --total-prize 400000 --battle-policy-id 4 --refresh-policy-id 4

# 보조 모드 — 날짜부터 정하고 블록을 역산하는 경우
bun run tools/9c/arena-season-preview.ts --network odin --season-group-id 46 --arena-type SEASON \
  --season-start-date 2026-11-09T00:00:00Z --round-interval 10800 --round-count 14 \
  --required-medal-count 0 --total-prize 400000 --battle-policy-id 4 --refresh-policy-id 4

# 백테스트 — 이미 끝난 시즌의 9개 입력으로, 예측했던 종료 날짜가 실제 Mimir 기록과 얼마나
# 차이 나는지 검증 (날짜 추정 정확도를 스스로 재확인하고 싶을 때)
bun run tools/9c/arena-season-preview.ts --network odin --season-group-id 39 --arena-type SEASON \
  --season-start-block 19260824 --round-interval 10800 --round-count 14 \
  --required-medal-count 0 --total-prize 400000 --battle-policy-id 4 --refresh-policy-id 4 \
  --verify-season
```

### 3-1. `arena-reward-table`와 이어 쓰는 실제 순서

`Total Prize`(이 스킬의 입력)와 `RankingPool`(`arena-reward-table`의 입력)은 스펙 §6-2가 확인한 대로
코드로 연결돼 있지 않다 — 두 도구에 각자 따로 입력하는 숫자다. 실제로 새 시즌을 준비할 때는 이
순서로 쓴다:

1. **담당자가 이번 시즌 `RankingPool`·배분 비율·배수를 정해서 `arena-reward-table --table-only`로
   상금 표를 먼저 만들고 확정한다** (스펙 §5: "명세에서: total_prize 하나뿐" — RankingPool 결정이
   먼저 일어난다는 뜻).
2. **그 `RankingPool` 값을 이 스킬의 `--total-prize`와 `--reward-table-pool`에 동일하게 넘긴다**:
   ```bash
   bun run tools/9c/arena-season-preview.ts --network odin --season-group-id 46 --arena-type SEASON \
     --season-start-block 20265224 --round-interval 10800 --round-count 14 \
     --required-medal-count 0 --total-prize 400000 --battle-policy-id 4 --refresh-policy-id 4 \
     --reward-table-pool 400000
   ```
   `--total-prize`는 "ManageSeasons에 실제로 입력할 값"이고 `--reward-table-pool`은 "그게
   `arena-reward-table`에서 정한 값과 같은지 대조할 기준"이다 — 이 예시처럼 둘을 항상 같은 값으로
   주면 `total-prize-vs-reward-table-pool` 체크가 자연히 OK로 나온다. 일부러 다른 값을 실험하고
   싶을 때만 둘을 다르게 준다.
3. 여기서 나온 리포트에 FATAL이 없으면, 같은 9개 값을 그대로 `ManageSeasons` "Add New Season"
   화면에 입력한다 (이 스킬은 등록을 대신 하지 않는다 — §0 범위 확인).

## 4. 판정 기준

| 등급 | 이 스킬에서 실제로 나오는 항목 |
| --- | --- |
| **OK** | gap 없음, round_interval 일치, 정책 지문 일치, Total Prize 기준값 일치 |
| **WARN** | gap 발생/겹침, round_interval 이탈, battle≠refresh policy id, 정책 지문 불일치/미상, Total Prize 기준값 이탈, `--reward-table-pool`과 불일치 |
| **FATAL** | **이 스킬엔 없다.** 정책·Total Prize 체크는 구조적으로 정본이 없어 FATAL이 될 수 없고(위 "핵심 사실 1·5"), 겹침은 서버가 이미 막아준다(§3 "백오피스가 이미 하는 일") — 이 스킬은 등록 *전* 참고용이라 서버가 최종 방어선 |

`arena-reward-table`과 달리 이 스킬엔 **FATAL 등급이 원천적으로 없다.** 계산 실수로 안전장치를
잃는 게 아니라, 대사 대상(정책 ID·Total Prize) 자체가 코드로 보증되지 않는 관례이기 때문이다 —
FATAL을 억지로 만들면 매번 오탐이 나거나 거짓 확신을 준다.

## 5. 수용 기준 (완료 판정) — 현재 상태

| 항목 | 상태 |
| --- | --- |
| 블록 산출 공식이 서버와 동일 (`end = start + interval×count - 1`) | ✅ 결정적 계산 + **Odin S39·Heimdall CS9의 실제 9개 입력값(라이브 `/seasons` id=40 조회)으로 재현 — 실제 기록된 종료 블록(19,412,023 / 10,892,380)과 정확히 일치**(`verify-arena-season-preview.ts` 시나리오 1·2) |
| 정책 불일치·gap을 **검출** — 양성 케이스 각 1건 이상에서 실제 검출됨 | ✅ `verify-arena-season-preview.ts` 5시나리오(실제 시즌 재현 2 + 대조군 1 + 합성 양성 2, 스펙 §6-4) 전부 라이브 통과 |
| 정책 불일치·gap을 **치명으로** 검출 (스펙 §6-4 원문 문구) | ⚠️ **설계상 불가능으로 확정, 원문과 다르게 구현** — WARN 고정. `references/policy-id-investigation.md`에 근거. §6-4는 조사 전에 쓰인 문구라 실제 조사 결과(§6-2가 최종 반영한 결론)와 어긋남 — 이 스킬은 §6-2를 따른다 |
| 실제 시작/종료 블록·날짜를 입력 9개로부터 마진과 함께 재현 | ✅ **블록·날짜 둘 다 충족.** 블록은 실제 시즌 2건으로 정확히 재현(위 행). 날짜는 **담당자가 직접 백테스트한 결과**(Mimir의 실제 기록 timestamp가 정본 — 외부 기록 불필요, `references/date-estimate-backtest.md`)로 검증됨: Odin S39 잔차 -1.5분, Heimdall CS9 잔차 -4.7분, 둘 다 이 스킬이 계산한 마진(±5.6분/±6.5분) 이내. 이 백테스트를 `arena-block-time.ts`의 `backtestSeasonDates()`와 CLI의 `--verify-season` 플래그로 도구화해 회귀 검증에 편입 |
| 오프라인 결정적 유닛 테스트 | ✅ `arena-block-time.test.ts`(6) + `arena-policy-fingerprint.test.ts`(5), 라이브 무의존 |

---

## 6. 근거 (확인됨)

> `references/policy-id-investigation.md`에 정책 ID 조사 전문이 있다. 아래는 이 스킬 구현에 쓰인
> 핵심만 요약.

| 사실 | 근거 |
| --- | --- |
| `TicketPolicyResponse`(공개 API)엔 `id`/`name`이 없다 — `defaultTicketsPerRound`/`maxPurchasableTicketsPerRound`/`purchasePrices` 3개뿐 | Swagger 전문(`odin-arena.9c.gg/swagger/v1/swagger.json`) 확인, 이 세션 |
| 21개 엔드포인트 전수 확인 — `/policies` 류 독립 조회 경로 없음 | 위와 동일 |
| DB의 `TicketPolicy` 모델엔 `ArenaType` 컬럼 자체가 없다. `Name`은 운영자 자유 입력 | 사용자 조사(DB 스키마 열람), 이 세션이 `ArenaService`(공개 레포) `Policy.razor` 소스에서 `ArenaType` 참조 0건으로 재확인(2026-08-30) |
| **종료 블록 공식이 이 스킬 구현과 완전히 동일** — `long endBlock = startBlock + (roundInterval * roundCount) - 1;` | 이 세션, `ArenaService.Shared/Repositories/SeasonRepository.cs`의 `AddSeasonWithRoundsAsync` 직접 확인(2026-08-30) |
| **시작 블록 프리필 = `GetLastSeasonEndBlockAsync() + 1`** (첫 시즌이면 `?? 1`) — `OrderByDescending(s => s.EndBlock).FirstOrDefaultAsync()`로 "가장 큰 EndBlock" 정의도 확인됨 | 이 세션, `SeasonRepository.cs` + `ManageSeasons.razor:273` 직접 확인 |
| **`IsBlockRangeOverlappingAsync`는 겹침만 막고 gap은 허용** — `!(s.EndBlock < startBlock \|\| s.StartBlock > endBlock)`, 연속성 검사 없음 | 이 세션, `SeasonRepository.cs` 직접 확인 — 스펙 §5-1 "서버는 겹침만 막고 연속성은 안 봄"과 정확히 일치 |
| **`round_interval`은 하드코딩이 아니라 시즌마다 자유 입력 가능한 파라미터** — `AddSeasonWithRoundsAsync`/`UpdateSeasonAsync`의 일반 `int` 매개변수 | 이 세션, `SeasonRepository.cs`/`ISeasonRepository` 직접 확인 — 이 스킬이 10,800을 "관측 기준값(WARN)"으로만 다루고 하드 규칙으로 안 다룬 게 맞았음을 뒷받침 |
| `BattleTicketPolicyId`/`RefreshTicketPolicyId`는 DB 레벨 FK 제약(`[ForeignKey]`)이 있어 존재하지 않는 ID는 막히지만, `ArenaType`과의 정합성 검사는 없다 | 이 세션, `ArenaService.Shared/Models/Season.cs` 직접 확인 |
| ⚠️ **새로 확인된 위험**: `AdjustSeasonEndBlockAsync(seasonId, newEndBlock)`가 존재하고, `season.EndBlock = newEndBlock`만 하고 끝난다 — 라운드 재전개도, `interval×count` 재검증도, 겹침 재검사도 없다. 시즌 등록 후 종료 블록을 수동 조정하면 이 스킬이 재현한 공식(`end = start + interval×count - 1`)과 실제 DB 값이 어긋날 수 있다는 뜻 | 이 세션, `SeasonRepository.cs` 직접 확인. **이 스킬은 아직 이 케이스를 감지하지 못한다** — §7 미해결 항목에 추가 |
| `battle_ticket_policy_id == refresh_ticket_policy_id`가 전 시즌(odin 44 · heimdall 42 · thor 8) 예외 없이 성립 | 사용자 조사 2건, 완전 교차검증됨 |
| **thor 시즌 2(블록 폭 ~6800, 실제 운영 구간)가 "new Championship" 정책을 OFF_SEASON에 사용** — "이름=타입" 관습이 실제로 깨진 신뢰할 수 있는 사례 | 사용자 조사(2번째 답변), block 폭까지 확인해 시드 row 배제 |
| odin/heimdall/thor의 season id=1은 블록 폭 1~2 — 시드/더미 row로 판단, 관측 데이터에서 제외 | 사용자 조사(2번째 답변) |
| `ExplorerQuery.blockQuery`는 헤드리스 GraphQL 스키마에 존재하나 이 배포 쿼리 루트엔 연결 안 됨 | 이 세션, introspection으로 확인(`__schema.queryType.fields`에 없음, 어떤 타입도 `ExplorerQuery` 반환 안 함) |
| Mimir `block(index:)`로 블록 timestamp 조회 가능, `blocks(take:1)`로 최신 블록(자체 tip) 조회 가능 | 이 세션, 라이브 curl 확인(`odin-mimir.9c.gg/graphql`) |
| 헤드리스 tip을 그대로 Mimir에 조회하면 인덱싱 지연으로 "Document not found" 레이스 발생 | 이 세션, 개발 중 실제로 재현(`19498976`에서 실패, 수 초 후 재조회 시 `blocks(take:1)`로는 성공) |
| Odin 라이브 블록타임(2026-08-30 측정): ~1일/7일/30일 창 전부 7.96~7.97초/블록, 창간 편차 ~0.008초/블록 | 이 세션, 라이브 측정 |
| 날짜 추정 백테스트: Odin S39·Heimdall CS9 종료 블록 예측이 실제 Mimir 기록과 각각 -1.5분/-4.7분 차이(둘 다 마진 이내). 명목 8초/블록을 썼다면 Odin +94~124분, Heimdall -34~36분로 훨씬 나빴을 것 | 담당자 백테스트(`references/date-estimate-backtest.md`) + 이 세션의 `--verify-season` 재현 |
| Odin 실측 블록타임 ≈ 7.962초, Heimdall ≈ 8.013초 — 네트워크 간 차이가 명목값 가정을 위험하게 만드는 주 원인 | 담당자 백테스트 |
| `round_interval` = 10,800 (전 타입·전 시즌) | 스펙 문서 §7-1 (라이브 Odin 응답 기준, 기존 확인 사항) |
| Total Prize 관측 기준값: SEASON 400,000 / CHAMPIONSHIP 500,000 / OFF_SEASON 0 | 스펙 문서 §6-2 참고 자료(라이브 10건 관측), 이 세션이 스킬1 개발 중 Odin s40/Heimdall s40에서 재확인(400,000/500,000) |

## 7. 아직 해소되지 않은 것

| 항목 | 상태 | 필요한 것 |
| --- | --- | --- |
| ~~날짜 추정치의 실제 정확도~~ | ✅ **해소됨** (2026-08-30, 담당자 백테스트 + `--verify-season` 도구화) — 위 §5·§6-4 참고 | — |
| Thor의 블록타임 | 미확인·확인 불가 — Thor는 Mimir 자체가 없어 이 스킬이 애초에 동작 안 함(`requireMimirHost`가 즉시 에러) | Thor용 Mimir가 생기면 재검토 |
| gap 발생이 "무조건 오류"인지 "의도적 공백 허용"인지 | 담당자 정책 미확인(스펙 §6-2) | 담당자 확인 — 확인되면 이 스킬의 gap 문구를 조건부로 조정 |
| ~~`--reward-table-pool` 연동 워크플로~~ | ✅ **해소됨** (2026-08-30) — §3-1에 실제 순서(RankingPool 확정 → 동일 값을 `--total-prize`/`--reward-table-pool`에 전달 → FATAL 없으면 ManageSeasons에 등록) 문서화, 라이브로 재현 확인 | — |
| **`AdjustSeasonEndBlockAsync`로 종료 블록이 수동 조정된 시즌 감지** | 새로 발견(2026-08-30, 소스 확인) — 이 API가 라운드 재전개·공식 재검증·겹침 재검사 없이 `EndBlock`만 바꿔서, 이 스킬이 재현하는 `end = start+interval×count-1` 공식과 실제 DB 값이 어긋날 수 있음. 지금은 이 케이스를 감지하는 체크가 없음 | 라이브 `/seasons`의 `endBlock`이 이 스킬의 계산값과 다르면 WARN을 내는 체크 추가 — 다음 착수 시 반영 |
