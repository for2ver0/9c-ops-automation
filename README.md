# 나인 크로니클 (Nine Chronicles) 운영 자동화

## 1. 아레나 (Arena)

아레나 시즌 준비 프로세스를 5개 스킬로 자동화. **담당자는 명령어를 몰라도 됩니다** — Claude에게
말로 요청하면 됩니다, [`docs/arena-season-prep-user-guide.md`](docs/arena-season-prep-user-guide.md)
참고. 전체 배경·결정 사항은 [`docs/arena-season-prep-spec.md`](docs/arena-season-prep-spec.md),
실행 순서·사람 개입 지점(에이전트용)은
[`arena-season-prep` 스킬](.claude/skills/arena-season-prep/SKILL.md)을 참고.

| 순위 | 스킬 | 역할 | 상태 |
| --- | --- | --- | --- |
| 1 | [`arena-reward-table`](.claude/skills/arena-reward-table/SKILL.md) | 상금 표 계산 + PNG + 불변식 검증 | 완료 |
| 2 | [`arena-season-preview`](.claude/skills/arena-season-preview/SKILL.md) | 시즌 등록 전 블록↔날짜 프리뷰 + 9개 입력 대사 | 완료 |
| 3 | [`arena-announce`](.claude/skills/arena-announce/SKILL.md) | 디스코드 공지 초안 생성 | 완료 |
| 4 | [`arena-settlement-check`](.claude/skills/arena-settlement-check/SKILL.md) | 정산 tx 상태 확인 | 부분 구현 |
| 5 | [`arena-season-checklist`](.claude/skills/arena-season-checklist/SKILL.md) | 1-4 산출물 집계 | 완료 |

도구 코드는 `tools/9c/`. 모든 단계의 최종 확인·승인·실행은 사람이 한다 — 자동화는 계산·대사·
검증·초안 생성까지만 한다.

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
| [`release-guard`](.claude/skills/release-guard/SKILL.md) | 깃북 릴리즈 노트 vs 메인넷 APV vs 인게임 공지판 일관성 대조 | 부분 구현 — 일관성·헤드 대조만, `Event.json` 스냅샷은 S3 권한 대기 |
| `datasheet-validate` | 밸런스 시트 검증(1차 필수) | 미착수 — 권한 블로커 없음(시트가 공개로 확인됨), 착수만 하면 됨 |
| `announce-fanout` | 디스코드 공지 초안 생성 | 미착수 — 권한 블로커 없음(게시는 원래도 항상 사람이 수동으로 함), 초안 생성 스킬로 착수만 하면 됨 |
| `spec-to-datasheet` / `datasheet-to-csv` | 밸런스 시트 파이프라인 나머지 2종(1차 필수) | 미착수 — 각각 노션 공유 확인·lib9c push 확인 필요 |

도구 코드는 `tools/9c/release-guard.ts` + `tools/9c/lib/release-guard.ts`. 실행 즉시 실제
프로덕션 상태(2026-08-30/31 기준, 인게임 공지판이 깃북보다 2차수 뒤처진 상태)를 FATAL로
잡아낸다 — 조사 근거는 [`references/release-guard-investigation.md`](.claude/skills/release-guard/references/release-guard-investigation.md).
