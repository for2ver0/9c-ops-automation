# release-guard 조사 기록 (2026-08-30/31)

> **2026-09-01 갱신**: 이 문서의 "Event.json 스냅샷/백업" 관련 서술은 2026-08-30/31
> 시점 기준이다. 그 이후 담당자 제보로 `Event.json`이 인증 없는 공개 CDN으로도 서빙된다는
> 게 확인돼 "현재 값 스냅샷"은 이미 구현됐다 — 최신 상태는 `.claude/skills/release-guard/SKILL.md`
> 참고. 아래 내용은 그 시점의 조사 과정을 그대로 남겨둔 것이다.
>
> **2026-09-02 추가 정정**: 아래 "아직 해소되지 않은 것" 표의 `datasheet-*` 행("착수
> 안 함 — 권한 없음")도 이 문서 작성 시점(2026-08-30/31) 기준이며 이후 뒤집혔다.
> 2026-08-31에 밸런스 시트가 이미 무인증 공개 상태임이 확인돼 권한 요청 자체가 철회됐고
> (`docs/9c-update-automation-permission-request.md` ①), `datasheet-validate`는 부분
> 구현 완료 상태다 — 최신 상태는 `.claude/skills/datasheet-validate/SKILL.md` 참고.

원본 설계 문서("나인 크로니클 업데이트 자동화 설계")가 release-guard에 요구한 범위는 두 갈래다.

1. **일관성·헤드 대조** — 깃북(기준) vs 메인넷 매니페스트 APV vs 인게임 공지판 헤더. 설계
   문서가 "권한 대기 없이 가장 먼저 착수 가능"이라고 명시한 부분(§4 `release-guard` 행,
   §5 각주). **이번에 구현한 게 이것.**
2. **`Event.json` 스냅샷/백업** — S3 `9c-assets/live-assets/Json/Event.json`을 주기적으로 읽어
   변경 이력을 보존. 설계 문서 부록 D. **미착수** — 읽기 권한(⑧)과 백업 저장 위치 결정이
   아직 없다(설계 문서 §5 "권한 요청" 표, 1차 블로커).

이 문서는 1번을 만들면서 실제로 확인한 것만 적는다 — 설계 문서에 적힌 URL·경로는 조직/레포
이름이 명시되지 않았거나(예: "`9c-main/network/*.yaml`"이 어느 레포 안의 경로인지) 추정이었으므로,
전부 라이브로 직접 찔러서 재확인했다.

## 확인된 엔드포인트 (전부 인증 불필요, 공개 읽기)

| 데이터 | URL | 확인 내용 |
| --- | --- | --- |
| 깃북 릴리즈 노트 | `https://docs.nine-chronicles.com/introduction/intro/release-notes` | 최신 항목이 `<h2 id="id-200470" ...>200470</h2>` 형태로, 문서 순서상 **내림차순(최신 먼저)** 렌더링됨. 첫 매치가 최신 APV. |
| 메인넷 매니페스트 | `https://raw.githubusercontent.com/planetarium/9c-infra/main/9c-main/network/{odin,heimdall,thor,general}.yaml` | 레포는 `planetarium/9c-infra`(설계 문서는 그냥 "`9c-main/network/*.yaml`"이라고만 적어 레포명이 없었음 — 후보로 `9c-k8s-config`도 검토했으나 404, `9c-infra`가 200). `appProtocolVersion: "200470/<hex>/<sig>/<b64 timestamp>"` 형식. `general.yaml`엔 이 키가 아예 없음(설계 문서 주장과 일치). |
| 인게임 공지판 | `https://assets.nine-chronicles.com/live-assets/Json/TextNotice{,_KR,_JP}.json` | `{ NoticeData: [{ Header: "v200450", Date, Contents }, ...] }`, 최신이 배열 맨 앞(index 0). |
| 공지판 git 원본 | `https://raw.githubusercontent.com/planetarium/NineChronicles.LiveAssets/main/Assets/Json/TextNotice{,_KR,_JP}.json` | `docs/9c-update-automation-self-check.md` 조사(GitHub 레포 존재 확인) 과정에서 발견 — `Event.json`과 달리 `TextNotice*.json`은 실제로 이 레포에 git 관리된다. CDN과 비교해 "PR 없이 직접 배포됐는지"를 잡는 보조 체크(`checkNoticeGitMatchesCdn`)에 사용. 2026-08-31 기준 CDN과 완전히 동일함을 확인. |
| 클라 빌드 버전(정보성) | `https://release.nine-chronicles.com/main/player/latest.json` | `{ version: 47000000011, timestamp, commit-hash, files }`. 설계 문서가 이미 언급한 URL, 그대로 확인됨. |

## 라이브로 재현된 실제 사고

이 세션(2026-08-30/31)에서 도구를 붙인 순간, 설계 문서가 "2026-07-21·08-25 2회 연속
미갱신"이라고 서술한 문제가 **그 조사 시점에 실제로 그 상태**임이 그대로 잡혔다(release-guard는
실행할 때마다 결과가 바뀌는 진단 도구이므로 이후 갱신됐을 수 있다 — 최신 상태는 직접 실행해 확인):

- 깃북 최신: `200470`
- odin.yaml / heimdall.yaml: `200470` (동기화됨)
- `TextNotice.json` / `_KR` / `_JP` 최상단 헤더: 셋 다 `v200450` (2차수 뒤처짐)

`bun run tools/9c/release-guard.ts`를 그냥 실행하면 이 상태가 `FATAL`로 뜬다 — 픽스처나
목(mock) 데이터가 아니라 2026-08-30/31 조사 시점의 실제 프로덕션 상태였다.

## 설계 문서에서 이번에 가져오지 않은 것 (의도적 축소)

- **`latest.json`의 `version` ↔ APV 인코딩 규칙** — 설계 문서 부록 C가 "관측 1건뿐, 규칙
  검증으로 보지 않는다"고 명시. `47000000011` ↔ `200470` 대응 관계를 추측해 규칙화하면
  근거 없는 게이트가 되므로, 이 값은 정보성으로만 표시하고 어떤 check에도 쓰지 않는다.
- **thor.yaml** — odin/heimdall과 릴리즈 주기가 달라 정기적으로 뒤처지는 게 정상 관측(설계
  문서 부록 C 표 참고, 2026-01-27 이후 갱신 없음이 사고가 아님). 게이트에서 제외하고
  정보성 항목으로만 표시.
- **Event.json 스냅샷/백업** — 위에서 설명한 대로 권한 미보유로 미착수.
- **깃북이 실제로 "정본"인지 자체의 확인** — 설계 문서 미확인 1: "깃북 릴리즈 노트가 노션
  문서에서 파생되는지, 사람이 깃북에 직접 쓰는지"가 미확인이라고 적혀 있음. 이 구현은
  설계 문서의 결정(깃북=기준)을 그대로 따를 뿐, 그 결정 자체를 검증하지 않는다.

## 아직 해소되지 않은 것

| 항목 | 상태 |
| --- | --- |
| Event.json 스냅샷/백업(설계 문서 부록 D) | 미착수 — S3 읽기 권한 + 백업 저장 위치(부록 D-1의 (a)/(d) 중 택) 결정 대기 |
| 24시간 유예 로그(`--log-file`)를 실제로 레포에 커밋해 "유일한 상태 소스"로 만드는 것 | 이 구현은 로컬 JSONL 파일에 append만 한다 — 설계 문서가 요구한 "레포 내 append-only 로그"로 만들려면 사람이 주기 실행마다 커밋해야 함(arena-settlement-check의 `--log-file`과 동일한 패턴) |
| 깃북이 실제로 정본인지(노션 파생 여부) | 미확인 — 설계 문서 미확인 1과 동일, 이번 조사로도 못 밝힘 |
| ~~`datasheet-*` 3종(밸런스 시트 파이프라인)~~ | ✅ 전제 정정(2026-08-31) — 밸런스 시트가 이미 무인증 공개 상태로 확인돼 권한 요청 ①이 철회됨(`docs/9c-update-automation-permission-request.md` ①). `datasheet-validate`는 부분 구현 완료(`spec-to-datasheet`/`datasheet-to-csv`는 아직 미착수) — 최신 상태는 `.claude/skills/datasheet-validate/SKILL.md` 참고 |
