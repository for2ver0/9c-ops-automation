# 나인 크로니클 (Nine Chronicles) 운영 자동화

## 1. 아레나 (Arena)

아레나 시즌 준비 프로세스를 5개 스킬로 자동화. **담당자는 명령어를 몰라도 됩니다** — Claude에게
말로 요청하면 됩니다, [`docs/arena-season-prep-user-guide.md`](docs/arena-season-prep-user-guide.md)
참고. 전체 배경·결정 사항은 [`docs/arena-season-prep-spec.md`](docs/arena-season-prep-spec.md),
실행 순서·사람 개입 지점(에이전트용)은
[`arena-season-prep` 스킬](.claude/skills/arena-season-prep/SKILL.md)을 참고.

| 순위 | 스킬 | 역할 | 상태 |
| --- | --- | --- | --- |
| — | [`arena-season-prep`](.claude/skills/arena-season-prep/SKILL.md) | 아래 5개 스킬 전체 프로세스 오케스트레이션 가이드(계산·실행은 안 함) | 완료 (가이드 전용) |
| 1 | [`arena-reward-table`](.claude/skills/arena-reward-table/SKILL.md) | 상금 표 계산 + PNG + 불변식 검증 | 실측 대조 대기 (Odin S39 골든 픽스처 미검증) |
| 2 | [`arena-season-preview`](.claude/skills/arena-season-preview/SKILL.md) | 시즌 등록 전 블록↔날짜 프리뷰 + 9개 입력 대사 | 완료 |
| 3 | [`arena-announce`](.claude/skills/arena-announce/SKILL.md) | 디스코드 공지 초안 생성 | 완료 |
| 4 | [`arena-settlement-check`](.claude/skills/arena-settlement-check/SKILL.md) | 정산 tx 상태 확인 | 부분 구현 |
| 5 | [`arena-season-checklist`](.claude/skills/arena-season-checklist/SKILL.md) | 1-4 산출물 집계 | 완료 |

도구 코드는 `tools/9c/`. 모든 단계의 최종 확인·승인·실행은 사람이 한다 — 자동화는 계산·대사·
검증·초안 생성까지만 한다. (단, 시즌 등록·정산 실행 범위를 에이전트로 넓히는 방안이
`docs/arena-settlement-automation-design.md`에서 담당자 승인 하에 논의 중이다 — 아직 미구현이며,
구현 전까지는 위 원칙이 그대로 적용된다.)

**각 스킬 SKILL.md의 예시 명령어는 `bun run "$(git rev-parse --show-toplevel)/tools/9c/...ts"`
형태로, 저장소 안 어느 디렉터리에서 실행하든(클론 직후 Claude를 어디서 열었든) 항상 올바른
스크립트를 찾도록 절대경로를 그 자리에서 계산한다(2026-09-02). `--csv`/`--input`/출력
리다이렉트 같은 사용자 지정 경로는 의도적으로 상대경로 그대로 둔다 — 저장소 기준이 아니라
사용자가 지금 있는 위치 기준으로 풀려야 맞기 때문이다.**
⚠️ **검증 범위**: 이 패턴은 Git Bash(Windows)와 PowerShell(Windows) 양쪽에서 직접 실행해
확인했다(2026-09-02). 처음엔 예시가 bash 스타일 백슬래시(`\`) 여러 줄 이어쓰기를 써서
PowerShell에 그대로 붙여넣으면 깨졌는데 — PowerShell은 줄바꿈에 백틱(`` ` ``)을 쓰지 백슬래시를
안 쓴다 — 모든 예시 명령어를 한 줄로 합쳐서 이 문제를 없앴다. 그 과정에서 **쉼표로 구분된 인자
(`--percentages 7,8,...`, `--check-cache odin,heimdall` 등)를 따옴표 없이 주면 PowerShell이
쉼표를 배열 생성 연산자로 해석해 깨진다는 것도 실측으로 추가 발견**해서, 그런 인자는 전부
`"7,8,..."`처럼 따옴표로 감쌌다(Bash에서도 동일하게 동작하므로 부작용 없음). 두 셸 모두 정상
종료(exit 0)와 올바른 JSON 출력까지 확인 완료.

macOS 터미널(zsh/bash)은 이 명령어들이 쓰는 문법(`$(...)`, 큰따옴표 안 변수 치환)이 전부 POSIX
표준이라 문제없을 것으로 보이지만, 이 환경에 macOS/zsh를 실행할 방법이 없어 **아직 실제로
확인하지 못했다** — CI에 `macos-latest` 러너를 추가하거나 macOS 사용자가 직접 확인해주면 이
캐비앗을 지울 수 있다.

## 2. 정규 운영 업데이트

### 2.1 처리 흐름 (사용자 설명, 2026-09-03)

담당자가 실제로 겪는 정규 업데이트 운영은 이런 순서다 — 업데이트 타겟(어드벤처·아레나·
이벤트 던전·인피니트 타워 등)이 뭐든 이 7단계는 공통이다. **담당자는 명령어를 몰라도 된다** —
Claude에게 말로 요청하면 [`regular-update` 에이전트](.claude/agents/regular-update.md)가
받아서 진행한다. 실행 순서·사람 개입 지점(에이전트용)은
[`regular-update-prep` 스킬](.claude/skills/regular-update-prep/SKILL.md) 참고 — 아레나의
`arena-season-update` 에이전트 + `arena-season-prep` 스킬과 같은 2단 구조다.

| # | 단계 | 담당 스킬 | 상태 |
| --- | --- | --- | --- |
| ① | 사용자가 기획서를 agent에게 전달 (adventure/arena/이벤트 던전/infinite tower 등 타겟 무관) | — | 사람이 입력, 스킬 없음 |
| ② | agent가 기획서 기반으로 데이터 시트 작성 + 기획서 대비 재확인 + 이상 데이터 확인 | [`spec-to-datasheet`](.claude/skills/spec-to-datasheet/SKILL.md) (입력 작업 지시서) → [`spec-datasheet-check`](.claude/skills/spec-datasheet-check/SKILL.md) (기획서 대사) + [`datasheet-validate`](.claude/skills/datasheet-validate/SKILL.md) (구조적 이상 검출) | 부분 구현 — "무엇을 어떻게 바꿔야 하는지"(지시서)·"시트가 기획서와 일치하는가"(대사)·"CSV 구조가 이상한가"는 됨. 구글 시트에 값을 실제로 입력하는 건 사람(D4) |
| ③ | 이상 없으면 데이터 시트를 인터널(백오피스 스테이징)에 배포 | [`datasheet-release-gate`](.claude/skills/datasheet-release-gate/SKILL.md) (업로드 전 게이트) | 부분 구현 — ②의 두 검증을 시트별로 집계해 "올려도 되는가"만 판단. 실제 스테이징 업로드 자체는 D4 원칙상 항상 사람이 직접(백오피스 API를 이 환경에서 확인 못 함) |
| ④ | QA 담당자가 인터널 배포본을 리뷰 | [`qa-checklist`](.claude/skills/qa-checklist/SKILL.md) | 부분 구현 — 시트 전/후 diff만. "무엇을 테스트해야 하는지" 매핑은 미착수 |
| ⑤ | QA 피드백 반영해 ③~④ 반복 → 이상 없으면 깃북에 릴리즈 노트 작성 | [`release-notes`](.claude/skills/release-notes/SKILL.md) | 부분 구현 — 초안 정리까지, 실제 깃북 게시는 사람 |
| ⑥ | agent가 업데이트 공지글을 디스코드에 공지 | [`announce-fanout`](.claude/skills/announce-fanout/SKILL.md) | 부분 구현 — 2026-09-03 확보한 실측 샘플 2건으로 실제 릴리즈 공지(버전/날짜/요약/링크) 고정 템플릿(`regular-update-announce`)까지 완성, arena-announce와 같은 방식. 인게임 공지판(TextNotice) 언어별 대사는 별도 도구로 유지. 실제 게시는 항상 사람(자동 게시 경로 자체가 없음) |
| ⑦ | agent가 최종 컨펌된 데이터 시트를 메인넷에 배포 | [`release-guard`](.claude/skills/release-guard/SKILL.md) + [`deploy-prep`](.claude/skills/deploy-prep/SKILL.md) | 부분 구현 — 배포 전/후 체크리스트·일관성 대조까지, 실제 Manage Apv 실행은 항상 사람(D4) |

②·③은 2026-09-03에 새로 채운 공백이다 — 그 전까지는 "기획서와 시트가 맞는지"·"인터널
배포 전에 뭘 확인해야 하는지"에 대응하는 스킬이 전혀 없었다. `spec-datasheet-check`는
원래 `spec-to-datasheet`(노션 API로 기획 문서를 직접 읽는 설계)가 막혀 있는 상황
(`docs/9c-update-automation-notion-request.md` ②, `NOTION_TOKEN` 자체가 이 환경에 없음)을
우회한다 — 기획서를 노션이 아니라 **사람이 직접 텍스트/파일로 전달**한다는 전제로,
기획서에서 뽑은 assertions(JSON)와 실제 CSV를 기계적으로 대조한다. `datasheet-release-gate`는
"인터널 배포"가 **백오피스 스테이징 환경**을 가리킨다는 걸 확인한 뒤(담당자 확인,
2026-09-03), 실제 업로드는 D4 원칙(자동화는 라이브를 바꾸지 않는다)상 여전히 사람이 하되
그 직전 게이트만 자동화했다 — `arena-season-checklist`와 같은 "계산 없이 집계만" 패턴.

### 2.2 8개 스크립트 원설계 대비 현황

원설계는 8개 스크립트(자동화는 "정제 이슈 초안"까지만 만들고, 검토·승인·배포 실행은 항상
사람)로 그려졌다. 처음엔 대부분이 권한 승인 대기 중이라 여겼는데, 실제로 확인해보니 애초에
권한이 필요 없던 항목이 둘 있었다 — 밸런스 시트는 이미 무인증 공개 상태였고, 디스코드는
자동 게시 경로 자체가 없어(항상 사람이 수동 게시) 권한을 받을 대상이 없었다. 지금은
[권한 요청 문서](docs/9c-update-automation-permission-request.md)에 **진짜 승인이 필요한
항목이 S3 1건**만 남아 있고, 자체적으로 조사 가능했던 항목은 [조사 결과](docs/9c-update-automation-self-check.md)에
정리해 뒀다.

| 스킬 | 역할 | 상태 |
| --- | --- | --- |
| [`regular-update-prep`](.claude/skills/regular-update-prep/SKILL.md) | 아래 스킬들로 7단계 전체 프로세스를 안내하는 오케스트레이션 가이드(계산·실행은 안 함) | 2026-09-03 신규, 완료 (가이드 전용) |
| [`release-guard`](.claude/skills/release-guard/SKILL.md) | 깃북 릴리즈 노트 vs 메인넷 APV vs 인게임 공지판 일관성 대조 + `Event.json` 현재 값 스냅샷 | 부분 구현 — 일관성·헤드 대조 + Event.json 현재 값 스냅샷(`--event-log-file`, 2026-09-01 확인: 공개 CDN이 S3와 같은 오브젝트라 권한 불필요). 과거 버전 소급 조회만 S3 권한 대기(범위 좁아짐) |
| [`datasheet-validate`](.claude/skills/datasheet-validate/SKILL.md) | 밸런스 시트 CSV 구조적 검증 + 회차 간 diff(1차 필수) | 부분 구현 — 검사 12종: 헤더 중복·빈 헤더·행별 컬럼 수·데이터 0행·키 컬럼 공백·키 값 중복·행 수 급감(v200450 실패 모드 3종 회귀 포함)·`--baseline-csv` 회차 diff·gviz headers 파라미터·요청한 탭 확인·lib9c 스킵 행·따옴표 형식. **뒤 7종은 2026-09-03 "조용한 OK" 점검으로 추가** — 특히 gviz `headers=1`이 없으면 실제 시트가 895행 → 13행으로 접히는데 그전엔 조용히 통과했다(그 이전 URL 모드 검증 결과는 신뢰할 수 없음. 지금은 도구가 요청 직전에 자동으로 붙인다). 시트 간 참조 ID·타입 검증만 lib9c 스키마 매핑 선행 필요로 미착수 |
| [`spec-datasheet-check`](.claude/skills/spec-datasheet-check/SKILL.md) | 기획서(사람이 직접 전달) assertions ↔ 실제 CSV 값 대사 | 2026-09-03 신규, 부분 구현 — 값 대사(MISMATCH/ROW_NOT_FOUND/COLUMN_NOT_FOUND)만. assertions 자동 추출은 의도적으로 미착수(에이전트가 매번 판단) |
| [`datasheet-release-gate`](.claude/skills/datasheet-release-gate/SKILL.md) | 인터널(백오피스 스테이징) 배포 전, datasheet-validate + spec-datasheet-check 결과를 시트별로 집계하는 게이트 | 2026-09-03 신규, 부분 구현 — 집계만. 실제 스테이징 업로드 자동화는 D4 원칙상 범위 밖 |
| [`deploy-prep`](.claude/skills/deploy-prep/SKILL.md) | 배포 전/후 체크리스트 + `latest.json` 롤백 스냅샷 + APV 결번 검사(release-guard 로직 재사용) | 부분 구현 — Manage Apv 워크플로 실제 트리거·PR/브랜치/태그/changelog 자동화는 D4 원칙(자동화가 라이브를 안 바꿈)상 범위 밖, 입력값 계산까지만 하고 항상 사람이 실행 |
| [`qa-checklist`](.claude/skills/qa-checklist/SKILL.md) | 시트 CSV 전/후 diff → 추가·삭제·변경 행 QA 체크리스트 | 부분 구현 — "무엇이 바뀌었는지"만. "그래서 무엇을 테스트해야 하는지"(시트별 기능 매핑)는 lib9c 도메인 지식 필요로 미착수 |
| [`announce-fanout`](.claude/skills/announce-fanout/SKILL.md) | 인게임 공지(EN/KR/JP) 언어별 불일치 검사 재포장 + 실제 릴리즈 공지(버전/날짜/요약/링크) 고정 템플릿 초안 | 부분 구현 — 2026-09-03: 담당자 제공 실측 샘플 2건으로 실제 릴리즈 공지 고정 템플릿(`regular-update-announce-template.ts`, arena-announce와 같은 방식)을 추가, 기존 TextNotice 재포장 도구(`announce-fanout.ts`)는 용도가 달라 별도 유지. 휴장/이벤트 공지 초안은 미착수 — Event.json 읽기 자체는 더 이상 안 막혀 있지만(2026-09-01 확인), 그 파일엔 배너 메타데이터만 있고 초안화할 문구가 없음 |
| [`spec-to-datasheet`](.claude/skills/spec-to-datasheet/SKILL.md) | 기획서 계획 JSON ↔ 현재 시트 대조 → 입력 작업 지시서(현재값 → 제안값) | 2026-09-03 신규, 부분 구현 — 지시서 생성·새 행 빈 컬럼 검출까지. 노션 API 직접 읽기는 미착수지만 지금 워크플로(기획서를 사람이 직접 전달)엔 불필요. 계획 JSON은 `spec-datasheet-check`의 assertions와 같은 형식이라 작성 후 검증까지 그대로 이어짐 |
| `datasheet-to-csv` | 밸런스 시트 파이프라인 나머지 1종(1차 필수) | 미착수 — lib9c push 확인(⑨) + 기존 CSV 익스포트 도구 소유·운영 실태 조사(⑦) 필요 |
| [`release-notes`](.claude/skills/release-notes/SKILL.md) | 버전+카테고리별 항목 → 깃북 붙여넣기용 릴리즈 노트 초안 | 부분 구현 — 버전 대사(+10 관행, 중복 게시 방지)·섹션 정리만. ⑥ 확인(깃북 에디터 직접 입력, GitHub 토큰 불필요)으로 착수. 문구는 짓지 않고 사람이 준 것만 정리 — 정확한 마크다운 문법은 원본 저장소(`nine-chronicles-docs`, 비공개) 미확인으로 검증 못 함 |

도구 코드는 `tools/9c/release-guard.ts` + `tools/9c/lib/release-guard.ts`, `tools/9c/datasheet-validate.ts`
+ `tools/9c/lib/datasheet-validate.ts`, `tools/9c/spec-datasheet-check.ts` +
`tools/9c/lib/spec-datasheet-check.ts`, `tools/9c/datasheet-release-gate.ts` +
`tools/9c/lib/datasheet-release-gate.ts`, `tools/9c/deploy-prep.ts` + `tools/9c/lib/deploy-prep.ts`,
`tools/9c/qa-checklist.ts` + `tools/9c/lib/qa-checklist.ts`, `tools/9c/announce-fanout.ts` +
`tools/9c/lib/announce-fanout.ts`(TextNotice 재포장), `tools/9c/regular-update-announce.ts` +
`tools/9c/lib/regular-update-announce-template.ts`(실제 릴리즈 공지 고정 템플릿),
`tools/9c/release-notes.ts` + `tools/9c/lib/release-notes.ts`.
CSV 파서(`tools/9c/lib/csv.ts`)는 datasheet-validate·qa-checklist·spec-datasheet-check가
공유한다(순환 참조 방지용 분리). release-guard는 실행할 때마다 결과가 바뀌는 진단 도구다 —
2026-08-30/31 조사 시점엔 실제 프로덕션 상태(인게임 공지판이 깃북보다 2차수 뒤처진 상태)를
FATAL로 잡아냈다(그 시점의 스냅샷이지 항상 유효한 현재 상태가 아님) — 조사 근거는
[`references/release-guard-investigation.md`](.claude/skills/release-guard/references/release-guard-investigation.md).
