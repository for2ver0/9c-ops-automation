---
name: release-guard
description: 나인 크로니클 정규 업데이트 릴리즈가 깃북 릴리즈 노트·메인넷 매니페스트 APV·인게임 공지판(TextNotice*.json) 세 곳에서 서로 일치하는지 대조할 때 사용. "이번 릴리즈 상태 확인해줘", "공지판 안 올라온 거 있는지 봐줘", "release-guard 돌려줘" 같은 요청에 사용. 전부 인증 없는 공개 읽기라 권한 승인 없이 바로 실행 가능. ⚠️ 원래 설계 문서가 그리던 두 갈래(일관성·헤드 대조 + Event.json 스냅샷/백업) 중 이 스킬은 첫 번째만 구현한다 — Event.json 쪽은 S3 읽기 권한과 백업 저장 위치 결정이 아직 없어 범위 밖이다(아래 참고).
---

# release-guard (부분 구현 — 일관성·헤드 대조만)

> 이 스킬은 2026-08-30/31 세션에서 처음 SKILL.md로 작성됐다. 설계 문서("나인 크로니클
> 업데이트 자동화 설계")가 release-guard에 요구한 두 갈래 중 **권한 없이 바로 착수 가능한
> 절반만** 구현했다. 왜 이렇게 됐는지 먼저 읽을 것.

## 무엇이 왜 이렇게 됐는지

설계 문서는 release-guard를 "일관성·헤드" 대조(§4)와 "`Event.json` 스냅샷/백업"(부록 D) 두
축으로 그렸다. 둘의 성격이 다르다:

- **일관성·헤드 대조**는 깃북·GitHub raw·CDN JSON을 읽기만 하면 되고, 어디에도 자격 증명이
  필요 없다. 설계 문서 스스로 "권한 대기 없이 가장 먼저 착수 가능"이라고 표시해 둔 부분이다.
- **`Event.json` 스냅샷**은 S3 `9c-assets/live-assets/Json/Event.json`을 정기적으로 읽어야
  하고, 그 결과를 어디에 백업할지(개인 레포 vs org 레포 등, 설계 문서 부록 D-1)도 아직
  정해지지 않았다. 둘 다 사람의 결정/권한 부여가 필요한 1차 블로커다.

그래서 이번 착수에서는 앞쪽만 만들었다. 뒤쪽(`Event.json`)은 권한이 오면 별도로 붙인다 —
이 스킬의 코드 구조(`tools/9c/lib/release-guard.ts`)에 스냅샷 관련 함수를 추가하고
`release-guard.ts` CLI에서 같이 호출하도록 확장하면 된다.

## 도구 현황

| 도구 | 위치 | 역할 |
| --- | --- | --- |
| `release-guard.ts` | `tools/9c/release-guard.ts` (bun) | CLI 본체 |
| 대조/파싱 로직 | `tools/9c/lib/release-guard.ts` | 순수 함수(유닛 테스트 대상) + fetch 함수 |
| 유닛 테스트 | `tools/9c/lib/release-guard.test.ts` | 파싱·판정 로직, 네트워크 없이 실행 |
| 라이브 검증기 | `tools/9c/fixtures/verify-release-guard.ts` | 4개 실제 엔드포인트를 직접 찔러 확인 |

실행: `bun test tools/9c/lib/release-guard.test.ts` (유닛), `bun run tools/9c/fixtures/verify-release-guard.ts` (라이브).

## 1. 무엇을 하는가

세 곳의 "지금 릴리즈가 몇 번인가" 주장을 서로 대조한다.

1. **깃북 릴리즈 노트**(`docs.nine-chronicles.com/introduction/intro/release-notes`) — 설계
   문서가 채택한 기준(SOT). 최상단 항목의 버전을 읽는다.
2. **메인넷 매니페스트**(`planetarium/9c-infra` 레포의 `9c-main/network/{odin,heimdall}.yaml`,
   `appProtocolVersion` 필드) — 그 네트워크가 실제로 구동 중인 버전.
3. **인게임 공지판**(`assets.nine-chronicles.com/live-assets/Json/TextNotice{,_KR,_JP}.json`) —
   플레이어가 실제로 보는 버전 표시.

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
- thor.yaml, `latest.json`의 클라 빌드 버전은 **정보성으로만 표시**하고 어떤 판정에도 쓰지
  않는다(이유는 아래 "범위 밖" 참고).

## 2. 실행

```bash
# 1회성 확인
bun run tools/9c/release-guard.ts

# 24시간 유예 판단을 위해 로그를 남기며 실행 (권장 — 주기 실행이면 항상 이 옵션)
bun run tools/9c/release-guard.ts --log-file ./release-guard-log.jsonl

# JSON으로
bun run tools/9c/release-guard.ts --log-file ./release-guard-log.jsonl --json
```

FATAL이 하나라도 있으면 exit 1. `--log-file`을 주면 실행할 때마다 한 줄(JSONL)을 append한다
— 이게 없으면 "매니페스트가 깃북보다 앞선 지 몇 시간째인지" 판단 자체가 불가능하다(설계
문서 부록 B-4(c): "24시간 지속"은 이전 관측을 기억해야 하는데 매 실행은 stateless).

## 3. 판정 기준 요약

| 대조 | OK | WARN | FATAL |
| --- | --- | --- | --- |
| 깃북 vs 공지판 헤더 | 일치 | 1차수 지연 | 2차수 이상 지연, 또는 공지가 깃북보다 앞섬(순서 이상) |
| 깃북 vs 매니페스트(odin/heimdall) | 일치 | 매니페스트가 앞섬(배포 직후 정상 지연) | 매니페스트가 뒤처짐(APV 누락 의심) |
| 깃북 자체 갱신 여부 (로그 기반) | 매니페스트 따라잡음 | 24시간 미만 지연 | 24시간 이상 지연 |
| 공지 헤더 형식(`v{APV}`) | 정상 | — | 형식 오류 |
| 공지 본문 비어있음 | 본문 있음 | — | 비어있음 |
| 언어별 공지 일치 | 3개 언어 동일 | 불일치 | — |
| thor.yaml | 항상 정보성, FATAL 없음 | | |

## 4. 범위 밖 (설계 문서 대비 의도적으로 뺀 것)

- **`Event.json` 스냅샷/백업** — 위 "무엇이 왜 이렇게 됐는지" 참고. S3 읽기 권한 + 백업
  저장 위치 결정 대기.
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
| 4개 엔드포인트 모두 인증 없는 공개 읽기 | 이 세션, 2026-08-30/31 라이브로 확인 |
| 매니페스트 레포는 `planetarium/9c-infra`(설계 문서엔 레포명이 없었음) | 라이브 프로빙(`9c-k8s-config`는 404, `9c-infra`는 200) |
| `general.yaml`엔 `appProtocolVersion` 키가 없음 | 라이브로 확인, 설계 문서 주장과 일치 |
| "2026-07-21·08-25 2회 연속 미갱신"이 **지금도 실제로 재현됨**(깃북 v200470, 공지판 v200450) | 이 세션, `release-guard.ts` 실행 결과 FATAL로 그대로 잡힘 — 픽스처 아님 |

## 6. 아직 해소되지 않은 것

| 항목 | 상태 | 필요한 것 |
| --- | --- | --- |
| `Event.json` 스냅샷/백업 | 미착수 | S3 읽기 권한, 백업 저장 위치 결정(설계 문서 부록 D-1) |
| 24시간 유예 로그를 레포에 실제로 커밋해 지속시키는 것 | 로컬 파일 append만 구현됨 | 사람이 주기 실행마다 커밋(arena-settlement-check `--log-file`과 동일 패턴) — 또는 별도 자동 커밋 파이프라인 |
| 깃북이 실제로 정본인지(노션 파생 여부) | 미확인 | 설계 문서 미확인 1과 동일 — 담당자 확인 필요 |
| `datasheet-to-csv`/`datasheet-validate`/`spec-to-datasheet`(밸런스 시트 파이프라인 3종) | 착수 안 함 | 밸런스 시트(Vault) 접근 권한 승인 대기(설계 문서 §5 권한 요청 ①, 1차 블로커) |
