---
name: spec-to-datasheet
description: Nine Chronicles 정규 업데이트 기획서를 밸런스 시트에 입력하기 전, "어느 행의 어느 컬럼을 무엇에서 무엇으로 바꿔야 하는지" 작업 지시서를 만들 때 사용. 기획서에서 뽑은 계획(JSON)을 현재 시트 CSV와 대조해 변경(CHANGE)·새 행 추가(NEW_ROW)·이미 반영됨(NO_CHANGE)·컬럼 없음(FATAL)으로 분류하고, 새 행에 값이 안 정해진 컬럼을 WARN으로 짚어준다. "기획서 보고 시트에 뭘 넣어야 하는지 정리해줘", "이번에 바꿀 값 목록 뽑아줘" 같은 요청에 사용. 계획 JSON 형식은 spec-datasheet-check의 assertions와 동일해서, 시트 입력을 마친 뒤 같은 파일로 검증까지 그대로 이어진다. ⚠️ 설계 문서가 원래 요구한 노션 API 직접 읽기는 구현하지 않았다 — 기획서는 사람이 파일/텍스트로 직접 전달한다는 전제다. 기획서 문장에서 계획을 뽑는 것도 에이전트/사람의 몫이다.
---

# spec-to-datasheet (기획서 → 시트 입력 작업 지시서)

> 2026-09-03 세션에서 만들어졌다. 이 이름은 원래 설계 문서가 "정규 업데이트 기획 문서 →
> 밸런스 시트 입력용 정리 이슈 초안 생성"으로 잡아둔 자리인데, **노션 페이지 공유가 안 돼
> 오래 미착수로 남아 있었다**(`docs/9c-update-automation-notion-request.md`,
> `docs/9c-update-automation-self-check.md` ②). 이번에 기획서를 노션이 아니라 **사람이
> 파일/텍스트로 직접 전달**하는 것으로 확정되면서 그 블로커가 이 워크플로엔 해당하지 않게
> 됐고, 노션 의존을 뺀 형태로 착수했다 — `spec-datasheet-check`와 같은 판단이다.

## `spec-datasheet-check`와의 관계 — 같은 파일, 반대 시점

두 스킬은 **입력 JSON 형식이 의도적으로 동일하다**(`PlanItem` = `Assertion`, 타입 별칭으로
고정하고 테스트로 못박아 뒀다). 하나의 파일이 작업 전후로 두 번 쓰인다:

| | `spec-to-datasheet` (이 스킬) | `spec-datasheet-check` |
| --- | --- | --- |
| 언제 | 시트를 **고치기 전** | 시트를 **고친 뒤** |
| 역할 | "무엇을 어떻게 바꿔야 하는지" 지시서 | "제대로 들어갔는지" 검증 |
| 행이 없으면 | `NEW_ROW` — 새로 추가하라(정상, OK) | `ROW_NOT_FOUND` — 반영 누락(FATAL) |
| 값이 다르면 | `CHANGE` — 이렇게 바꿔라(정상, OK) | `MISMATCH` — 반영 누락(FATAL) |
| 값이 같으면 | `NO_CHANGE` — 작업 불필요(SKIP) | `OK` — 일치 |

형식이 갈라지는 순간 이 왕복이 깨지므로, 한쪽 모양을 바꾸려면 반드시 양쪽을 같이 본다.

## 도구 현황

| 도구 | 위치 | 역할 |
| --- | --- | --- |
| `spec-to-datasheet.ts` | `tools/9c/spec-to-datasheet.ts` (bun) | CLI 본체 |
| 대조 로직 | `tools/9c/lib/spec-to-datasheet.ts` | 순수 함수(유닛 테스트 대상) |
| CSV 파서 | `tools/9c/lib/csv.ts` | RFC4180 파서 — 다른 시트 스킬들과 공유 |
| 유닛 테스트 | `tools/9c/lib/spec-to-datasheet.test.ts` | 대조·갭 검출 로직 + 형식 왕복 계약, 네트워크 없이 실행 |

실행: `bun test tools/9c/lib/spec-to-datasheet.test.ts` (23 pass).

## 1. 무엇을 하는가

계획 JSON의 각 항목을 현재 시트와 대조해 네 가지로 분류한다:

- **CHANGE** — 행·컬럼은 있는데 값이 다름 → `"5" → "3"`처럼 before→after로 보여준다.
- **NEW_ROW** — 그 id 행이 아직 없음 → 새로 추가하라고 안내. **FATAL이 아니다**(아직 안 고친
  시트를 보는 중이므로 당연한 상태).
- **NO_CHANGE** — 이미 계획한 값이 들어있음 → 작업 불필요(SKIP). 숫자는 표기가 달라도 값이
  같으면 여기로 분류된다(`"3"` vs `"3.0"`).
- **COLUMN_NOT_FOUND (FATAL)** — 컬럼(또는 키 컬럼)이 헤더에 없음 → 컬럼명 오타이거나 대상
  시트를 잘못 골랐다는 뜻. 지시서 자체가 성립 안 하므로 여기서 멈춘다.

여기에 더해 **새 행의 빈 컬럼**을 따로 짚는다(WARN): 행을 새로 추가하려면 계획에 적힌 컬럼만이
아니라 시트의 모든 컬럼을 채워야 하는데, 계획이 값을 안 준 컬럼이 있으면 그대로 입력했을 때 빈
칸이 남는다. 그 목록을 미리 보여줘서 사람이 값을 정하게 한다.

## 2. 어떻게 계획을 만드는가 (에이전트가 할 일)

`spec-datasheet-check`와 같은 원칙이다 — 이 스킬은 자연어를 이해하지 않는다.

1. 사용자가 준 기획서를 **끝까지** 읽는다.
2. **수치가 명시된 문장만** 계획 항목으로 뽑는다(`{sheet, id, column, expected, note}`).
   `note`에 기획서 원문을 발췌해 넣어 근거를 남긴다.
3. "밸런스 소폭 조정" 같이 값이 안 적힌 문장은 계획에 넣지 말고, **사람에게 물어본다.**
   임의로 숫자를 지어내면 그 값이 그대로 시트에 입력되고, 나중에 `spec-datasheet-check`가
   같은 파일로 검증하므로 **틀린 값이 "일치"로 통과해버린다.**

```json
[
  { "sheet": "SkillSheet", "id": "10113000", "column": "Cooldown", "expected": "3", "note": "기획서 3.2절: 궁수 스킬 쿨타임 5->3" },
  { "sheet": "SkillSheet", "id": "10115000", "column": "Cooldown", "expected": "4", "note": "신규 스킬 추가" }
]
```

## 3. 실행

```bash
# 작업 지시서 생성 (시트 고치기 전)
bun run "$(git rev-parse --show-toplevel)/tools/9c/spec-to-datasheet.ts" --csv ./SkillSheet.csv --plan ./plan.json --sheet-name SkillSheet --key-column Id

# JSON으로
bun run "$(git rev-parse --show-toplevel)/tools/9c/spec-to-datasheet.ts" --csv ./SkillSheet.csv --plan ./plan.json --sheet-name SkillSheet --json

# 시트 입력을 마친 뒤 — 같은 파일로 검증 (변환 불필요)
bun run "$(git rev-parse --show-toplevel)/tools/9c/spec-datasheet-check.ts" --csv ./SkillSheet.csv --assertions ./plan.json --sheet-name SkillSheet
```

FATAL(컬럼 없음)이면 exit 1. `--key-column` 기본값은 `Id`. 시트(탭)마다 따로 실행한다 — 이
CLI도 한 번에 CSV 하나만 본다.

## 4. 판정 기준 요약

| 상태 | 등급 | 의미 |
| --- | --- | --- |
| CHANGE | OK | 이 값을 이렇게 바꾸세요 |
| NEW_ROW | OK | 이 행을 새로 추가하세요 |
| NO_CHANGE | OK | 이미 반영됨 — 작업 불필요 |
| COLUMN_NOT_FOUND | FATAL | 컬럼명 오타이거나 대상 시트가 틀림 |
| 새 행에 값 미정 컬럼 있음 | WARN | 그대로 입력하면 빈 칸이 남음 — 사람이 값을 정해야 함 |
| 같은 키를 가진 행이 2개 이상 | WARN | 어느 행을 가리키는지 모호 — 병합형 시트(lib9c 25종)면 정상일 수 있어 "전부 반영"이 아니라 원본 확인을 안내한다(아래 참고) |
| 계획 파일 자체가 모순 | FATAL | 같은 대상에 다른 값을 요구 — 지시서가 성립 안 함(아래 참고) |

### 중복 키와 모순 계획 (2026-09-03 추가)

착수 직후 직접 돌려보다 "조용히 OK가 나오는" 결함 두 개를 발견해 고쳤다. 둘 다
`spec-datasheet-check`에도 같은 형태로 있어서 양쪽을 함께 고쳤다.

1. **중복 키** — 시트에 같은 `Id`가 두 번 나오면 예전엔 **첫 행만** 보고 판단했다. 첫 행이
   이미 기획서 값이면 "작업 불필요"로 넘어가버리고, 나머지 행은 보지도 않았다. 지금은
   일치하는 행을 **전부** 보고, 행이 여러 개면 항상 WARN을 붙인다.

   > **같은 날 재정정** — 처음 고칠 때는 "전부 이 값으로 바꾸세요"라고 지시했는데, lib9c
   > 원본을 확인해보니 **같은 id의 여러 행을 한 항목으로 합치는 병합형 시트가 25종**
   > 있었다(`ArenaSheet`의 라운드, `EventDungeonStageWaveSheet`의 웨이브, `SkillBuffSheet`
   > 등 — `AddRow`를 오버라이드해 `TryGetValue` 후 리스트에 덧붙인다). 그 지시를 그대로
   > 따르면 다른 라운드·웨이브를 뭉개버린다. 지금은 이미 기대값을 가진 행이 있으면 "병합형
   > 시트면 작업 불필요할 수 있음"으로, 없으면 "어느 행을 바꿀지 원본에서 확인"으로
   > 안내한다. 병합형이 아닌 시트에서 중복 키는 로드 시 `ArgumentException`으로 드러난다
   > (기본 `AddRow`가 `IDictionary.Add`라 덮어쓰기가 아니다).
2. **모순된 계획** — 같은 `(sheet, id, column)`에 서로 다른 `expected`가 두 번 적혀 있으면
   예전엔 모순된 지시 두 줄을 그대로 내보냈다. 시트를 어떻게 고쳐도 만족시킬 수 없는 입력이고,
   그대로 두면 나중에 `spec-datasheet-check`에서 무슨 값을 넣든 한쪽이 반드시 FATAL로 뜬다.
   지금은 대조 전에 잡아서 FATAL로 멈춘다(`findConflictingAssertions`, 두 스킬이 공유).
   표기만 다른 같은 값("3" vs "3.0")은 모순으로 치지 않는다.

## 5. 범위 밖

- **노션 API로 기획 문서를 직접 읽기** — 원래 설계 문서가 이 스킬에 요구한 것이지만, 기획서를
  사람이 직접 전달하는 것으로 확정돼 구현하지 않았다. 필요해지면 이 모듈 **앞단**에 붙이면
  된다 — 대조 로직은 입력이 어디서 왔는지와 무관하다.
- **기획서 문장에서 계획을 자동 추출** — 에이전트가 매번 읽고 판단한다(위 §2의 이유).
- **시트를 실제로 고치는 것** — 이 스킬은 지시서만 만든다. 구글 시트에 값을 입력하는 건
  사람이 한다(D4 원칙: 자동화는 라이브를 바꾸지 않는다).
- **제안 값이 게임 밸런스상 타당한지** — 기획서에 적힌 값을 그대로 옮길 뿐, 그 값이 맞는지는
  판단하지 않는다.
- **시트 간 참조 ID·타입 검증** — `datasheet-validate`와 같은 이유로 lib9c 스키마 매핑 필요.

## 6. 근거

- 2026-09-03 확인: 기획서는 노션이 아니라 사람이 파일/텍스트로 직접 전달한다 — 이 스킬이
  노션 블로커(②) 없이 착수 가능해진 근거.
- `docs/9c-update-automation-self-check.md` ② — 노션 페이지 공유가 왜 막혀 있었는지의 배경.
- `.claude/skills/spec-datasheet-check/SKILL.md` — 짝이 되는 검증 스킬. 형식 계약을 공유한다.

## 7. 다음에 할 일

| 항목 | 상태 | 필요한 것 |
| --- | --- | --- |
| 노션 연동(기획 문서 직접 읽기) | 미착수 — 지금 워크플로엔 불필요 | 노션 페이지 Connections 공유(②). 필요해지면 앞단에만 붙이면 됨 |
| 계획 자동 추출 | 의도적으로 미착수 | (하지 않기로 결정 — §2·§5 참고) |
| 여러 시트를 한 번에 처리 | 미착수 | 시트마다 CSV를 따로 받아야 해서, `datasheet-release-gate`처럼 manifest 방식이 필요 |
| 실제 회차에서 써본 적 없음 | 미검증 | 다음 실제 업데이트에서 검증 |
