# 나인 크로니클 (Nine Chronicles) 운영 자동화

## 1. 아레나 (Arena)

아레나 시즌 준비 프로세스를 5개 스킬로 자동화. **담당자는 명령어를 몰라도 됩니다** — Claude에게
말로 요청하면 됩니다, [`docs/arena-season-prep-user-guide.md`](docs/arena-season-prep-user-guide.md)
참고. 전체 배경·결정 사항은 [`docs/arena-season-prep-spec.md`](docs/arena-season-prep-spec.md),
실행 순서·사람 개입 지점(에이전트용)은
[`arena-season-prep` 스킬](.claude/skills/arena-season-prep/SKILL.md)을 참고.

| 순위 | 스킬 | 역할 | 상태 |
| --- | --- | --- | --- |
| 1 | [`arena-reward-table`](.claude/skills/arena-reward-table/SKILL.md) | 상금 표 계산 + PNG + 불변식 검증 | 실측 대조 대기 (Odin S39 골든 픽스처 미검증) |
| 2 | [`arena-season-preview`](.claude/skills/arena-season-preview/SKILL.md) | 시즌 등록 전 블록↔날짜 프리뷰 + 9개 입력 대사 | 완료 |
| 3 | [`arena-announce`](.claude/skills/arena-announce/SKILL.md) | 디스코드 공지 초안 생성 | 완료 |
| 4 | [`arena-settlement-check`](.claude/skills/arena-settlement-check/SKILL.md) | 정산 tx 상태 확인 | 부분 구현 |
| 5 | [`arena-season-checklist`](.claude/skills/arena-season-checklist/SKILL.md) | 1-4 산출물 집계 | 완료 |

도구 코드는 `tools/9c/`. 모든 단계의 최종 확인·승인·실행은 사람이 한다 — 자동화는 계산·대사·
검증·초안 생성까지만 한다.

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

원설계는 8개 스크립트(자동화는 "정제 이슈 초안"까지만 만들고, 검토·승인·배포 실행은 항상
사람)로 그려졌다. 처음엔 대부분이 권한 승인 대기 중이라 여겼는데, 실제로 확인해보니 애초에
권한이 필요 없던 항목이 둘 있었다 — 밸런스 시트는 이미 무인증 공개 상태였고, 디스코드는
자동 게시 경로 자체가 없어(항상 사람이 수동 게시) 권한을 받을 대상이 없었다. 지금은
[권한 요청 문서](docs/9c-update-automation-permission-request.md)에 **진짜 승인이 필요한
항목이 S3 1건**만 남아 있고, 자체적으로 조사 가능했던 항목은 [조사 결과](docs/9c-update-automation-self-check.md)에
정리해 뒀다.

| 스킬 | 역할 | 상태 |
| --- | --- | --- |
| [`release-guard`](.claude/skills/release-guard/SKILL.md) | 깃북 릴리즈 노트 vs 메인넷 APV vs 인게임 공지판 일관성 대조 + `Event.json` 현재 값 스냅샷 | 부분 구현 — 일관성·헤드 대조 + Event.json 현재 값 스냅샷(`--event-log-file`, 2026-09-01 확인: 공개 CDN이 S3와 같은 오브젝트라 권한 불필요). 과거 버전 소급 조회만 S3 권한 대기(범위 좁아짐) |
| [`datasheet-validate`](.claude/skills/datasheet-validate/SKILL.md) | 밸런스 시트 CSV 구조적 검증 + 회차 간 diff(1차 필수) | 부분 구현 — 중복 헤더·행별 컬럼 수·키 컬럼 공백·행 수 급감(v200450 실패 모드 3종 회귀 포함)·`--baseline-csv` 회차 diff(qa-checklist의 diffSheet 재사용, 미해결 B 중 diff 기준선 쪽은 lib9c git 이력 조사로 "별도 스냅샷"으로 판단 — 대상 브랜치·PR 타겟 쪽은 여전히 미결정). 시트 간 참조 ID·타입 검증만 lib9c 스키마 매핑 선행 필요로 미착수 |
| [`deploy-prep`](.claude/skills/deploy-prep/SKILL.md) | 배포 전/후 체크리스트 + `latest.json` 롤백 스냅샷 + APV 결번 검사(release-guard 로직 재사용) | 부분 구현 — Manage Apv 워크플로 실제 트리거·PR/브랜치/태그/changelog 자동화는 D4 원칙(자동화가 라이브를 안 바꿈)상 범위 밖, 입력값 계산까지만 하고 항상 사람이 실행 |
| [`qa-checklist`](.claude/skills/qa-checklist/SKILL.md) | 시트 CSV 전/후 diff → 추가·삭제·변경 행 QA 체크리스트 | 부분 구현 — "무엇이 바뀌었는지"만. "그래서 무엇을 테스트해야 하는지"(시트별 기능 매핑)는 lib9c 도메인 지식 필요로 미착수 |
| [`announce-fanout`](.claude/skills/announce-fanout/SKILL.md) | 인게임 공지(EN/KR/JP) → 디스코드 공지 초안 재포장 + 언어별 불일치 검사 | 부분 구현 — 정규 업데이트 공지 변환만. 휴장/이벤트 공지 초안은 미착수 — Event.json 읽기 자체는 더 이상 안 막혀 있지만(2026-09-01 확인), 그 파일엔 배너 메타데이터만 있고 초안화할 문구가 없음 |
| `spec-to-datasheet` / `datasheet-to-csv` | 밸런스 시트 파이프라인 나머지 2종(1차 필수) | 미착수 — 각각 노션 공유 확인·(lib9c push 확인 + 기존 CSV 익스포트 도구 소유·운영 실태 조사) 필요 |
| [`release-notes`](.claude/skills/release-notes/SKILL.md) | 버전+카테고리별 항목 → 깃북 붙여넣기용 릴리즈 노트 초안 | 부분 구현 — 버전 대사(+10 관행, 중복 게시 방지)·섹션 정리만. ⑥ 확인(깃북 에디터 직접 입력, GitHub 토큰 불필요)으로 착수. 문구는 짓지 않고 사람이 준 것만 정리 — 정확한 마크다운 문법은 원본 저장소(`nine-chronicles-docs`, 비공개) 미확인으로 검증 못 함 |

도구 코드는 `tools/9c/release-guard.ts` + `tools/9c/lib/release-guard.ts`, `tools/9c/datasheet-validate.ts`
+ `tools/9c/lib/datasheet-validate.ts`, `tools/9c/deploy-prep.ts` + `tools/9c/lib/deploy-prep.ts`,
`tools/9c/qa-checklist.ts` + `tools/9c/lib/qa-checklist.ts`, `tools/9c/announce-fanout.ts` +
`tools/9c/lib/announce-fanout.ts`, `tools/9c/release-notes.ts` + `tools/9c/lib/release-notes.ts`.
CSV 파서(`tools/9c/lib/csv.ts`)는 datasheet-validate와 qa-checklist가 공유한다(순환 참조
방지용 분리). release-guard는 실행 즉시 실제 프로덕션 상태(2026-08-30/31 기준, 인게임
공지판이 깃북보다 2차수 뒤처진 상태)를 FATAL로 잡아낸다 — 조사 근거는
[`references/release-guard-investigation.md`](.claude/skills/release-guard/references/release-guard-investigation.md).
