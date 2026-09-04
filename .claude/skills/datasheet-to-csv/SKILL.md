---
name: datasheet-to-csv
description: Nine Chronicles 밸런스 구글 시트를 읽어 planetarium/lib9c의 Lib9c/TableCSV/<시트명>.csv에 커밋해도 되는 형태로 만들고, 현재 lib9c 값과 대조한 변경 목록·커밋 메시지 초안을 낼 때 사용. "이 시트 lib9c에 반영할 CSV 만들어줘", "지금 시트가 lib9c 대비 뭐가 바뀌었는지 봐줘" 같은 요청에 사용. 원설계 8개 스크립트 중 유일하게 오래 미착수였던 자리로, 2026-09-04에 lib9c 공개 커밋 이력을 직접 조사해 착수 근거를 확보했다(아래 참고). ⚠️ 완전히 읽기 전용 초안 생성기다 — lib9c에는 아무것도 쓰지 않는다. 실제 fork push·upstream PR 생성·git 실행은 이 스킬의 범위 밖이며 항상 사람이 한다.
---

# datasheet-to-csv (구글 시트 → lib9c TableCSV 변환 초안)

> 2026-09-04 세션에서 만들어졌다. 원설계 8개 스크립트 중 이것만 오래 미착수였는데, 막힌 이유는
> 승인이 아니라 두 가지 미확인 사실(기존 CSV 내보내기 도구를 누가 운영하는지, lib9c 포크에
> push가 되는지)이었다. `planetarium/lib9c`가 공개 저장소라 이 세션에서 직접 커밋 이력을
> 조사해 둘 다 답을 찾았다(아래 "무엇이 왜 이렇게 됐는지" 참고).

## 무엇이 왜 이렇게 됐는지

`planetarium/lib9c`의 `Lib9c/TableCSV/` 커밋 이력(공개)을 직접 조사해 확인한 것:

- CSV 140개, 파일명이 시트 이름과 정확히 일치(`SkillSheet.csv` 등). `update/tablecsv-<날짜>-
  <번호>` 브랜치로 `development`에 PR 병합되는 방식으로 운영되고 있었다 — 이미 존재하는
  프로세스이지 새로 만드는 게 아니다.
- 과거 손상 재수출 사고가 **2건** 있었다(`re-export 10/11 corrupted table sheets from Google
  Sheets`) — 정확한 원인까지는 확인 못 했지만, gviz가 컬럼 타입을 추론해 안 맞는 값을
  조용히 비운다는 건 `datasheet-validate`가 이미 실측으로 확인해둔 사실이라(`headers=1`
  누락 시 CollectionSheet 895→13행 유실 등) 같은 부류의 실패로 보인다. `SkillSheet.csv`의
  `cooldown`(숫자 컬럼)에 `"1 // 노멀 속성의 전체 일격은 추가하면 안 됩니다."`처럼 텍스트가
  섞인 셀도 실제로 있는데, **이 셀들은 전부 `_100002` 등 lib9c가 건너뛰는 주석 행("미구현"
  스킬)이라 이 셀 자체가 로드에 영향을 주진 않는다** — 다만 이런 값이 실재한다는 건 다른
  (스킵 아닌) 행에도 비슷한 값이 있을 수 있다는 신호다. 그래서 이 스킬은 **gviz를 쓰지
  않는다** — `spec-to-datasheet-apply`와 같은 원칙으로 Sheets API(`UNFORMATTED_VALUE`, 읽기
  전용 스코프)로만 읽는다.
- 파일별로 줄바꿈 관례가 다르다(실측: `SkillSheet.csv`는 LF·트레일링 개행 없음,
  `CollectionSheet.csv`는 CRLF·트레일링 개행 있음 — 파일 안에서는 일관됨). 이걸 안 맞추면
  값이 하나도 안 바뀐 시트도 `git diff`에서 파일 전체가 바뀐 것처럼 보인다. 그래서 새 CSV를
  쓸 때 lib9c의 기존 파일 스타일을 그대로 따라간다(`serializeMatchingStyle`).
- 커밋 Co-Authored-By에 `claude`가 반복 등장하지만 GitHub App 연동은 아니다 — 기존 자동화
  파이프라인이 아니라 누군가 개인 Claude 세션으로 비공식적으로 돕고 있는 것으로 보인다. 이
  스킬이 그 작업을 대체하는 게 아니라 형식화하는 셈이다. **실제 투입 전 그 담당자와 조율을
  권장한다** — 아래 "다음에 할 일" 참고.

## 도구 현황

| 도구 | 위치 | 역할 |
| --- | --- | --- |
| `datasheet-to-csv.ts` | `tools/9c/datasheet-to-csv.ts` (bun) | CLI 본체 — 읽기 전용 |
| CSV 직렬화 | `tools/9c/lib/csv.ts`의 `serializeCsv` | 순수 함수, `parseCsv`의 역함수(RFC4180 최소 인용, LF, 트레일링 개행 없음) |
| lib9c 읽기 | `tools/9c/lib/lib9c-tablecsv.ts` | `fetchLib9cCsv` — `raw.githubusercontent.com` 무인증 읽기, 404면 신규 시트로 처리 |
| 준비도 판정·초안 문구 | `tools/9c/lib/datasheet-to-csv.ts` | `runReadinessChecks`/`assessReadiness`/`serializeMatchingStyle`/`buildDraftCommitMessage`/`buildSuggestedGitCommands` |
| diff·체크리스트 | `tools/9c/lib/qa-checklist.ts`의 `diffSheet`/`buildQaChecklist` | 재사용(중복 구현 안 함) |
| 구글 시트 읽기 인증 | `tools/9c/lib/google-sheets-auth.ts`/`google-sheets-values.ts` | `spec-to-datasheet-apply`와 공유, 여기선 읽기 전용 스코프만 사용 |

실행: `bun test tools/9c/lib/csv.test.ts tools/9c/lib/lib9c-tablecsv.test.ts tools/9c/lib/datasheet-to-csv.test.ts`.

## 1. 무엇을 하는가

1. `GOOGLE_SHEETS_SA_KEY_PATH`의 서비스 계정으로 읽기 전용 토큰을 발급해, Sheets API로 지정한
   시트의 지금 값을 읽는다(gviz 아님).
2. 구조 검증(`runReadinessChecks`)을 돌린다 — 헤더 중복·빈 헤더·행별 칸 수·lib9c 스킵 행·
   데이터 존재·키 공백·키 중복. **FATAL이면 여기서 멈춘다** — `--out`을 쓰지 않고 사유만
   보고한다. 손상된 CSV가 다음 단계로 넘어가지 못하게 막는 게 이 검사의 존재 이유다.
3. `planetarium/lib9c`의 `Lib9c/TableCSV/<시트명>.csv`(기본 `development` 브랜치)를 읽어
   "현재 값"으로 대조(`diffSheet`)한다. lib9c에 아직 없는 시트면 전부 신규(added)로 처리한다.
4. 새 CSV를 lib9c의 기존 파일과 같은 줄바꿈 스타일로 저장(`--out`)하고, 변경 목록·커밋
   메시지 초안(`Update <시트명>.csv from Google Sheets` — 실제 lib9c 커밋 관례 그대로, 새로
   짓지 않음)·git 명령 제안(실행하지 않음, 텍스트로만)을 보여준다.

## 2. 실행

```bash
GOOGLE_SHEETS_SA_KEY_PATH=./sa-key.json bun run "$(git rev-parse --show-toplevel)/tools/9c/datasheet-to-csv.ts" \
  --sheet-name SkillSheet --spreadsheet-id <시트ID> --out ./SkillSheet.csv
```

`--lib9c-ref`(기본 `development`), `--key-column`(기본 `Id`), `--log-file`(정보성 JSONL),
`--json`도 있다. 시트(탭)마다 따로 실행한다 — 이 저장소의 다른 시트 도구들과 같은 관례다.

## 3. 범위 밖

- **실제 fork push·upstream PR 생성·git 실행** — 이 CLI는 git 명령을 텍스트로 제안만 하고
  절대 실행하지 않는다. `tools/9c/` 전체에 git을 실제로 실행하는 코드가 없다는 기존 관례를
  그대로 유지한다.
- **여러 시트를 한 번에 처리(배치)** — `spec-to-datasheet`와 같은 이유로 시트 하나씩 실행.
  필요해지면 `datasheet-release-gate` 같은 manifest 방식을 나중에 추가할 수 있다.
- **Unity `.meta` 파일 생성·관리** — lib9c의 각 CSV는 `.meta` 파일과 짝을 이루지만, 이건
  보통 Unity 에디터가 다음 임포트 때 자동으로 만든다. 이 스킬은 건드리지 않는다.
- **PR 본문 템플릿** — 실측 결과 실제 PR(`#3292` 등)은 제목만 있고 본문이 거의 비어 있다.
  그래서 이 스킬도 정교한 PR 본문 생성기를 만들지 않는다 — 커밋 메시지 초안까지만.

## 4. 다음에 할 일

| 항목 | 상태 | 필요한 것 |
| --- | --- | --- |
| 실제 push 담당자와 조율 | 미착수 | 지금 Claude와 비공식적으로 이 작업을 하고 있는 것으로 보이는 담당자에게, 이 스킬로 대체·흡수할 수 있는지 확인 |
| fine-grained PAT의 lib9c 포함 여부 | 확인 중(사용자) | `GITHUB_FOCKED_REPO_WRITE_TOKEN`의 선택 레포 목록에 `Atralupus/lib9c`가 있는지 |
| 실제 서비스 계정 읽기 권한 | 미검증 | `spec-to-datasheet-apply`가 쓰는 것과 같은 서비스 계정이므로 이미 될 가능성이 높지만, 실제 회차에서 1회 확인 필요 |
| 여러 시트 배치 처리 | 미착수 | manifest 방식 설계 필요(우선순위 낮음) |
