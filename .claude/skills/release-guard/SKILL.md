---
name: release-guard
description: 나인 크로니클 정규 업데이트 릴리즈가 깃북 릴리즈 노트·메인넷 매니페스트 APV·인게임 공지판(TextNotice*.json) 세 곳에서 서로 일치하는지 대조하고, Event.json의 현재 값을 스냅샷으로 남길 때 사용. "이번 릴리즈 상태 확인해줘", "공지판 안 올라온 거 있는지 봐줘", "release-guard 돌려줘" 같은 요청에 사용. 전부 인증 없는 공개 읽기라 권한 승인 없이 바로 실행 가능. ⚠️ 원래 설계 문서가 그리던 두 갈래(일관성·헤드 대조 + Event.json 스냅샷/백업) 중, 2026-09-01에 담당자 제보로 Event.json도 인증 없는 공개 CDN으로 같이 서빙된다는 게 확인돼 "현재 값 스냅샷"까지 구현됐다 — 다만 S3에 남아있는 과거 버전을 소급 조회하는 것(진짜 "백업")은 여전히 S3 자격증명이 필요해 범위 밖이다(아래 참고).
---

# release-guard (부분 구현 — 일관성·헤드 대조 + Event.json 현재 값 스냅샷)

> 이 스킬은 2026-08-30/31 세션에서 처음 SKILL.md로 작성됐고, 2026-09-01에 Event.json 관련
> 전제가 정정되면서 스냅샷 기능이 추가됐다. 왜 이렇게 됐는지 먼저 읽을 것.

## 무엇이 왜 이렇게 됐는지

설계 문서는 release-guard를 "일관성·헤드" 대조(§4)와 "`Event.json` 스냅샷/백업"(부록 D) 두
축으로 그렸다.

- **일관성·헤드 대조**는 깃북·GitHub raw·CDN JSON을 읽기만 하면 되고, 어디에도 자격 증명이
  필요 없다 — 2026-08-30/31에 먼저 만들었다.
- **`Event.json` 스냅샷**은 원래 "S3 읽기 권한이 있어야만 성립한다"는 전제로 미착수 상태였다.
  그런데 2026-09-01에 담당자가 직접 확인해서 알려준 사실이 이 전제를 뒤집었다 —
  `https://assets.nine-chronicles.com/live-assets/Json/Event.json`이 Backoffice가 쓰는 S3
  오브젝트(`9c-assets`/`live-assets/Json/Event.json`)와 **같은 것**이고, 게임 클라이언트가
  원래 이 CDN URL로 읽는다(`LiveAssetEndpoint.asset`의 `EventJsonUrl`). 즉 **"현재 값"을
  읽는 데는 S3 자격증명이 전혀 필요 없었다.** 응답 헤더의 `x-amz-version-id`로 버킷
  versioning이 켜져 있다는 것도 확인됐다 — S3 쪽엔 과거 버전이 이미 남아있다는 뜻이다.

그래서 "현재 값 스냅샷"(변경 여부 감지 + 원문 보존)은 이번에 release-guard에 바로 붙였다.
다만 **S3에 남은 과거 버전을 "소급 조회"하는 것(`s3:GetObjectVersion`)은 CDN으로 안 되고
진짜 S3 자격증명이 필요**해서 여전히 범위 밖이다 — 권한 요청 범위가 좁아졌을 뿐 완전히
사라지진 않았다(`docs/9c-update-automation-permission-request.md` ⑧ 참고).

## 도구 현황

| 도구 | 위치 | 역할 |
| --- | --- | --- |
| `release-guard.ts` | `tools/9c/release-guard.ts` (bun) | CLI 본체 |
| 대조/파싱 로직 | `tools/9c/lib/release-guard.ts` | 순수 함수(유닛 테스트 대상) + fetch 함수 |
| 유닛 테스트 | `tools/9c/lib/release-guard.test.ts` | 파싱·판정 로직, 네트워크 없이 실행 |
| 라이브 검증기 | `tools/9c/fixtures/verify-release-guard.ts` | 실제 엔드포인트(Event.json 포함)를 직접 찔러 확인 |

실행: `bun test tools/9c/lib/release-guard.test.ts` (유닛), `bun run tools/9c/fixtures/verify-release-guard.ts` (라이브).

## 1. 무엇을 하는가

네 곳의 "지금 릴리즈가 몇 번인가" 주장을 서로 대조한다.

1. **깃북 릴리즈 노트**(`docs.nine-chronicles.com/introduction/intro/release-notes`) — 설계
   문서가 채택한 기준(SOT). 최상단 항목의 버전을 읽는다.
2. **메인넷 매니페스트**(`planetarium/9c-infra` 레포의 `9c-main/network/{odin,heimdall}.yaml`,
   `appProtocolVersion` 필드) — 그 네트워크가 실제로 구동 중인 버전.
3. **인게임 공지판**(`assets.nine-chronicles.com/live-assets/Json/TextNotice{,_KR,_JP}.json`) —
   플레이어가 실제로 보는 버전 표시.
4. **`TextNotice*.json`의 LiveAssets git 원본**(`planetarium/NineChronicles.LiveAssets` 레포,
   `Assets/Json/`) — 3번과 달리 `Event.json`은 git에 없지만 `TextNotice*.json`은 실제로 PR을
   거쳐 git으로 관리된다. CDN이 이 git 버전과 다르면 배포 흐름에 이상이 있다는 뜻이다.

대조 결과로 다음을 잡는다 (실제로 2026-08-30/31 기준 라이브 데이터에서 재현됨 — 참고:
`references/release-guard-investigation.md`):

- **인게임 공지 미갱신** — 깃북은 최신인데 공지판이 뒤처진 경우. 1차수 지연은 WARN(아직
  게시 전일 수 있음), **2차수 이상은 FATAL** — 설계 문서가 서술한 "2026-07-21·08-25 2회
  연속 미갱신"과 정확히 같은 패턴이고, 지금도 실제로 이 상태다.
- **APV 누락** — 매니페스트가 깃북보다 뒤처진 경우(예: 2026-06-25 v200450 결번 같은 사고).
  즉시 FATAL.
- **정상적인 배포 지연** — 매니페스트가 깃북보다 앞선 경우(배포는 됐고 노트를 아직 안 쓴
  상태). 24시간까지는 WARN, **24시간을 넘기면 FATAL로 격상**(`--log-file`로 넘긴 로컬
  로그에서 "언제부터 이 상태였는지"를 되짚어 판단 — 매 실행이 stateless라서 로그 없이는
  지속 시간을 알 수 없다).
- **공지 헤더 형식 오류** — `v{APV}` 형식이 아니면 Backoffice의 최신-3개-유지 정렬 로직이
  이 항목을 밀어낼 수 있음(FATAL).
- **게시된 공지의 빈 본문** — 붙여넣기 누락 사후 탐지(FATAL).
- **언어별 공지 불일치** — EN/KR/JP 헤더가 서로 다르면 WARN.
- **CDN이 LiveAssets git보다 최신** — PR 절차 없이 CDN에 직접 배포된 것으로 의심되는 상태.
  즉시 FATAL. (반대로 git이 CDN보다 최신인 건 머지 직후 배포 전파 지연일 뿐이라 WARN.)
- thor.yaml, `latest.json`의 클라 빌드 버전은 **정보성으로만 표시**하고 어떤 판정에도 쓰지
  않는다(이유는 아래 "범위 밖" 참고).

**Event.json 현재 값 스냅샷** — 5번째 대조 대상. `Event.json`은 Backoffice
`/event-banner-manager`가 PR·백업 없이 즉시 덮어쓰는 파일이라(부록 D) 변경 이력이 전혀
안 남는 게 원래 문제였다. `--event-log-file`로 로컬 append-only 로그를 남기면, 매 실행마다
`x-amz-version-id`/`ETag`/원문 전체를 기록해 "언제 뭐가 바뀌었는지" 나중에 diff로 확인할 수
있다. 바뀌는 것 자체는 정상(담당자의 일상적인 이벤트 운영)이라 **항상 OK** — 게이트가
아니라 감사 기록이다.

## 2. 실행

```bash
# 1회성 확인
bun run "$(git rev-parse --show-toplevel)/tools/9c/release-guard.ts"

# 24시간 유예 판단 + Event.json 변경 이력을 남기며 실행 (권장 — 주기 실행이면 항상 이 옵션들)
bun run "$(git rev-parse --show-toplevel)/tools/9c/release-guard.ts" --log-file ./release-guard-log.jsonl --event-log-file ./event-json-log.jsonl

# JSON으로
bun run "$(git rev-parse --show-toplevel)/tools/9c/release-guard.ts" --log-file ./release-guard-log.jsonl --event-log-file ./event-json-log.jsonl --json
```

FATAL이 하나라도 있으면 exit 1. `--log-file`을 주면 실행할 때마다 한 줄(JSONL)을 append한다
— 이게 없으면 "매니페스트가 깃북보다 앞선 지 몇 시간째인지" 판단 자체가 불가능하다(설계
문서 부록 B-4(c): "24시간 지속"은 이전 관측을 기억해야 하는데 매 실행은 stateless).
`--event-log-file`도 같은 이유로 필요하다 — Event.json 원문 전체(4KB대, 회차마다 쌓여도
부담 적음)를 포함해 append하므로, 이 파일을 git으로 관리하면 그 자체가 변경 이력이 된다.

## 3. 판정 기준 요약

| 대조 | OK | WARN | FATAL |
| --- | --- | --- | --- |
| 깃북 vs 공지판 헤더 | 일치 | 1차수 지연 | 2차수 이상 지연, 또는 공지가 깃북보다 앞섬(순서 이상) |
| 깃북 vs 매니페스트(odin/heimdall) | 일치 | 매니페스트가 앞섬(배포 직후 정상 지연) | 매니페스트가 뒤처짐(APV 누락 의심) |
| 깃북 자체 갱신 여부 (로그 기반) | 매니페스트 따라잡음 | 24시간 미만 지연 | 24시간 이상 지연 |
| 공지 헤더 형식(`v{APV}`) | 정상 | — | 형식 오류 |
| 공지 본문 비어있음 | 본문 있음 | — | 비어있음 |
| 언어별 공지 일치 | 3개 언어 동일 | 불일치 | — |
| CDN vs LiveAssets git | 일치 | git이 앞섬(전파 지연) | CDN이 git보다 앞섬(PR 우회 의심), 또는 버전은 같은데 본문이 다름 |
| thor.yaml | 항상 정보성, FATAL 없음 | | |
| Event.json 스냅샷 | 항상 정보성(변경 유무만 표시) | 조회 실패 시 이 검사만 건너뜀 | — (게이트 아님) |

## 4. 범위 밖 (설계 문서 대비 의도적으로 뺀 것)

- **`Event.json` 과거 버전 소급 조회("진짜 백업")** — S3 버킷 versioning 덕에 과거 값이
  실제로 남아있다는 건 확인됐지만(`x-amz-version-id` 응답), 그걸 꺼내 보려면
  `s3:GetObjectVersion`/`s3:ListBucketVersions` 같은 진짜 S3 자격증명이 필요하다. CDN
  경로로는 항상 "현재 값"만 온다. 권한 요청 문서 ⑧ 참고 — 범위가 "현재 값 스냅샷"에서
  "과거 버전 조회"로 좁아졌을 뿐 아직 승인 대기 중이다.
- **CDN 캐시로 인한 놓침 위험** — CloudFront TTL 때문에 짧게 바꿨다 되돌린 변경은 스냅샷
  주기 사이에서 놓칠 수 있다. `versionId`/`etag`를 매번 같이 기록해 "그때 어떤 S3 버전을
  떴는지"는 확정할 수 있지만, "그 사이에 다른 버전이 있었는지"까지는 CDN만으로 알 수 없다
  — 이것도 결국 위 소급 조회 권한이 있어야 완전히 메워진다.
- **`latest.json`의 `version` ↔ APV 인코딩 규칙** — 설계 문서 스스로 "관측 1건뿐, 규칙
  검증으로 보지 않는다"고 명시한 항목. 추측으로 규칙화하면 근거 없는 게이트가 되므로,
  이 값은 화면에 정보성으로만 띄우고 판정에 쓰지 않는다.
- **thor 게이트** — odin/heimdall과 릴리즈 주기가 달라 정기적으로 뒤처지는 게 정상 관측.
  게이트에서 제외.
- **`Manage Apv` 워크플로 트리거·PR 자동화** — 설계 문서 D4 원칙(자동화는 라이브 상태를
  바꾸는 호출을 절대 하지 않는다)에 따라 이 스킬은 읽기만 한다. FATAL이 뜨면 "9c-infra
  Manage Apv 워크플로/Backoffice `/release-notice`를 사람이 직접 확인·실행하라"고 알려줄
  뿐, 무엇도 대신 누르지 않는다.

## 5. 근거 (확인됨)

`references/release-guard-investigation.md`에 조사 전문이 있다. 핵심만:

| 사실 | 근거 |
| --- | --- |
| 5개 엔드포인트(깃북·매니페스트·공지 CDN·공지 LiveAssets git·latest.json) 모두 인증 없는 공개 읽기 | 이 세션, 2026-08-30/31 라이브로 확인 |
| 매니페스트 레포는 `planetarium/9c-infra`(설계 문서엔 레포명이 없었음) | 라이브 프로빙(`9c-k8s-config`는 404, `9c-infra`는 200) |
| `general.yaml`엔 `appProtocolVersion` 키가 없음 | 라이브로 확인, 설계 문서 주장과 일치 |
| 설계 문서가 "LiveAssets"라 부른 레포의 정식 이름은 `planetarium/NineChronicles.LiveAssets`(공개) | 라이브 프로빙(`docs/9c-update-automation-self-check.md` 참고) — `TextNotice*.json`은 git 관리되지만 `Event.json`은 없음(교차검증) |
| "2026-07-21·08-25 2회 연속 미갱신"이 **지금도 실제로 재현됨**(깃북 v200470, 공지판 v200450) | 이 세션, `release-guard.ts` 실행 결과 FATAL로 그대로 잡힘 — 픽스처 아님 |
| Event.json이 S3(9c-assets)와 같은 오브젝트를 인증 없는 공개 CDN으로도 서빙(`x-amz-version-id` 응답 포함 — 버킷 versioning 켜짐) | 2026-09-01, 담당자 제보 + 이 세션이 직접 재현(curl로 HTTP 200, 4201바이트, 버전 헤더 확인) |

## 6. 아직 해소되지 않은 것

| 항목 | 상태 | 필요한 것 |
| --- | --- | --- |
| `Event.json` 과거 버전 소급 조회 | 미착수 | S3 자격증명(`s3:GetObjectVersion`/`s3:ListBucketVersions`, 해당 키 한정) — 권한 요청 문서 ⑧, 범위 좁아짐 |
| 24시간 유예 로그·Event.json 스냅샷 로그를 레포에 실제로 커밋해 지속시키는 것 | 로컬 파일 append만 구현됨 | 사람이 주기 실행마다 커밋(arena-settlement-check `--log-file`과 동일 패턴) — 또는 별도 자동 커밋 파이프라인 |
| 과거 버전 보존 기간(S3 noncurrent version lifecycle) | 미확인 — `9c-assets`가 9c-infra terraform에 없어(0건) 콘솔에서 직접 확인 필요 | 인프라 접근 권한 있는 사람이 S3 콘솔에서 확인 |
| 깃북이 실제로 정본인지(노션 파생 여부) | 미확인 | 설계 문서 미확인 1과 동일 — 담당자 확인 필요 |
| `datasheet-to-csv`/`spec-to-datasheet`(밸런스 시트 파이프라인 나머지 2종) | 착수 안 함 | 각각 GitHub 토큰 확인 + 기존 도구 조사, 노션 공유 확인 (`datasheet-validate`는 이미 부분 구현됨) |
