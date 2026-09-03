---
name: arena-season-checklist
description: 아레나 시즌 준비 4개 스킬(arena-reward-table·arena-season-preview·arena-announce·arena-settlement-check)의 --json 산출물을 한 화면에 집계하고, 시즌 캐시(cached-block-info) 읽기 점검을 곁들일 때 사용. "지금까지 확인한 거 한눈에 보여줘", "이번 시즌 준비 체크리스트" 같은 요청에 사용. 이 스킬 자체는 아무것도 새로 계산하지 않는다 — 4개 스킬이 이미 낸 --json 파일을 읽어서 등급(OK/WARN/FATAL)만 모은다. 파일을 안 준 스킬은 "미실행"으로 표시될 뿐 에러가 아니다.
---

# 아레나 시즌 준비 체크리스트 (집계)

> 이 스킬은 2026-08-30 세션에서 처음 SKILL.md로 작성됐다. 5개 스킬 중 5순위, 스펙 문서가 "파생"
> (1-4 재사용)으로 정의한 그대로 — 계산 로직이 없고 순수 집계만 한다.

## 도구 현황

| 도구 | 위치 | 역할 |
| --- | --- | --- |
| `arena-season-checklist.ts` | `tools/9c/arena-season-checklist.ts` (bun) | CLI 본체 |
| `arena-season-checklist.ts`(lib) | `tools/9c/lib/arena-season-checklist.ts` | 정규화·집계 순수 로직 |
| 유닛 테스트 | `tools/9c/lib/arena-season-checklist.test.ts` | 정규화·집계 로직만(오프라인) |
| 회귀 검증기 | `tools/9c/fixtures/verify-arena-season-checklist.ts` | 4개 스킬을 실제로 실행해 --json 만들고 집계까지 라이브로 검증 |

실행: `bun test tools/9c/lib/arena-season-checklist.test.ts` (12 pass) /
`bun run tools/9c/fixtures/verify-arena-season-checklist.ts` (라이브 필요).

---

## 1. 무엇을 하는가

4개 스킬의 `--json` 출력 파일을 받아서, 각 스킬이 낸 `invariants`/`checks` 배열을 하나의 화면에
모으고, 전체 상태(OK/WARN/FATAL 중 가장 나쁜 것)를 계산한다. 그 외에 `--check-cache
odin,heimdall`로 `/cached-block-info`(시즌 캐시) 읽기 점검을 곁들일 수 있다.

**계산은 하나도 안 한다.** 4개 스킬이 이미 계산·검증한 결과를 읽기만 한다(스펙 §6-1: "파생").

### 스킬마다 JSON 모양이 다르다 — 이 스킬의 진짜 일

| 스킬 | JSON 키 | 비고 |
| --- | --- | --- |
| `arena-reward-table` | `invariants` | |
| `arena-season-preview` | `invariants` | |
| `arena-announce` | `checks` | 키 이름만 다르고 항목 모양(`id`/`name`/`ok`/`level`/`detail`)은 같음 |
| `arena-settlement-check` | (배열 자체가 tx 결과) | `invariants`/`checks` 개념이 아예 없음 — SUCCESS→OK, FAILURE/INVALID→FATAL, STAGING/INCLUDED→WARN, 못 찾음→WARN으로 이 스킬이 매핑. **`partial: true`로 표시** — 스펙이 원래 요구한 "유저별 실지급 대사"는 여전히 없다는 뜻(스킬 4 SKILL.md 참고) |
| `arena-season-preview --verify-season` | (단일 `BacktestResult`: `anchorBlock`/`targetBlock`/`residualMinutes`/`marginMinutes`/`withinMargin`) | 완료된 시즌을 대상으로 날짜 추정기를 백테스트하는 모드라 `invariants` 목록이 아니라 이 별도 모양을 낸다. 이 스킬이 단일 항목 체크(`verify-season-backtest`, 마진 이내면 OK/아니면 WARN)로 정규화해 나머지 4개와 같은 화면에 모은다 |

## 2. 실행

```bash
# 각 스킬을 먼저 --json으로 실행해 파일로 저장
bun run "$(git rev-parse --show-toplevel)/tools/9c/arena-reward-table.ts" --table-only --json ... > reward.json
bun run "$(git rev-parse --show-toplevel)/tools/9c/arena-season-preview.ts" ... --json > preview.json
bun run "$(git rev-parse --show-toplevel)/tools/9c/arena-announce.ts" ... --json > announce.json
bun run "$(git rev-parse --show-toplevel)/tools/9c/arena-settlement-check.ts" --network odin --tx <txId> --json > settlement.json

# 집계
bun run "$(git rev-parse --show-toplevel)/tools/9c/arena-season-checklist.ts" --reward-table-json reward.json --season-preview-json preview.json --announce-json announce.json --settlement-json settlement.json --check-cache "odin,heimdall"
```

네 개 다 안 줘도 된다 — 준 것만 집계하고 나머지는 "미실행"으로 표시한다. **미실행은 OK로 치지
않지만 FATAL/WARN으로도 안 친다** — "확인 안 함"과 "확인했는데 정상"을 구분해야 하므로, 전체
상태 계산에서 아예 빠진다.

## 3. 판정 기준

전체 상태 = 모든 섹션(스킬 4개 + 시즌 캐시)의 개별 항목 중 **가장 나쁜 등급**. FATAL이 하나라도
있으면 FATAL, 없고 WARN이 하나라도 있으면 WARN, 전부 OK면 OK. 미실행 스킬의 항목은 이 계산에
안 들어간다.

## 4. 실측으로 확인된 것

이 스킬을 라이브로 돌려보다가 **상시적인 실제 문제**를 하나 발견했다: Odin·Heimdall 둘 다
`cached-block-info`의 캐시된 블록이 최신 시즌 시작 블록보다 **20만~60만 블록 뒤처져 있다**
(2026-08-30 실측, odin 581,393블록 / heimdall 223,488블록 차이). 이건 이 세션 초반에 우연히
한 번 관측한 게 아니라 — 세션 전체에 걸쳐 계속 이 상태였다는 뜻이다. `arena-reward-table`의
`/leaderboard/completed` 400 재시도 로직이 왜 필요한지, 이 체크가 매번 다시 증명해준다.

## 5. 수용 기준 — 현재 상태

| 항목 | 상태 |
| --- | --- |
| 4개 산출물의 등급을 한 화면에 집계 | ✅ 완료, 4개 스킬 전부 실제로 실행해 라이브 검증(`verify-arena-season-checklist.ts`) |
| 시즌 캐시 읽기 점검 | ✅ 완료, odin·heimdall 둘 다 라이브 확인 |
| 스킬 4의 "부분 구현" 상태를 집계에서 숨기지 않음 | ✅ `partial: true`로 명시 |

## 6. 아직 해소되지 않은 것

| 항목 | 상태 | 필요한 것 |
| --- | --- | --- |
| 스킬 4가 확장되면(§4 API 키 확보 시) 이 스킬의 `normalizeSettlementJson`도 같이 바뀌어야 함 | 알려진 결합 — 지금은 tx 상태만 다루도록 짜여 있음 | 스킬 4가 실지급 대사를 갖추면 `invariants` 키를 내도록 맞추고, 이 스킬은 `normalizeInvariantsJson`으로 통합 가능 |
| WARN 임계값(캐시 지연 100,000블록)이 근거 없이 정해짐 | 이 세션이 임의로 잡음 — "이상하다 싶을 정도"로만 정함 | 실제 정상 범위가 어느 정도인지 더 많은 관측치로 검증 |

## 없는 파일을 주면 어떻게 되는가 (2026-09-03 수정)

`--*-json`에 **존재하지 않는 경로**를 주면 예전에는 **stdout·stderr 0바이트에 exit 0**으로
끝났다. 인자를 아예 안 줬을 때(정상 리포트 + "미실행" 표시)보다 출력이 오히려 적으면서
종료 코드는 성공이라, 스크립트나 에이전트가 "집계 성공"으로 오인할 수 있었다.

원인은 `Promise.all`이 아니라 **없는 파일의 읽기 거부가 `.catch`에 전달되기 전에 프로세스가
먼저 종료되는 것**이다(실측 근거·재발 이력은 `tools/9c/lib/read-file.ts` 모듈 주석 참고). 지금은 읽기 전에
존재를 확인해 `"<라벨> 파일을 찾을 수 없습니다: <경로>"`로 명확히 실패하고 exit 1이다.

⚠️ 커밋 8049110이 `qa-checklist`에서 같은 증상을 고치며 원인을 "Promise.all의 동시 reject가
삼켜진다"고 적었는데, 2026-09-03 재현으로 **그 진단은 틀렸다**는 게 확인됐다(수정 자체였던
`.exists()` 사전 체크는 유효). 단독 `await`에서도 동일하게 재현된다 — 이벤트 루프를 살려두면
같은 읽기가 7ms 만에 ENOENT로 정상 reject하므로, "행"이 아니라 "조기 종료"다.
