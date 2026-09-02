# 정산(settlement) 조사 — 스펙 원안 전제가 틀렸다는 걸 확인 (2026-08-30)

> 스펙 문서(`docs/arena-season-prep-spec.md`)의 4순위 `arena-settlement-check`는
> "완료 시즌의 실지급 리스트를 대사(계산값 vs 실지급값)"를 전제로 했다. 조사 결과 이 전제가
> **성립하지 않는다** — 대조할 "실지급 정본"이 시스템 어디에도 없다. 이 문서는 그 조사 과정과
> 결론을 남긴다.

## 핵심 발견 — 두 가지가 완전히 다른 것이었다

**`ArenaNcgSettlement.razor`는 유저별 지급 페이지가 아니다.** 페이지 제목은 "아레나 법인수익
정산"이고, 하는 일은 **행성당 딱 1건** — 아레나 정산 주소의 NCG 잔액 전체를 고정된 법인 수취
주소로 한 건의 트랜잭션으로 쓸어 보내는 것. 유저 목록도, 유저별 확정 지급액도, 랭킹·스테이킹·
용기패스도 이 페이지에 없다. 스펙 문서가 이걸 "지급 리스트 대사"로 오해하고 있었다.

### 조회 경로 실측 (NineChronicles.Backoffice — 이 세션에서 접근 불가, 비공개 레포)

`ArenaSettlementController`(`/api/arena/settlement/*`)와 `ArenaRewardController`
(`/api/arena/reward/*`)가 존재한다. 인증은 JWT가 아니라 `X-API-Key` 헤더의 단순 문자열 비교
(`[Authorize(AuthenticationSchemes = "ApiKey")]`).

| 엔드포인트 | 용도 |
| --- | --- |
| `POST /api/arena/settlement/balance` | 정산 주소 NCG 잔액 |
| `POST /api/arena/settlement/sign` | 전송 tx 서명 → txId |
| `POST /api/arena/settlement/stage` | 서명된 tx 스테이징 |
| `POST /api/arena/settlement/tx-result` | tx 상태·블록 인덱스 |
| `GET /api/arena/reward/completed-seasons?planet=` | 완료 시즌 목록 |
| `GET /api/arena/reward/leaderboard?planet=&seasonId=` | 리더보드 |
| `GET /api/arena/reward/staking-entries?planet=&seasonId=` | 스테이킹(garage 기준) |
| `GET /api/arena/reward/courage-pass-entries?planet=&seasonIndex=` | 용기패스 |
| `POST /api/arena/reward/calculate` | 상금 계산 실행 |

**리스트 조회 경로는 없다** — "유저별 확정 지급 리스트"라는 개념 자체가 이 API에 없다.

### 두 가지 결정적 사실

1. **Sign/Stage 상태가 어디에도 저장되지 않는다.** txId·nonce·sender는 Blazor 서킷 메모리
   (`odinTxId`, `signedTransactions` 등)에만 있고 DB에도 API에도 남지 않는다. 페이지를
   새로고침하면 사라진다. 사후에 "이 시즌 정산이 서명·스테이징 됐는지"를 조회할 방법이 없다.
2. **`/api/arena/reward/calculate`는 완전히 stateless다.** DB에서 아무것도 읽지 않고, 요청
   본문의 `RankingCsvContent`(필수)/`CouragePassCsvContent`/`StakingEntries`를 파싱해
   `ArenaRewardService.CalculateRewardsWithDynamicTable(...)`에 그대로 넘긴다. **→ "완료
   시즌의 확정 지급액"이라는 정본 레코드가 시스템 어디에도 저장돼 있지 않다.** 매번 CSV를
   넣어 다시 계산하는 구조다. 검증 가능한 건 "같은 입력을 넣었을 때 같은 결과가 나오는가"까지다.

## 이 세션이 독립적으로 확인한 것 (ArenaService 공개 레포)

`NineChronicles.Backoffice`(위 컨트롤러들이 있는 레포)는 이 환경에서 접근 불가(비공개, 이름
변형 8가지 시도 후 전부 `repository not found`) — 위 내용은 검증 못 함, 재확인 대기 중.

다만 **공개 레포 `ArenaService`**(`github.com/planetarium/ArenaService`)는 접근되고, 여기엔
정산 관련 코드가 전혀 없다는 것만 확인했다(`grep -ri settlement` 전체 0건) — "정산은 다른
레포에 있다"는 설명과 모순되지 않는다.

Mimir GraphQL의 `transaction(txId:)` 쿼리로 **tx 상태(txStatus: SUCCESS/FAILURE/STAGING/
INCLUDED/INVALID) 조회는 인증 없이 된다**는 것도 실제 tx로 확인했다 — 스펙 §6-1 "지급 후
거래 성공 여부 확인은 읽기 동작이라 자동화해도 안전합니다"와 정확히 맞아떨어지는, 지금 당장
자동화 가능한 유일한 조각이다.

## 결론 — 이 스킬의 범위 재정의

| 원래 스펙의 전제 | 실제 |
| --- | --- |
| "완료 시즌의 실지급 리스트를 대사" | 그런 리스트가 없다. 대조할 정본이 없다 |
| "총 지급액 ≤ 총 풀 검증" | `/api/arena/reward/calculate`(stateless)로 재계산은 가능하나, API 키 미보유로 지금은 호출 불가 |
| "지급 후 거래 성공 여부 확인" | ✅ **지금 바로 가능** — Mimir tx 상태 조회, 이번에 구현 |

**1차 구현 범위**: tx 상태 조회(`arena-tx-status.ts`)와 그걸 감싼 CLI(`arena-settlement-check.ts`)
+ 로컬 감사 로그(`--log-file`)만. "유저별 지급 대사"는 API 키를 받아야 재개할 수 있다.
