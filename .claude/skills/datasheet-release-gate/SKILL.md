---
name: datasheet-release-gate
description: Nine Chronicles 정규 업데이트 데이터시트를 백오피스 스테이징(인터널) 환경에 올리기 전, datasheet-validate(구조 검증)와 spec-datasheet-check(기획서 대사) 결과를 시트별로 한 화면에 모아 "지금 올려도 되는가"를 판단할 때 사용. "인터널 배포해도 되는지 확인해줘", "지금까지 검증한 시트들 한눈에 보여줘" 같은 요청에 사용. arena-season-checklist와 같은 원칙 — 이 스킬 자체는 아무것도 새로 계산하지 않는다, 두 스킬이 이미 낸 --json을 읽어서 등급(OK/WARN/FATAL)만 모은다. 실제 백오피스 스테이징 업로드(Backoffice `/table-patch`)는 이 스킬의 범위 밖이다 — 항상 사람이 직접 한다.
---

# datasheet-release-gate (인터널 배포 전 게이트)

> 2026-09-03 세션에서 처음 만들어졌다. 사용자가 설명한 정규 업데이트 흐름의 ③번
> "데이터시트를 인터널에 배포"에 대응하는 스킬 — 착수 전에 사용자에게 "인터널 배포"가
> 구체적으로 뭘 가리키는지 물어봤고, **백오피스 스테이징 환경**이라는 답을 받았다.
>
> 이 저장소 전체의 D4 원칙("자동화는 라이브를 바꾸지 않는다")에 따라, 이 스킬은 실제로
> 백오피스에 뭔가를 업로드하지 않는다 — 백오피스 API 엔드포인트·인증 방식을 이 개발
> 환경에서 확인할 방법도 없었다. 대신 "업로드 버튼을 누르기 전에 통과해야 할 두 검증
> (datasheet-validate·spec-datasheet-check)을 시트별로 다 확인했는지"를 한 화면에 모아
> 보여주는 **게이트 체크리스트**로 스코프를 좁혔다 — `arena-season-checklist`가 아레나
> 4개 스킬을 집계하는 것과 똑같은 패턴.

## 도구 현황

| 도구 | 위치 | 역할 |
| --- | --- | --- |
| `datasheet-release-gate.ts` | `tools/9c/datasheet-release-gate.ts` (bun) | CLI 본체 |
| 집계 로직 | `tools/9c/lib/datasheet-release-gate.ts` | 순수 함수(유닛 테스트 대상) |
| 유닛 테스트 | `tools/9c/lib/datasheet-release-gate.test.ts` | 정규화·집계 로직만(오프라인) |

실행: `bun test tools/9c/lib/datasheet-release-gate.test.ts` (18 pass).

## 1. 무엇을 하는가

시트마다 두 스킬을 먼저 `--json`으로 실행해두고, manifest로 묶어서 이 CLI에 넘기면:

- 각 시트의 **구조 검증**(datasheet-validate) + **기획서 대사**(spec-datasheet-check)
  결과를 한 섹션으로 합친다.
- **manifest가 선언한 시트와 JSON이 실제로 본 시트가 같은지 대조한다**(2026-09-03 추가).
  JSON의 `sheetName`이 manifest와 다르거나 두 검증의 `source`가 서로 다르면 FATAL이다.
  이 대조가 없던 때는 manifest에 `MonsterSheet`라 적고 `SkillSheet`의 결과를 물려줘도
  "MonsterSheet — OK"로 보고했다(실제로 저지른 실수다). 대조할 정보가 없으면(두 스킬에
  `--sheet-name`을 안 준 실행) WARN — "확인 안 함"을 OK로 두지 않는다.
- 시트별 등급 = 두 결과 중 가장 나쁜 것. 전체 등급 = 모든 시트 중 가장 나쁜 것.
- 어느 한쪽을 안 줬으면(`structuralJson`/`specCheckJson` 생략) **"미실행"으로 표시**하고
  등급 계산에서 뺀다 — "확인 안 함"과 "확인했는데 통과"는 다른 주장이라 섞지 않는다
  (arena-season-checklist와 같은 원칙). 그래서 전체가 미실행인 시트는 겉보기엔 OK로
  보이지만, 화면에 `[WARN] ... 미실행`이 그대로 남아 있으니 사람이 읽을 때 놓치지 않는다.

**계산은 하나도 안 한다** — 순수 집계다.

## 2. 실행

```bash
# 1) 시트마다 두 스킬을 --json으로 실행
bun run "$(git rev-parse --show-toplevel)/tools/9c/datasheet-validate.ts" --csv ./SkillSheet.csv --key-column Id --sheet-name SkillSheet --json > SkillSheet.structural.json
bun run "$(git rev-parse --show-toplevel)/tools/9c/spec-datasheet-check.ts" --csv ./SkillSheet.csv --assertions ./assertions.json --sheet-name SkillSheet --json > SkillSheet.speccheck.json

# 2) manifest.json으로 묶기
cat > manifest.json <<'EOF'
[
  { "sheet": "SkillSheet", "structuralJson": "./SkillSheet.structural.json", "specCheckJson": "./SkillSheet.speccheck.json" },
  { "sheet": "MonsterSheet", "structuralJson": "./MonsterSheet.structural.json" }
]
EOF

# 3) 집계
bun run "$(git rev-parse --show-toplevel)/tools/9c/datasheet-release-gate.ts" --manifest manifest.json
```

FATAL이 하나라도 있으면 exit 1. `--json`으로 기계가 읽을 형태로도 받을 수 있다.

## 3. 판정 기준

전체 상태 = 모든 시트 섹션의 개별 항목 중 **가장 나쁜 등급**. 미실행(null) 섹션의 항목은
이 계산에 안 들어간다 — 다만 사람이 읽는 출력에는 `[WARN] ... 미실행`으로 항상 표시된다.

## 4. 범위 밖

- **실제 백오피스 스테이징 업로드 실행** — 이 스킬은 업로드하지 않는다. Backoffice
  `/table-patch`(또는 그에 준하는 스테이징 반영 기능)의 실제 엔드포인트·인증 방식은 이
  개발 환경에서 확인되지 않았다 — 확인되면 별도 스킬(또는 이 스킬의 확장)로 다룰 수
  있지만, D4 원칙상 그때도 실제 업로드 트리거는 항상 사람이 최종 확인 후 누른다.
- **manifest 자동 생성** — 시트 목록·파일 경로를 사람이 직접 manifest.json에 채운다.
  이번 회차에 어떤 시트가 바뀌었는지 자동으로 감지하지 않는다.
- **QA 담당자 리뷰 자체** — 이 게이트는 "자동화 쪽 두 검증을 통과했는가"만 본다. 그 다음
  단계인 QA 담당자의 실제 리뷰(사용자가 설명한 흐름의 ④번)는 `qa-checklist` 스킬과 사람의
  몫이고, 이 게이트가 대신하지 않는다.

## 5. 근거

- 사용자가 2026-09-03에 설명한 정규 업데이트 흐름과, 같은 날 확인된 "인터널 배포 =
  백오피스 스테이징 환경"이라는 답변.
- `arena-season-checklist`의 집계 설계(`tools/9c/lib/arena-season-checklist.ts`) — "미실행은
  OK도 FATAL/WARN도 아니다"라는 원칙을 그대로 재사용.

## 6. 다음에 할 일

| 항목 | 상태 | 필요한 것 |
| --- | --- | --- |
| 백오피스 스테이징 업로드 자체 자동화 | 미착수, 의도적으로 범위 밖 | 백오피스 API 엔드포인트·인증 방식 확인(담당자) + D4 원칙 재검토 |
| manifest 자동 생성(이번 회차 변경 시트 감지) | 미착수 | "이번 회차에 뭐가 바뀌었는지"를 알 수 있는 소스(예: datasheet-validate의 회차 diff를 시트 목록으로 역이용) |
