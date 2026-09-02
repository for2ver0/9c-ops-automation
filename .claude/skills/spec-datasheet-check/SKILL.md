---
name: spec-datasheet-check
description: Nine Chronicles 정규 업데이트 기획서(사람이 직접 텍스트/파일로 전달)와 실제로 작성된 밸런스 시트 CSV가 일치하는지 대사할 때 사용. 기획서를 읽어 "이 시트의 이 행/컬럼은 이 값이어야 한다"는 assertions(JSON)로 정리한 뒤, 실제 CSV export와 기계적으로 대조해 값 불일치·행 없음·컬럼 없음을 FATAL로 잡는다. "이 데이터시트가 기획서대로 됐는지 확인해줘", "기획서랑 시트 대사해줘" 같은 요청에 사용. 원래 spec-to-datasheet가 노션 API로 하려던 일(기획 문서 읽기)과 달리, 이 스킬은 기획서를 노션이 아니라 사람이 직접 준 텍스트/파일로 받는다는 전제로 설계됐다 — 노션 페이지 공유(docs/9c-update-automation-notion-request.md ②)가 계속 막혀 있어도 착수 가능. ⚠️ 기획서 문장에서 assertions를 뽑는 건 에이전트/사람의 몫이다 — 이 스킬 자체는 자연어를 이해하지 않고, 이미 정리된 assertions와 CSV를 기계적으로 대조만 한다.
---

# spec-datasheet-check (기획서 ↔ 데이터시트 값 대사)

> 2026-09-03 세션에서 처음 만들어졌다. 사용자가 설명한 정규 업데이트 운영 흐름
> ("① 기획서 → ② 데이터시트 작성 + 재확인 → ③ 인터널 배포 → ④ QA → ⑤ 깃북 → ⑥ 디스코드
> 공지 → ⑦ 메인넷 배포")의 ②번 중 "데이터시트가 기획서 기반으로 잘 작성됐는지 재확인"
> 부분을 채우기 위해 만들어졌다. 원래 이 자리는 `spec-to-datasheet`(설계만 있고 미착수 —
> 노션 페이지 공유가 안 돼 있어 `NOTION_TOKEN` 자체가 이 환경에 없음, 자세한 배경은
> `docs/9c-update-automation-self-check.md` ②)가 채울 예정이었다. 이번엔 사용자가 노션
> 대신 기획서를 텍스트/파일로 직접 준다고 확인해줘서, 노션 의존을 없앤 별도 스킬로
> 설계했다 — `spec-to-datasheet`가 여전히 하려던 "밸런스 시트 입력용 정리 이슈 초안 생성"
> 자체는 이 스킬의 범위가 아니다(아래 "범위 밖" 참고).

## 도구 현황

| 도구 | 위치 | 역할 |
| --- | --- | --- |
| `spec-datasheet-check.ts` | `tools/9c/spec-datasheet-check.ts` (bun) | CLI 본체 |
| 대사 로직 | `tools/9c/lib/spec-datasheet-check.ts` | 순수 함수(유닛 테스트 대상) |
| CSV 파서 | `tools/9c/lib/csv.ts` | RFC4180 파서 — datasheet-validate/qa-checklist와 공유 |
| 유닛 테스트 | `tools/9c/lib/spec-datasheet-check.test.ts` | 대사 로직 전체, 네트워크 없이 실행 |

실행: `bun test tools/9c/lib/spec-datasheet-check.test.ts` (14 pass).

## 1. 무엇을 하는가

기획서에서 뽑아낸 **assertions**(JSON — "어느 시트의 어느 id 행, 어느 컬럼이 어떤 값이어야
하는가")를 실제 CSV export와 대조한다. 컬럼당 하나씩:

- **OK** — 시트 값이 기획서 기대값과 일치(숫자는 표기가 달라도 값이 같으면 일치로 봄, 예:
  `"3"` vs `"3.0"`).
- **MISMATCH (FATAL)** — 행·컬럼은 있는데 값이 다름. 이 스킬이 잡으려는 핵심 실패 모드 —
  "기획서는 쿨타임 5→3인데 시트엔 아직 5로 남아있음" 같은 반영 누락.
  ​
- **ROW_NOT_FOUND (FATAL)** — 기획서가 가리키는 id가 시트에 없음(행 자체가 안 만들어짐).
- **COLUMN_NOT_FOUND (FATAL)** — 컬럼 이름이 시트 헤더에 없음(오타 또는 시트 구조 변경).

assertions에 `sheet` 필드를 넣어두면 `--sheet-name`으로 그 시트에 해당하는 것만 걸러서
검사한다(다른 시트용 assertion은 "건너뜀"으로 표시, 문제 아님) — 기획서 하나가 여러 시트를
건드리는 게 보통이라, CSV를 시트(탭)마다 따로 검증하는 datasheet-validate와 같은 실행
모델을 따른다.

## 2. 어떻게 assertions를 만드는가 (에이전트가 할 일)

이 스킬 자체는 자연어를 이해하지 않는다. 기획서를 읽고 assertions를 뽑는 건 에이전트(또는
사람)의 몫이다:

1. 사용자가 준 기획서(파일 경로 또는 붙여넣은 텍스트)를 읽는다.
2. "OOO의 쿨타임을 5에서 3으로 변경", "OOO 몬스터 HP를 1200으로" 같이 **명시적으로 값이
   적힌 문장**만 assertion으로 뽑는다 — "밸런스를 조금 손봄" 같은 모호한 문장은 assertion화
   하지 말고 사람에게 "이 부분은 구체적 수치가 없어 자동 대사가 안 됩니다"라고 알린다.
3. 각 assertion에 `id`(시트의 키 컬럼 값), `column`, `expected`, 가능하면 `sheet`와
   `note`(기획서 원문 발췌)를 채워 JSON 배열로 저장한다.
4. 아래 CLI로 실제 CSV와 대조한다.

```json
[
  { "sheet": "SkillSheet", "id": "10113000", "column": "Cooldown", "expected": "3", "note": "기획서 3.2절: 궁수 스킬 쿨타임 5->3" },
  { "sheet": "MonsterSheet", "id": "500001", "column": "HP", "expected": "1200" }
]
```

## 3. 실행

```bash
# 시트 하나 검증 (sheet 필드 없는 assertion만 있다면 --sheet-name 생략 가능)
bun run "$(git rev-parse --show-toplevel)/tools/9c/spec-datasheet-check.ts" --csv ./SkillSheet.csv --assertions ./assertions.json --sheet-name SkillSheet --key-column Id

# JSON으로 (datasheet-release-gate가 이 출력을 그대로 소비함)
bun run "$(git rev-parse --show-toplevel)/tools/9c/spec-datasheet-check.ts" --csv ./SkillSheet.csv --assertions ./assertions.json --sheet-name SkillSheet --json > SkillSheet.speccheck.json
```

FATAL이 하나라도 있으면 exit 1. `--key-column` 기본값은 `Id`.

## 4. 판정 기준 요약

| 상태 | 등급 | 의미 |
| --- | --- | --- |
| OK | OK | 값 일치 |
| MISMATCH | FATAL | 행·컬럼은 있는데 값이 다름 — 기획서 반영 누락 |
| ROW_NOT_FOUND | FATAL | 기획서가 가리키는 id가 시트에 없음 |
| COLUMN_NOT_FOUND | FATAL | 컬럼(또는 키 컬럼) 자체가 헤더에 없음 |
| (해당 시트에 assertion 0건) | OK, 정보성 | 기획서가 이 시트를 안 건드렸다는 뜻일 수 있음 — 문제 아님 |

## 5. 범위 밖

- **기획서 문장을 읽고 assertions를 자동으로 추출하는 것** — 이건 에이전트가 매번 기획서를
  읽고 판단할 일이다. 정규식·NLP로 "숫자 변경 문장"을 자동 파싱하는 시도는 하지 않았다 —
  기획서 문체가 회차마다 다르고, 잘못 파싱해서 틀린 assertion을 만들면 오히려 위험하다
  (거짓 PASS 가능성).
- **밸런스 시트에 입력할 값 자체를 제안하는 것**(`spec-to-datasheet`가 원래 의도한 "정리
  이슈 초안 생성") — 이 스킬은 이미 채워진 시트와 기획서를 대조만 한다. 시트를 비어있는
  상태에서 기획서 보고 채우는 작업 자체는 여전히 사람(또는 별도 스킬)의 몫.
- **시트 간 참조 ID·타입 검증** — datasheet-validate와 같은 이유로 범위 밖(lib9c 스키마
  매핑 선행 필요).
- **assertions 저장소** — 이번 회차 assertions를 다음 회차를 위해 자동 보관하지 않는다.
  datasheet-validate의 `--baseline-csv`와 같은 "사람이 파일을 들고 있는" 모델.

## 6. 근거

- 사용자가 2026-09-03에 설명한 정규 업데이트 흐름(①기획서→②시트 작성+재확인→③인터널
  배포→④QA→⑤깃북→⑥디스코드→⑦메인넷)과, 같은 날 확인된 두 가지: (a) "인터널 배포"는
  백오피스 스테이징 환경을 가리킴, (b) 기획서는 이번엔 노션이 아니라 사람이 직접 파일/
  텍스트로 전달함.
- `docs/9c-update-automation-self-check.md` ② — `spec-to-datasheet`가 왜 아직 노션에
  막혀 있는지의 배경(이 스킬이 그 블로커를 우회하는 이유).

## 7. 다음에 할 일

| 항목 | 상태 | 필요한 것 |
| --- | --- | --- |
| assertions 자동 추출 | 의도적으로 미착수 | (하지 않기로 결정 — 위 "범위 밖" 참고) |
| `spec-to-datasheet`(시트 입력값 제안) | 여전히 노션 대기 | ② 노션 페이지 Connections 공유 |
| datasheet-release-gate와 연계 | 완료 | `.claude/skills/datasheet-release-gate/SKILL.md` |
