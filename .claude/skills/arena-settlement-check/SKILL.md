---
name: arena-settlement-check
description: 아레나 NCG 정산 tx의 온체인 상태(SUCCESS/FAILURE/STAGING/INCLUDED/INVALID)를 조회할 때 사용. 백오피스의 서명(Sign)·스테이징(Stage) 상태가 브라우저 새로고침하면 사라지는 문제를 메꾸기 위해, txId만 있으면 사후에도 tx가 실제로 성공했는지 확인하고 로컬 로그로 남긴다. "이 tx 성공했는지 확인해줘", "정산 tx 상태 조회해줘" 같은 요청에 사용. ⚠️ 스펙 문서가 원래 그리던 "유저별 실지급 대사"는 이 스킬의 현재 범위가 아니다 — 대조할 정본 데이터 자체가 시스템에 없다는 게 조사로 확인됐다(아래 참고). 실제 NCG 전송 서명·실행은 이 스킬의 범위 밖.
---

# 아레나 정산 tx 상태 확인 (부분 구현)

> 이 스킬은 2026-08-30 세션에서 처음 SKILL.md로 작성됐다. 5개 스킬 중 4순위지만, **스펙 문서가
> 전제한 범위 전체를 구현하지 못했다** — 조사 중 전제 자체가 틀렸다는 게 드러났다. 아래
> "무엇이 왜 이렇게 됐는지"를 먼저 읽을 것.

## 무엇이 왜 이렇게 됐는지 (먼저 읽을 것)

스펙 문서 §6-1은 이 스킬의 역할을 "완료 시즌의 실지급 리스트를 대사(계산값 vs 실지급값)"로
그렸다. 조사해보니 **대조할 "실지급 정본"이 시스템 어디에도 저장되지 않는다** — 상세 조사는
`references/settlement-investigation.md`. 세 줄 요약:

1. `ArenaNcgSettlement.razor`(정산 페이지)는 유저별 지급 리스트가 아니라 **행성당 1건, 법인
   수익(NCG 잔액 전체)을 고정 주소로 쓸어보내는** 화면이다.
2. 실제 유저별 상금 계산 API(`/api/arena/reward/calculate`)는 **완전히 stateless**다 — 저장된
   "확정 지급액"이 없고, 매번 CSV를 넣어야 다시 계산된다.
3. 정산 페이지의 Sign/Stage 상태(txId 등)는 **브라우저 메모리에만 있고 새로고침하면 사라진다**
   — DB에도 API에도 안 남는다.

그래서 이번 착수에서는 스펙이 원래 요구한 "실지급 대사"는 만들지 못했다(대조 대상이 없어서
원천적으로 불가능 — API 키를 받아 `/calculate`를 stateless 재계산기로만 쓰는 건 다음 단계).
대신 **3번이 실제로 위험한 진짜 문제**라서, 스펙 §7-1이 이미 "읽기 동작이라 자동화해도
안전하다"고 표시해둔 **tx 상태 확인**만 지금 구현했다.

## 도구 현황

| 도구 | 위치 | 역할 |
| --- | --- | --- |
| `arena-settlement-check.ts` | `tools/9c/arena-settlement-check.ts` (bun) | CLI 본체 |
| `arena-tx-status.ts` | `tools/9c/lib/arena-tx-status.ts` | Mimir `transaction(txId:)` 조회 |
| 회귀 검증기 | `tools/9c/fixtures/verify-arena-settlement-check.ts` | 실제 완결된 tx 1건 + 존재하지 않는 tx 1건, 라이브 |

실행: `bun run tools/9c/fixtures/verify-arena-settlement-check.ts` (라이브 필요).

## 1. 무엇을 하는가

txId를 주면 Mimir로 온체인 상태를 조회해서 `SUCCESS`/`FAILURE`/`STAGING`/`INCLUDED`/`INVALID`
중 무엇인지, 어느 블록에 포함됐는지, 서명자가 누군지 보여준다. `--log-file`을 주면 조회 결과를
로컬 JSONL로 누적 저장한다 — 서버가 아무것도 안 남기기 때문에, 이 로그가 "언제 뭘 확인했는지"의
유일한 기록이 된다.

## 2. 실행

```bash
# 단건 조회
bun run tools/9c/arena-settlement-check.ts --network odin --tx <txId>

# 여러 건(쉼표 구분) + 로컬 감사 로그
bun run tools/9c/arena-settlement-check.ts --network odin \
  --tx <txId1>,<txId2> --log-file ./settlement-log.jsonl
```

찾지 못한 tx는 크래시하지 않고 `[?]` 표시로 나머지 결과와 함께 출력된다(배치 중 하나가 아직
Mimir에 안 잡혔다고 전체가 막히면 안 되므로). `FAILURE`/`INVALID`가 하나라도 있거나 못 찾은 tx가
있으면 exit 1.

⚠️ **Mimir는 "tx 없음"을 빈 결과가 아니라 GraphQL 에러로 반환한다** — `arena-block-time.ts`
개발 때 이미 겪었던 것과 같은 패턴인데 이번에도 처음엔 놓쳤다(개발 중 크래시로 발견, 바로 수정).
메시지 텍스트(`"not found"` 포함 여부)로 구분해야 한다.

## 3. 판정 기준

| 상태 | 의미 |
| --- | --- |
| `SUCCESS` | 정상 완료 |
| `FAILURE` / `INVALID` | 실패 — 반드시 확인 필요, exit 1 |
| `STAGING` / `INCLUDED` | 아직 처리 중 |
| 못 찾음 | txId가 틀렸거나 Mimir 인덱싱이 아직 안 됨 — exit 1 |

## 4. 수용 기준 — 현재 상태

| 항목 | 상태 |
| --- | --- |
| 완료 시즌의 총 지급액 ≤ 총 풀 재현(스펙 §6-4 원문) | ❌ **미착수, 원천적으로 대조 대상 없음** — `/api/arena/reward/calculate`는 stateless라 "확정 지급액"이 없다. API 키를 받으면 "서버 계산 vs 스킬 1 계산"으로 재정의해서 착수 가능 |
| 스킵 랭커·100명 도달·매칭 실패 검출(스펙 §6-4 원문) | ➡️ **이미 스킬 1(`arena-reward-table`)에 구현돼 있음** — 완료 시즌에 대해 `arena-reward-table`을 실행하면 이 세 가지가 전부 나온다. 이 스킬이 새로 만들 필요가 없었다 |
| 지급 후 tx 성공 여부 확인(스펙 §7-1) | ✅ **완료** — 실제 tx로 라이브 검증(`0f2623c4...`, SUCCESS, block 19,499,632) |

---

## 5. 근거 (확인됨)

`references/settlement-investigation.md`에 조사 전문이 있다. 핵심만:

| 사실 | 근거 |
| --- | --- |
| `ArenaNcgSettlement.razor`는 유저별 지급이 아니라 행성당 1건 법인 수익 정산(NCG 잔액 전체 → 고정 주소) | 조사(비공개 레포 열람) — 이 세션은 그 레포에 직접 접근 못 해 미검증, 재확인 대기 |
| `/api/arena/settlement/*` 4개 엔드포인트(잔액/서명/스테이징/tx결과) 전부 잔액·tx 단위, "리스트" 개념 없음 | 위와 동일 |
| `/api/arena/reward/calculate`는 완전히 stateless, DB 미조회 | 위와 동일 |
| Sign/Stage 상태가 Blazor 서킷 메모리에만 있고 DB·API 어디에도 안 남음 | 위와 동일 |
| `ArenaService`(공개 레포)엔 정산 관련 코드가 전혀 없음(`settlement` 문자열 0건) | 이 세션이 직접 클론해 확인(2026-08-30) — 위 조사 내용과 모순 없음 |
| Mimir `transaction(txId:)`로 tx 상태 조회 가능(인증 불필요) | 이 세션, 라이브 tx로 확인(2026-08-30) |
| `blockIndex`는 `transaction` 쿼리의 최상위 필드이지 `object` 안이 아님 — 스키마 검증이 즉시 에러로 잡아줌(조용히 null 아님) | 이 세션, 두 형태 다 라이브로 테스트 |
| "tx 없음"은 GraphQL 에러로 옴(빈 데이터 아님) — `arena-block-time.ts`의 `fetchBlockTimestamp`와 같은 패턴 | 이 세션, 개발 중 재현·수정 |

## 6. 아직 해소되지 않은 것

| 항목 | 상태 | 필요한 것 |
| --- | --- | --- |
| `NineChronicles.Backoffice` 소스 직접 확인 | 비공개 레포, 이 환경에서 접근 불가 | GitHub 토큰/권한 확보 후 재확인 |
| `X-API-Key` 발급 | 미보유 | 받으면 `/api/arena/reward/calculate`로 스킬 1 계산 엔진과 서버 공식 계산을 직접 대조하는 걸로 스킬 범위 재확장 가능 |
| 법인 정산 잔액(`/api/arena/settlement/balance`) 조회 자동화 | API 키 필요, 미착수 | 위와 동일 |
| Sign/Stage 자체의 자동화 | **의도적으로 범위 밖으로 유지** — 실제 자금 이동이라 사람이 직접 해야 함(스펙 §4 원칙과 일치) | — |
