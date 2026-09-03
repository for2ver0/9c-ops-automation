---
name: deploy-prep
description: 나인 크로니클 메인넷 배포(월간 정규 업데이트) 직전/직후 사람이 해야 할 절차를 준비할 때 사용. 깃북(기준) 대비 odin/heimdall 매니페스트 APV가 뒤처졌는지 확인하고, latest.json 롤백 스냅샷을 쌓고, 9c-infra "Manage Apv" 워크플로에 넣을 입력값을 계산해 배포 전/후 체크리스트로 낸다. "배포 준비해줘", "이번 배포 체크리스트 뽑아줘", "deploy-prep 돌려줘" 같은 요청에 사용. 전부 인증 없는 공개 읽기 + 로컬 로그 파일이라 권한 승인 없이 바로 실행 가능. ⚠️ 원래 설계 문서 부록 C가 그리던 것 중 이 스킬은 "APV 결번 검사(release-guard 재사용) + 롤백 스냅샷 + Manage Apv 입력값 계산"만 만든다 — 실제 워크플로 트리거·PR 생성·브랜치/태그/changelog 자동화는 D4 원칙(자동화는 라이브를 바꾸지 않는다)에 따라 범위 밖이고, 항상 사람이 GitHub Actions에서 직접 실행한다(아래 참고).
---

# deploy-prep (부분 구현 — APV 결번 검사 재사용 + 롤백 스냅샷 + Manage Apv 입력값 준비)

> 이 스킬은 2026-09-01 세션에서 처음 SKILL.md로 작성됐다. 설계 문서("나인 크로니클
> 업데이트 자동화 설계" 부록 C)가 deploy-prep에 요구한 항목 중 **권한 없이 바로 착수
> 가능한 부분만** 구현했다. 왜 이렇게 됐는지 먼저 읽을 것.

## 무엇이 왜 이렇게 됐는지

부록 C는 deploy-prep을 "배포 PR/브랜치·태그·changelog·배포 전 체크리스트 · `latest.json`
롤백 스냅샷 · APV 번호 PR 준비 + 회차 APV 누락 검사"로 그린다. 실제로 만들어보니 이 항목들의
성격이 갈렸다:

- **APV 결번 검사**(깃북 vs 매니페스트)는 `release-guard`가 이미 순수 함수
  (`checkGitbookVsManifest`, `tools/9c/lib/release-guard.ts`)로 구현해 뒀다. 두 스킬이 같은
  대조를 각자 다시 구현하면 판정이 어긋날 여지가 생기므로, deploy-prep은 이 함수를 그대로
  `import`해서 쓴다 — 중복 구현하지 않는다.
- **`latest.json` 롤백 스냅샷**은 release-guard의 `--log-file`과 같은 append-only 로컬 로그
  패턴을 재사용해서 바로 만들 수 있었다. 자격 증명이 필요 없다.
- **Manage Apv 워크플로 입력값 준비**(dir-name × file-name × target APV)도 공개 읽기 결과만
  으로 계산 가능하다. 단 **워크플로 자체를 트리거하지 않는다** — 이건 GitHub Actions 실행
  권한이 필요하고, D4 원칙(자동화는 라이브 상태를 바꾸는 호출을 절대 하지 않는다)에 따라
  항상 사람이 손으로 누른다.
- **배포 PR/브랜치·태그·changelog 자동 생성**은 GitHub 쓰기 권한(⑨와 별개로, PR 생성용
  토큰)이 필요하고 D4 원칙에도 어긋나 애초에 만들지 않는다 — deploy-prep은 "무엇을 해야
  하는지" 체크리스트만 낸다.
- **APV ↔ `latest.json` version 인코딩 규칙**은 부록 C가 "필요하다"고 적어뒀지만 실제 관측은
  2026-08-25 시점 단 1건(v200470 ↔ 47000000011)뿐이다. release-guard가 같은 이유로 이미
  "정보성 표시만, 판정에 안 씀"으로 처리했고(release-guard SKILL.md 4절), deploy-prep도
  같은 결정을 따른다 — 규칙을 만들지 않고 두 값을 나란히 보여주기만 한다.

## 도구 현황

| 도구 | 위치 | 역할 |
| --- | --- | --- |
| `deploy-prep.ts` | `tools/9c/deploy-prep.ts` (bun) | CLI 본체 |
| 로직 | `tools/9c/lib/deploy-prep.ts` | 순수 함수(유닛 테스트 대상) — `release-guard.ts`의 `checkGitbookVsManifest` 재사용 |
| 유닛 테스트 | `tools/9c/lib/deploy-prep.test.ts` | 롤백 대상 탐색·체크리스트 문구·워크플로 입력값 계산, 네트워크 없이 실행 |
| 라이브 검증기 | `tools/9c/fixtures/verify-deploy-prep.ts` | 재사용한 fetch 함수 + 롤백 스냅샷 라운드트립 확인 |

실행: `bun test tools/9c/lib/deploy-prep.test.ts` (유닛), `bun run tools/9c/fixtures/verify-deploy-prep.ts` (라이브).

## 1. 무엇을 하는가

1. **APV 결번 검사** — 깃북(기준) vs odin.yaml/heimdall.yaml `appProtocolVersion`.
   `release-guard`와 동일 로직(재사용). 매니페스트가 깃북보다 뒤처지면 FATAL(배포 자체가
   덜 된 것), 앞서면 WARN(정상 배포 후 노트 작성 대기).
2. **Manage Apv 워크플로 입력값 계산** — 뒤처진 네트워크가 있으면 `dir=9c-main,
   file={odin|heimdall}, target APV=<깃북 값>` 형태로 정확한 입력값을 알려준다. **워크플로를
   대신 실행하지 않는다** — 9c-infra Actions 탭에서 사람이 이 값을 그대로 입력한다.
3. **`latest.json` 롤백 스냅샷** — `--snapshot-log`로 넘긴 로컬 파일에 매 실행마다 현재
   `version`/`timestamp`를 한 줄(JSONL) 추가한다. 지금 값과 다른 가장 최근 기록을 "문제
   생기면 되돌릴 값"으로 계산해 보여준다. 로그가 비어 있으면(아직 한 번도 기록 안 함) WARN —
   롤백 대상이 없다는 뜻이다.
4. **배포 전/후 체크리스트 출력** — 위 세 가지를 사람이 순서대로 확인할 수 있는 텍스트
   체크리스트로 합친다.
5. **APV ↔ latest.json version은 정보성으로만 병기** — 어떤 판정에도 안 씀(위 "무엇이 왜
   이렇게 됐는지" 참고).

## 2. 실행

```bash
# 1회성 확인 (스냅샷 기록 없이)
bun run "$(git rev-parse --show-toplevel)/tools/9c/deploy-prep.ts"

# 롤백 스냅샷을 남기며 실행 (권장 — 배포 전후로 항상 이 옵션)
bun run "$(git rev-parse --show-toplevel)/tools/9c/deploy-prep.ts" --snapshot-log ./deploy-prep-log.jsonl

# JSON으로
bun run "$(git rev-parse --show-toplevel)/tools/9c/deploy-prep.ts" --snapshot-log ./deploy-prep-log.jsonl --json
```

FATAL(매니페스트가 깃북보다 뒤처짐 = APV 결번 의심)이 있으면 exit 1. `--snapshot-log`를
매 배포 전/후 실행마다 같은 파일로 넘겨야 롤백 대상 계산이 의미가 있다 — 파일이 없으면
"이전 값"을 알 방법이 없다(release-guard `--log-file`과 동일 이유).

## 3. 판정 기준 요약

| 대조 | OK | WARN | FATAL |
| --- | --- | --- | --- |
| 깃북 vs odin/heimdall 매니페스트 | 일치 | 매니페스트가 앞섬(정상 배포 후 지연) | 매니페스트가 뒤처짐(APV 누락 의심) |
| 롤백 스냅샷 확보 | 로그에 다른 값 있음, 또는 아직 값이 안 바뀜(정상) | 로그가 비어 있음(기록 시작 안 함) | — |

## 4. 범위 밖 (설계 문서 대비 의도적으로 뺀 것)

- **Manage Apv 워크플로 트리거·PR 자동 생성** — D4 원칙. 입력값 계산까지만 하고 실행은
  항상 사람.
- **배포 PR/브랜치·태그·changelog 자동 생성** — GitHub 쓰기 권한 필요, D4 원칙에도 위배.
  미착수.
- **APV ↔ `latest.json` version 인코딩 규칙** — 관측 1건뿐이라 규칙화하지 않음. 정보성
  병기만.
- **`latest.json` 자체를 되돌리는 실행** — 이 스킬은 롤백 "대상 값"을 찾아줄 뿐, 실제
  파일을 되돌리는 것(배포 인프라 쓰기 권한 필요)은 하지 않는다.
- **thor.yaml, general.yaml** — release-guard와 동일 이유로 게이트 대상 제외.

## 5. 근거

- `docs/9c-update-automation-permission-request.md`, `docs/9c-update-automation-self-check.md`
  — GitHub 토큰(⑨)이 이 개발 환경에 없어 워크플로 트리거·PR 생성 자체를 테스트할 수 없다는
  확인.
- `.claude/skills/release-guard/SKILL.md` — 인코딩 규칙을 정보성으로만 다루기로 한 선례,
  이번 스킬이 그대로 따름.
- 설계 문서 부록 C — 네트워크별 APV 이력 표, Manage Apv 워크플로 입력 형태(F-16).

## 6. 다음에 할 일

| 항목 | 상태 | 필요한 것 |
| --- | --- | --- |
| Manage Apv 워크플로 실제 트리거 | 미착수(의도적) | GitHub Actions 실행 권한 — 항상 사람이 실행(D4) |
| 배포 PR/브랜치/태그/changelog 자동화 | 미착수 | GitHub PR 쓰기 토큰 + D4 원칙 재검토 필요 |
| 롤백 스냅샷 로그를 레포에 실제로 커밋해 지속시키는 것 | 로컬 파일 append만 구현됨 | 사람이 주기 실행마다 커밋(release-guard `--log-file`과 동일 패턴) |
| APV ↔ latest.json version 인코딩 규칙 | 관측 1건뿐이라 미결정 (설계 문서 부록 E, "미해결 B"와는 다른 별개 항목) | 관측 축적 후 재검토 |

## 롤백 스냅샷 로그 검증 (2026-09-03 "조용한 OK" 점검으로 추가)

`--snapshot-log`를 `JSON.parse(줄) as LatestJsonSnapshotEntry`로 **검증 없이 캐스팅**해서
읽던 탓에, 형식만 JSON이면 모양이 달라도 스냅샷으로 받아들였다. 실측 결과:

| 로그 내용 | 그때 결과 |
| --- | --- |
| `{"unrelated":true}` | 체크리스트에 **`[x] 롤백 대상 확보됨 — 문제 발생 시 version=undefined(undefined 관측)로 되돌릴 수 있습니다.`** 출력 |
| `"just a string"` | 위와 같음 |
| `null` | `null is not an object (evaluating 'sorted[i].version')` 내부 오류가 그대로 노출 |

**롤백은 사고 대응 경로라 "있다고 했는데 없음"이 가장 위험하다** — 배포가 잘못된 상황에서
체크된 안내를 믿고 되돌리려 하면 대상이 없다.

지금은 `isLatestJsonSnapshotEntry`로 모양을 검사해 **쓸 수 없는 줄은 건너뛰고, 몇 번째 줄을
건너뛰었는지 WARN으로 알린다**(`롤백 스냅샷 로그 형식` 항목). 한 줄이 상했다고 나머지 정상
기록까지 못 쓰게 만들면 정작 롤백이 필요할 때 도구가 막히므로 전체 실패로 처리하지 않는다.
구현은 `tools/9c/lib/jsonl-log.ts` 공용 헬퍼(`release-guard`와 공유).
