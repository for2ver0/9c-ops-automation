# 정규 업데이트 자동화 — 자체 확인 조사 결과 (2026-08-30/31, 2026-09-01)

설계 문서("나인 크로니클 업데이트 자동화 설계") §5는 권한 승인 없이 담당자가 직접(또는
개발 세션이 직접) 답을 낼 수 있는 항목을 "자체 확인"·"조사해서 알아낼 것"으로 분리해뒀다.
이 문서는 그 항목들을 실제로 조사한 결과다 — 2026-08-30/31에 3건(②③⑨)을 조사했고(2건은
이 개발 환경의 권한 범위 밖이라 결론을 못 냄), 2026-09-01에 ⑥(깃북 작성 방식)을 추가로
조사해 공개 데이터만으로 결론을 냈다.

번호는 [권한 요청 문서](9c-update-automation-permission-request.md)와 마찬가지로 **설계
문서 원문 번호**를 그대로 쓴다(②③⑥⑨ — 초판은 이 문서 안에서만 통하는 ①②③으로 임의로 다시
매겨져 있었는데, 권한 요청 문서를 교정하면서 여기도 맞춰 고쳤다).

## 요약

| # | 항목 | 결과 | 확인 주체 |
| --- | --- | --- | --- |
| ② | 노션 페이지가 integration에 Connections로 공유됐는지 | **확인 불가** | 이 환경엔 `NOTION_TOKEN`이 전혀 없음 — Notion 접근 권한을 가진 사람이 직접 |
| ③ | `Atralupus/` 및 lib9c·LiveAssets·NineChronicles·9c-infra 레포 존재 | **확인함 — 갭 1건 발견** | 이 세션(공개 GitHub API, 자격증명 불필요) |
| ⑥ | 깃북 릴리즈 노트 작성 방식(에디터 직접 입력 vs Git Sync 저장소) | **확인함 — 에디터 직접 입력, GitHub 토큰 불필요로 판명** | 이 세션(깃북 공개 페이지에 내장된 메타데이터, 자격증명 불필요) |
| ⑨ | `Atralupus/lib9c`에 `GITHUB_FOCKED_REPO_WRITE_TOKEN`으로 push 가능한지 | **확인 불가** | 이 환경엔 해당 토큰이 없음 — 토큰 있는 환경에서 사람이 직접 |

## ② 노션 페이지 공유 — 확인 불가

`NOTION_TOKEN`, `GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_FOCKED_REPO_WRITE_TOKEN`, `GITHUB_PR_TOKEN`
전부 이 개발 환경에 설정돼 있지 않음(환경 변수 부재, `.env` 류 파일도 없음 — 2026-08-31 확인).
설계 문서가 전제한 "vault에 토큰이 있다"는 상황 자체가 이 세션엔 해당하지 않는다. 페이지가
`spec-to-datasheet`이 쓸 integration에 실제로 공유됐는지는 노션에 접근 가능한 사람이 직접
Connections 메뉴에서 확인해야 한다.

## ③ GitHub 레포 존재 — 확인함, 갭 1건

공개 GitHub API로 확인(인증 불필요):

| 레포 | 존재 | fork 부모 확인 |
| --- | --- | --- |
| `Atralupus/lib9c` | ✅ | `planetarium/lib9c`의 실제 fork |
| `Atralupus/NineChronicles` | ✅ | `planetarium/NineChronicles`의 실제 fork |
| `Atralupus/9c-infra` | ✅ | `planetarium/9c-infra`의 실제 fork |
| `Atralupus/LiveAssets` | ❌ | — (아래 참고) |

**갭**: 설계 문서는 이 레포를 "LiveAssets"라고 줄여 불렀지만 실제 정식 이름은
`planetarium/NineChronicles.LiveAssets`다(공개 레포, 확인됨). 그런데 **`Atralupus` 계정엔 이
레포의 fork가 아직 없다.** 조사 당시(2026-08-31)엔 `datasheet-to-csv` 2차 확장(L10n CSV
PR)이나 `release-notes`/`announce-fanout`이 여기 PR을 낼 걸로 예상해 준비 작업으로
적어뒀는데, **실제로 두 스킬을 만들어보니(2026-09-01) 둘 다 이 fork가 필요 없었다**:

- `release-notes`는 GitHub에 전혀 접근하지 않는다 — 릴리즈 노트는 깃북 에디터에서 직접
  작성되고 GitHub 레포는 편도 백업(export) 대상일 뿐이라는 게 확인됐다(⑥ 조사 결과 참고).
- `announce-fanout`은 `TextNotice*.json`을 CDN에서 읽기만 하고, 초안을 만들 뿐 어디에도
  PR을 내지 않는다(게시는 항상 사람).

그래서 지금 이 fork를 실제로 쓰는 곳은 `datasheet-to-csv`의 2차 확장(L10n CSV PR)뿐이고,
그 스킬 자체가 1차도 아직 미착수다. **지금 당장 막혀 있는 게 아니라 미래에 필요할 수 있는
준비 작업**으로 급을 낮춘다 — fork 생성 자체는 여전히 GitHub 쓰기 권한이 필요해 이 개발
환경에서 대신 실행할 수 없다(필요해지면 사람이 GitHub UI에서 클릭 한 번, Fork 버튼).

부수 확인(범위 밖이지만 교차검증에 유용): `NineChronicles.LiveAssets/Assets/Json`에
`TextNotice.json`/`_KR`/`_JP`, `Assets/Csv/RemoteCsv.csv`가 실제로 git 관리되고 있는 반면
**`Event.json`은 git에 없고 `Event-test.json`만 있다** — 설계 문서 부록 D의 "Event.json은
PR 없이 즉시 라이브, LiveAssets git엔 없음(raw 404)" 주장과 정확히 일치한다.

## ⑥ 깃북 작성 방식 — 확인함, Git Sync는 백업용 편도 export

`docs.nine-chronicles.com/introduction/intro/release-notes` 페이지(공개, 인증 불필요)의
HTML에 GitBook 자체가 내장한 메타데이터가 있다:

```json
"gitSync": {
  "installationId": "gitsync_RpkmU",
  "installationProvider": "github",
  "installationStatus": "active",
  "url": "https://github.com/planetarium/nine-chronicles-docs/tree/master",
  "repoName": "planetarium/nine-chronicles-docs",
  "operation": {
    "state": "success",
    "direction": "export",
    "startedAt": "2026-08-24T09:54:39.529Z",
    "endedAt": "2026-08-24T09:54:46.907Z"
  }
}
```

핵심은 `"direction":"export"`다 — 깃북이 GitHub 레포로 **내보내는(export)** 방향이지,
레포에서 깃북으로 **가져오는(import)** 방향이 아니다. 즉:

- **릴리즈 노트는 깃북 에디터에서 직접 작성된다** — 설계 문서가 "확인 안 됨"으로 남겨뒀던
  미확인 1("릴리즈 노트를 깃북에 직접 작성한다"는 추측)이 사실로 확인됐다.
- `planetarium/nine-chronicles-docs`(비공개 레포, API로 404 — 존재 자체는 이 메타데이터로
  간접 확인되지만 내용은 못 읽음)는 깃북 내용을 **자동으로 백업 export하는 대상일 뿐**,
  편집 소스가 아니다. 이 방향을 거슬러 GitHub PR로 릴리즈 노트를 반영하려는 접근은 다음
  export 때 깃북 쪽 내용으로 덮어써질 가능성이 높다 — 시도하면 안 된다.
- 같은 메타데이터 블록에 `"changeRequests":471`이라는 필드도 있다 — 깃북 자체에 내장된
  변경 요청(리뷰) 기능이 471건 누적돼 있다는 뜻으로, 검토도 깃북 안에서 이뤄지는 것으로
  보인다(GitHub PR 리뷰가 아니라).

**결론**: `release-notes` 스킬이 GitHub 토큰을 필요로 한다던 설계 문서의 전제는 틀렸다 —
최종 산출물은 "사람이 깃북 에디터에 붙여넣을 마크다운 텍스트"면 충분하고, GitHub 접근은
전혀 필요 없다. `announce-fanout`/`arena-announce`와 같은 "초안만 만들고 반영은 사람이 깃북
에디터에서" 패턴으로 바로 착수 가능하다 — 이제 남은 유일한 준비물은 실제 과거 릴리즈 노트의
형식(섹션 구성 등)을 분석해 초안 템플릿을 잡는 것뿐이다.

## ⑨ lib9c push 토큰 검증 — 확인 불가

`GITHUB_FOCKED_REPO_WRITE_TOKEN`(오타처럼 보이지만 실제로 그대로 굳어진 키 이름 —
`FORKED`가 아니라 `FOCKED`가 맞다. 나중에 "고치지" 말 것)이 이 환경에 없어 실제 push
테스트를 할 수 없다. ②와 같은 이유로, 토큰을 보유한 환경에서 사람이 빈 커밋 push 등으로
직접 검증해야 한다.

## 덤으로 확인한 것 — 부록 A-1 정밀 검증

자체 확인 3건은 아니지만, ③을 조사하던 김에 설계 문서 부록 A-1이 `datasheet-to-csv`를
"신규"가 아니라 "기존 도구 확장"으로 규정한 근거를 공개 GitHub 정보로 재확인했다:

| 주장 | 확인 결과 |
| --- | --- |
| `Lib9c/TableCSV` 파일 수: main 139개 / development 140개 | **정확히 일치** (공개 API로 재계산) |
| 차이는 `RestrictionSheet.csv` 1개, development 전용 | **일치** (main 404 / development 200) |
| 커밋 `b4685efed2`: "v200450 export tool corrupted 10 of 23 sheets... SkillBuffSheet 188 rows dropped" | **실존 확인, 메시지 내용도 일치** |
| 커밋 `8640286b70`: development 전용 신규 파일 커밋 | **실존 확인** |

즉 "이미 있는 구글시트→CSV 익스포트 도구가 실제로 사고를 낸 적이 있다"는 설계 문서의 전제는
근거가 있다 — `datasheet-to-csv`를 실제 착수할 때 "확장 vs 신규" 판단에 안심하고 쓸 수 있다.

## 다음에 할 일

- ③ 갭 — 급하지 않음으로 낮춤(2026-09-01 재확인). `datasheet-to-csv` 2차 확장(아직 1차도
  미착수) 착수 시점에 가서 `Atralupus`에 `NineChronicles.LiveAssets` fork 생성(사람,
  GitHub UI 클릭 1회)하면 됨 — 지금 만들어진 release-notes/announce-fanout은 필요 없음
- ② 노션 확인: Notion 접근 권한을 가진 사람이 Connections 메뉴에서 확인
- ⑥ 해소됨 — `release-notes` 착수 시 실제 과거 릴리즈 노트 형식을 분석해 초안 템플릿만
  잡으면 됨(권한/토큰 불필요)
- ⑨ lib9c push 검증: `GITHUB_FOCKED_REPO_WRITE_TOKEN`을 보유한 사람이 확인

②⑨는 서로 다른 자격증명(Notion vs GitHub)이라 **한 사람이 한 번에 처리된다는 보장이
없다**. 혼동하지 않도록 이 문서와 [권한 요청 문서](9c-update-automation-permission-request.md)
양쪽 다 이 둘을 분리해서 적어뒀다.

**참고**: 애초에 이 문서와 나란히 검토됐던 ①(밸런스 시트 접근)은 승인 요청 자체가
빠졌다 — `datasheet-validate`가 읽는 실제 작업 시트를 직접 열어보니 이미 무인증 공개
상태였다(권한 요청 문서 ① 항목 참고). 자체 확인 3건과는 별개의 발견이라 여기 남겨둔다.
