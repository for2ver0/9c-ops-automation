---
name: spec-datasheet-check
description: Nine Chronicles 정규 업데이트 기획서(사람이 직접 텍스트/파일로 전달)와 실제로 작성된 밸런스 시트 CSV가 일치하는지 대사할 때 사용. 기획서를 읽어 "이 시트의 이 행/컬럼은 이 값이어야 한다"는 assertions(JSON)로 정리한 뒤, 실제 CSV export와 기계적으로 대조해 값 불일치·행 없음·컬럼 없음을 FATAL로 잡는다. "이 데이터시트가 기획서대로 됐는지 확인해줘", "기획서랑 시트 대사해줘" 같은 요청에 사용. 원래 spec-to-datasheet가 노션 API로 하려던 일(기획 문서 읽기)과 달리, 이 스킬은 기획서를 노션이 아니라 사람이 직접 준 텍스트/파일로 받는다는 전제로 설계됐다 — 노션 페이지 공유(docs/9c-update-automation-notion-request.md ②)가 계속 막혀 있어도 착수 가능. ⚠️ 기획서 문장에서 assertions를 뽑는 건 에이전트/사람의 몫이다 — 이 스킬 자체는 자연어를 이해하지 않고, 이미 정리된 assertions와 CSV를 기계적으로 대조만 한다.
---

# spec-datasheet-check (기획서 ↔ 데이터시트 값 대사)

> 2026-09-03 세션에서 처음 만들어졌다. 사용자가 설명한 정규 업데이트 운영 흐름
> ("① 기획서 → ② 데이터시트 작성 + 재확인 → ③ 인터널 배포 → ④ QA → ⑤ 깃북 → ⑥ 디스코드
> 공지 → ⑦ 메인넷 배포")의 ②번 중 "데이터시트가 기획서 기반으로 잘 작성됐는지 재확인"
> 부분을 채우기 위해 만들어졌다. 원래 이 자리는 `spec-to-datasheet`(당시엔 설계만 있고
> 미착수 — 노션 페이지 공유가 안 돼 있어 `NOTION_TOKEN` 자체가 이 환경에 없음, 자세한 배경은
> `docs/9c-update-automation-self-check.md` ②)가 채울 예정이었다. 이번엔 사용자가 노션
> 대신 기획서를 텍스트/파일로 직접 준다고 확인해줘서, 노션 의존을 없앤 별도 스킬로
> 설계했다.
>
> **2026-09-03 같은 날 추가**: `spec-to-datasheet`도 같은 판단(노션 의존 제거)으로 착수돼,
> "시트에 무엇을 입력할지" 지시서를 만드는 짝 스킬이 됐다. 두 스킬은 **입력 JSON 형식이
> 동일하다** — 하나의 파일이 시트 입력 전엔 지시서(`--plan`), 입력 후엔 검증
> (`--assertions`)으로 쓰인다. 자세한 대비표는
> `.claude/skills/spec-to-datasheet/SKILL.md` 참고.

## 도구 현황

| 도구 | 위치 | 역할 |
| --- | --- | --- |
| `spec-datasheet-check.ts` | `tools/9c/spec-datasheet-check.ts` (bun) | CLI 본체 |
| 대사 로직 | `tools/9c/lib/spec-datasheet-check.ts` | 순수 함수(유닛 테스트 대상) |
| CSV 파서 | `tools/9c/lib/csv.ts` | RFC4180 파서 — datasheet-validate/qa-checklist와 공유 |
| 유닛 테스트 | `tools/9c/lib/spec-datasheet-check.test.ts` | 대사 로직 전체, 네트워크 없이 실행 |

실행: `bun test tools/9c/lib/spec-datasheet-check.test.ts` (19 pass).

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
| OK인데 같은 키 행이 2개 이상 | WARN | 값은 전부 맞지만 어느 행이 정본인지 모호 — 원본 확인 필요 |
| assertions 파일 자체가 모순 | FATAL | 같은 대상에 다른 expected — 어떤 시트 값으로도 만족 불가 |
| (해당 시트에 assertion 0건) | OK, 정보성 | 기획서가 이 시트를 안 건드렸다는 뜻일 수 있음 — 문제 아님 |

### 중복 키·모순 assertions (2026-09-03 보강)

`spec-to-datasheet`를 만들다 이 스킬에서도 같은 결함 두 개를 발견해 함께 고쳤다.

1. **중복 키** — 예전엔 일치하는 **첫 행만** 보고 판정해서, 뒤쪽 중복 행이 옛 값을 그대로
   갖고 있어도 "일치"로 통과시켰다. 검증 스킬이 놓치면 그대로 인터널·메인넷까지 간다. 지금은
   일치하는 행을 전부 본다. **아무 행도 기대값을 갖고 있지 않을 때만 MISMATCH(FATAL)**이고,
   일부 행만 가지면 WARN이다.

   > **2026-09-03 등급 재정정** — 처음엔 "하나라도 다르면 FATAL"로 만들었는데, lib9c 원본을
   > 읽어보니 **같은 id의 여러 행을 한 항목으로 합치는 병합형 시트가 25종** 있었다
   > (`ArenaSheet`의 라운드, `EventDungeonStageWaveSheet`의 웨이브, `SkillBuffSheet` 등 —
   > `AddRow`를 오버라이드해 `TryGetValue` 후 리스트에 덧붙인다). 그 시트들에선 한 id에 값이
   > 다른 행이 여러 개 있는 게 **정상**이라, 옛 판정은 정상 시트를 통째로 오탐했다.
2. **모순된 assertions** — 같은 `(sheet, id, column)`에 다른 `expected`가 있으면 어떤 값을
   넣어도 한쪽이 FATAL이 된다. 대조 전에 `findConflictingAssertions`로 잡아 FATAL로 멈춘다
   (`spec-to-datasheet`와 공유하는 함수 — 두 스킬이 같은 파일을 쓰므로 판정도 같아야 한다).

## 5. 범위 밖

- **기획서 문장을 읽고 assertions를 자동으로 추출하는 것** — 이건 에이전트가 매번 기획서를
  읽고 판단할 일이다. 정규식·NLP로 "숫자 변경 문장"을 자동 파싱하는 시도는 하지 않았다 —
  기획서 문체가 회차마다 다르고, 잘못 파싱해서 틀린 assertion을 만들면 오히려 위험하다
  (거짓 PASS 가능성).
- **시트에 입력할 값을 정리해 지시서로 내주는 것** — 이 스킬은 **이미 채워진** 시트와 기획서를
  대조만 한다. 그 앞단(무엇을 어떻게 바꿔야 하는지)은 짝 스킬
  [`spec-to-datasheet`](../spec-to-datasheet/SKILL.md)가 맡는다(2026-09-03 착수). 구글 시트에
  값을 실제로 입력하는 건 두 스킬 다 하지 않는다 — 사람의 몫이다(D4).
- **시트 간 참조 ID·타입 검증** — datasheet-validate와 같은 이유로 범위 밖(lib9c 스키마
  매핑 선행 필요).
- **assertions 저장소** — 이번 회차 assertions를 다음 회차를 위해 자동 보관하지 않는다.
  datasheet-validate의 `--baseline-csv`와 같은 "사람이 파일을 들고 있는" 모델.

## 6. 근거

- 사용자가 2026-09-03에 설명한 정규 업데이트 흐름(①기획서→②시트 작성+재확인→③인터널
  배포→④QA→⑤깃북→⑥디스코드→⑦메인넷)과, 같은 날 확인된 두 가지: (a) "인터널 배포"는
  백오피스 스테이징 환경을 가리킴, (b) 기획서는 이번엔 노션이 아니라 사람이 직접 파일/
  텍스트로 전달함.
- `docs/9c-update-automation-self-check.md` ② — 노션 페이지 공유가 왜 막혀 있었는지의 배경
  (이 스킬과 `spec-to-datasheet` 둘 다 그 블로커를 우회한 이유 — 기획서를 사람이 직접
  전달하므로 노션 접근 자체가 이 워크플로엔 필요 없다).

## 7. 다음에 할 일

| 항목 | 상태 | 필요한 것 |
| --- | --- | --- |
| assertions 자동 추출 | 의도적으로 미착수 | (하지 않기로 결정 — 위 "범위 밖" 참고) |
| `spec-to-datasheet`(시트 입력 지시서) | 착수됨(2026-09-03) — 같은 계획 JSON을 공유하는 짝 스킬 | 노션 연동만 여전히 미착수(지금 워크플로엔 불필요) |
| datasheet-release-gate와 연계 | 완료 | `.claude/skills/datasheet-release-gate/SKILL.md` |
