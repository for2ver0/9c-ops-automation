---
name: datasheet-validate
description: Nine Chronicles 밸런스 구글 시트를 CSV로 내보낸 결과의 구조적 결함(중복 헤더, 행별 컬럼 수 불일치, 키 컬럼 공백, 행 수 급감)을 검증할 때 사용. "이 시트 검증해줘", "이 CSV 업로드해도 되는지 확인해줘", "datasheet-validate 돌려줘" 같은 요청에 사용. 밸런스 시트는 무인증 공개 상태로 확인돼 승인 없이 바로 실행 가능하다(docs/9c-update-automation-permission-request.md ① 참고). ⚠️ 원래 설계 문서가 그리던 4가지 검증(시트 사전검증·시트 간 참조 ID·회차 diff·CSV 파싱부) 중 이 스킬은 구조적 검증(CSV 파싱부 + 사전검증 일부)만 구현한다 — 시트마다 다른 스키마·타입·참조 규칙 검증은 lib9c 스키마 매핑이 선행돼야 해서 범위 밖이다(아래 참고).
---

# datasheet-validate (부분 구현 — 구조적 검증만)

> 이 스킬은 2026-09-01 세션에서 처음 SKILL.md로 작성됐다. 설계 문서("나인 크로니클 업데이트
> 자동화 설계" 부록 A-1)가 datasheet-validate에 요구한 네 가지 신규 검증 항목 중 **스키마
> 지식 없이 바로 만들 수 있는 것만** 구현했다. 왜 이렇게 됐는지 먼저 읽을 것.

## 무엇이 왜 이렇게 됐는지

설계 문서 부록 A-1은 이 스킬이 새로 만들어야 할 항목을 넷으로 든다:

1. **구글 시트 단계 사전 검증** — 기존 Backoffice 검증은 CSV로 내보낸 *뒤*에만 동작하고
   그마저 게이트가 아니다. **이번에 만든 것의 일부** — CSV로 내보낸 결과를 업로드 전에
   구조적으로 검증한다(시트 자체를 읽는 것도 포함, 아래 "무엇을 하는가" 참고).
2. **시트 간 참조 ID 검증** — **미착수.** "이 컬럼 값이 다른 시트의 Id로 실재하는가"를
   검사하려면 lib9c의 각 `ISheet` 구현이 어떤 컬럼을 어떤 다른 시트의 키로 참조하는지 시트별
   매핑이 있어야 한다. 그 매핑을 만드는 일 자체가 별도 조사 프로젝트라 이번 착수에 넣지 않았다.
3. **회차 간 시트 diff (N 대 N-1)** — **미착수.** 설계 문서 스스로 "비교 기준선을 lib9c
   커밋/태그에서 가져올지 별도 스냅샷을 둘지 미정"(미해결 B)이라고 적어뒀다 — 기준선 저장
   방식이 결정되지 않은 채로는 diff를 구현할 수 없다.
4. **CSV 파싱부 신규** — **이번에 만든 것.** 기존 Backoffice `CsvValidationService`의 결함
   4건(따옴표 안 쉼표 미처리, 빈 줄 제거로 인한 라인 번호 어긋남, 중복 헤더 무음 병합,
   quoting 없는 재조립)을 그대로 재현하지 않는 RFC4180 파서와, 그 결함들이 놓쳤던 자리를
   메우는 구조적 검증을 만들었다.

즉 이번 착수는 **"시트마다 다른 지식이 필요 없는" 절반만** 만들었다. 시트별 스키마·타입·
참조 규칙 검증(2번)은 스키마 매핑이 오면 별도로 붙인다 — 코드 구조
(`tools/9c/lib/datasheet-validate.ts`)에 함수를 추가하고 CLI에서 같이 호출하도록 확장하면 된다.

## 도구 현황

| 도구 | 위치 | 역할 |
| --- | --- | --- |
| `datasheet-validate.ts` | `tools/9c/datasheet-validate.ts` (bun) | CLI 본체 |
| 파싱/검증 로직 | `tools/9c/lib/datasheet-validate.ts` | 순수 함수(유닛 테스트 대상) |
| 유닛 테스트 | `tools/9c/lib/datasheet-validate.test.ts` | 파서·검증 로직 + v200450 실패 모드 3종 회귀 케이스, 네트워크 없이 실행 |
| 라이브 검증기 | `tools/9c/fixtures/verify-datasheet-validate.ts` | 실제 공개 밸런스 시트 CSV export를 직접 찔러 확인 |

실행: `bun test tools/9c/lib/datasheet-validate.test.ts` (유닛), `bun run tools/9c/fixtures/verify-datasheet-validate.ts` (라이브).

## 1. 무엇을 하는가

밸런스 구글 시트를 CSV로 내보낸 결과(로컬 파일 또는 공개 export URL)에 대해 네 가지
구조적 검증을 돌린다. 전부 **시트가 어떤 스키마인지 몰라도** 적용 가능한, 형식 자체의 결함이다.

1. **헤더 중복** — 같은 헤더 이름이 두 번 이상 나오면 FATAL. Backoffice의 기존 파서는
   `row[headers[j]]`로 Dictionary 키를 헤더 이름으로 써서 중복 헤더의 값을 무음으로 덮어쓴다
   (실측 사례: `worldboss_info.csv`의 `Vietnam` 중복, 부록 A-2) — 컬럼 하나가 통째로
   소실돼도 아무 에러가 안 뜬다.
2. **행별 컬럼 수 불일치** — 헤더 칸 수와 다른 행이 있으면 FATAL. 이 스킬의 파서는 RFC4180을
   따라 따옴표 안 쉼표를 값으로 흡수하므로, 여기서 잡히는 불일치는 진짜 데이터 결함이지
   Backoffice의 `lines[i].Split(',')`가 내던 오탐(부록 A-1, `WorldBossActionPatternSheet.csv`
   같은 정상 CSV를 컬럼 수 불일치로 잘못 잡던 문제)이 아니다.
3. **키 컬럼 공백** — 지정한 키 컬럼(`--key-column`, 보통 `Id`)이 비어 있는 행이 있으면
   FATAL. v200450 실패 모드 중 "key 컬럼 비움 → `ArgumentException`"을 업로드 전에 미리
   잡는다. 키 컬럼을 지정하지 않았거나 헤더에 없으면 건너뛰고 WARN — 강제하지 않는다
   (시트마다 키 컬럼 이름이 다를 수 있음).
4. **행 수 급감** — `--baseline-rows`로 직전 행 수를 넘기면, 이번 행 수가 그보다 줄었을 때
   FATAL. v200450에서 `SkillBuffSheet` 188행이 익스포트 과정에서 통째로 유실된 실패 모드를
   사후 대조로 잡는다. 증가는 정상(패치로 항목 추가)이라 통과. 기준값이 없으면(첫 실행)
   비교 없이 정보성으로만 현재 행 수를 알려준다.

## 2. 실행

```bash
# 로컬 CSV 파일 검증
bun run tools/9c/datasheet-validate.ts --csv ./MaterialItemSheet.csv --key-column Id

# 구글 시트 CSV export URL 직접 검증 (공개 시트만 — 인증 불필요)
bun run tools/9c/datasheet-validate.ts \
  --url "https://docs.google.com/spreadsheets/d/1Di903g3_mxdDd6gZuNhczE4MXwFI-lWnOqzuVPbGM7k/gviz/tq?tqx=out:csv&sheet=MaterialItemSheet" \
  --key-column Id

# 직전 실행의 행 수를 기준값으로 넘겨 급감 검출 (회차마다 이전 실행 결과를 기록해두고 사용)
bun run tools/9c/datasheet-validate.ts --csv ./MaterialItemSheet.csv --key-column Id --baseline-rows 421

# JSON으로
bun run tools/9c/datasheet-validate.ts --csv ./MaterialItemSheet.csv --json
```

FATAL이 하나라도 있으면 exit 1. 시트 탭마다(=lib9c TableCSV 파일마다) 따로 실행한다 — 이 CLI는
한 번에 한 CSV/탭만 본다.

**시트 export URL 만드는 법** — 구글 시트 gviz 엔드포인트로 특정 탭만 CSV로 받는다:
`https://docs.google.com/spreadsheets/d/<시트ID>/gviz/tq?tqx=out:csv&sheet=<탭이름>`.
밸런스 시트 ID(`docs/9c-update-automation-permission-request.md` ① 항목 참고)는
`1Di903g3_mxdDd6gZuNhczE4MXwFI-lWnOqzuVPbGM7k` — 2026-08-31 확인 기준 무인증 공개.

## 3. 판정 기준 요약

| 검사 | OK | WARN | FATAL |
| --- | --- | --- | --- |
| 헤더 중복 | 없음 | — | 중복 헤더 존재 |
| 행별 컬럼 수 | 전부 일치 | — | 헤더와 칸 수 다른 행 존재 |
| 키 컬럼 공백 | 전부 채워짐 | 키 컬럼 미지정 또는 헤더에 없음(검사 건너뜀) | 빈 값 존재 |
| 행 수 급감 | 기준값 이상 유지/증가, 또는 기준값 없음(정보성) | — | 기준값보다 감소 |

## 4. 범위 밖 (설계 문서 대비 의도적으로 뺀 것)

- **시트 간 참조 ID 검증** — lib9c 스키마별 참조 규칙 매핑이 선행돼야 함. 미착수.
- **회차 간 시트 diff (N 대 N-1)** — 비교 기준선을 어디서 가져올지(lib9c 커밋/태그 vs 별도
  스냅샷) 설계 문서 자체가 미정(미해결 B). `--baseline-rows`는 이 문제를 풀지 않는다 —
  "행 수"라는 가장 거친 지표 하나만 사람이 직접 넘겨서 비교하는 임시방편이다.
- **타입 검증** (숫자 컬럼에 문자열이 들어갔는지 등) — 컬럼별 타입은 시트마다 다르고 lib9c
  스키마 지식이 필요해 미착수.
- **`/table-patch` 업로드·Sign 자체를 막는 것** — D4 원칙(자동화는 라이브를 바꾸는 호출을
  하지 않는다)에 따라 이 스킬은 읽기·검증만 한다. FATAL이 뜨면 "업로드 전에 다시 확인하라"고
  알려줄 뿐, Sign 버튼을 대신 막지 않는다(설계 문서 미해결 A와 동일한 이유 — Backoffice의
  기존 검증도 게이트가 아니라 경고 표시 전용이라 이 스킬의 판정도 마찬가지 위치에 있다).
- **`spec-to-datasheet`가 제안한 값 자체가 맞는지** — "형식은 맞는데 값이 틀린" 경우는 이
  스킬이 볼 수 있는 범위가 아니다. 설계 문서가 이 구간의 유일한 검출 지점으로 지목한 건
  사람의 QA 체크리스트다(2.1절).

## 5. 근거

- `docs/9c-update-automation-permission-request.md` ① — 밸런스 시트가 무인증 공개 상태임을
  실측으로 확인한 기록. 서비스 계정 공유 요청 자체가 철회됨.
- 설계 문서 부록 A-1 — Backoffice `CsvValidationService`의 결함 4건과 v200450 실패 모드 3종
  (헤더 뭉개짐, key 컬럼 비움, `SkillBuffSheet` 188행 유실)의 근거.

## 6. 다음에 할 일

| 항목 | 상태 | 필요한 것 |
| --- | --- | --- |
| 시트 간 참조 ID 검증 | 미착수 | lib9c 시트별 참조 규칙 매핑 (별도 조사) |
| 회차 간 시트 diff (N 대 N-1) | 미착수 | 비교 기준선 저장 방식 결정(미해결 B) — lib9c 태그 기준 vs 별도 스냅샷 |
| 컬럼 타입 검증 | 미착수 | 시트별 컬럼 타입 정의 (별도 조사) |
| `spec-to-datasheet` | 미착수 — 별도 스킬 | ② 노션 페이지 Connections 공유 확인 |
