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

전체 설계(왜 자동화는 "이슈 초안 → 승인 게이트"까지만 하고 배포·발행은 항상 사람인지, 8개
스크립트 중 왜 3개만 1차 필수인지)는 설계 문서를 참고. 지금 구현된 건 그중 **권한 승인 없이
바로 착수 가능했던 한 조각**뿐이다 — 나머지(밸런스 시트 파이프라인 3종, `Event.json` 스냅샷)는
Vault/S3 권한 승인 대기 중이라 착수하지 않았다.

| 스킬 | 역할 | 상태 |
| --- | --- | --- |
| [`release-guard`](.claude/skills/release-guard/SKILL.md) | 깃북 릴리즈 노트 vs 메인넷 APV vs 인게임 공지판 일관성 대조 | 부분 구현 — 일관성·헤드 대조만, `Event.json` 스냅샷은 권한 대기 |
| `spec-to-datasheet` / `datasheet-validate` / `datasheet-to-csv` | 밸런스 시트 파이프라인(1차 필수 3종) | 미착수 — 밸런스 시트(Vault) 접근 권한 승인 대기 |

도구 코드는 `tools/9c/release-guard.ts` + `tools/9c/lib/release-guard.ts`. 실행 즉시 실제
프로덕션 상태(2026-08-30/31 기준, 인게임 공지판이 깃북보다 2차수 뒤처진 상태)를 FATAL로
잡아낸다 — 조사 근거는 [`references/release-guard-investigation.md`](.claude/skills/release-guard/references/release-guard-investigation.md).
