---
name: datasheet-validate
description: Nine Chronicles 밸런스 구글 시트를 CSV로 내보낸 결과의 구조적 결함(중복 헤더, 빈 헤더, 행별 컬럼 수 불일치, 데이터 0행, 키 컬럼 공백, 키 값 중복, 행 수 급감)을 검증하고, `--baseline-csv`로 직전 회차 CSV를 넘기면 회차 간 diff(추가·삭제·변경 행/컬럼)까지 보여줄 때 사용. `--url`로 구글 시트를 직접 읽을 땐 gviz `headers=1` 누락(대량 행 유실)과 탭 이름 오타로 인한 기본 탭 폴백도 경고한다. "이 시트 검증해줘", "이 CSV 업로드해도 되는지 확인해줘", "지난 회차랑 뭐가 다른지 보여줘", "datasheet-validate 돌려줘" 같은 요청에 사용. 밸런스 시트는 무인증 공개 상태로 확인돼 승인 없이 바로 실행 가능하다(docs/9c-update-automation-permission-request.md ① 참고). ⚠️ 원래 설계 문서가 그리던 4가지 검증(시트 사전검증·시트 간 참조 ID·회차 diff·CSV 파싱부) 중 이 스킬은 시트 간 참조 ID 검증만 범위 밖이다 — lib9c 스키마 매핑이 선행돼야 해서다(아래 참고). 나머지 3가지(사전검증·회차 diff·CSV 파싱부)는 구현됐다.
---

# datasheet-validate (부분 구현 — 시트 간 참조 ID 검증만 남음)

> 이 스킬은 2026-09-01 세션에서 처음 SKILL.md로 작성됐고, 같은 날 회차 간 diff 기능이
> 추가됐다. 설계 문서("나인 크로니클 업데이트 자동화 설계" 부록 A-1)가 datasheet-validate에
> 요구한 네 가지 신규 검증 항목 중 **셋을 구현**했다. 왜 하나만 남았는지 먼저 읽을 것.

## 무엇이 왜 이렇게 됐는지

설계 문서 부록 A-1은 이 스킬이 새로 만들어야 할 항목을 넷으로 든다:

1. **구글 시트 단계 사전 검증** — 기존 Backoffice 검증은 CSV로 내보낸 *뒤*에만 동작하고
   그마저 게이트가 아니다. **구현됨** — CSV로 내보낸 결과를 업로드 전에 구조적으로
   검증한다(시트 자체를 읽는 것도 포함, 아래 "무엇을 하는가" 참고).
2. **시트 간 참조 ID 검증** — **미착수, 유일하게 남은 항목.** "이 컬럼 값이 다른 시트의
   Id로 실재하는가"를 검사하려면 lib9c의 각 `ISheet` 구현이 어떤 컬럼을 어떤 다른 시트의
   키로 참조하는지 시트별 매핑이 있어야 한다. 그 매핑을 만드는 일 자체가 별도 조사
   프로젝트라 이번 착수에 넣지 않았다.
3. **회차 간 시트 diff (N 대 N-1)** — **구현됨 (2026-09-01 추가).** 설계 문서의 미해결 B는
   `datasheet-to-csv`·`datasheet-validate`에 걸쳐 있는 두 하위 질문을 묶어놓은 항목이다 —
   (a) lib9c PR을 `main`/`development` 중 어디로 낼지("대상 브랜치·PR 타겟"), (b) 회차 diff
   비교 기준선을 lib9c 커밋/태그에서 가져올지 별도 스냅샷을 둘지. **이번에 답을 낸 건 (b)뿐이다**
   — (a)는 `datasheet-to-csv`가 착수될 때 결정할 문제로 여전히 열려 있다(아래 "5. 근거"·
   "6. 다음에 할 일" 참고). (b)에 대해 lib9c 공개 git 이력을 직접 조사해보니 태그(`v200220`에서
   멈춤)와 "latest-data" 브랜치(`v200390`에서 멈춤) 둘 다 지금 APV 범위(200450+)보다 훨씬
   전에 관리가 끊겼고, `development` 브랜치 커밋 메시지도 릴리즈 버전을 체계적으로 남기지
   않는다 — 즉 git 이력에서 N-1을 자동으로 가져올 방법이 없다는 뜻이다. 그래서 (b)는 "별도
   스냅샷"으로 답이 정해졌고, `--baseline-csv`로 사람이 직전 회차 CSV 파일을 직접 넘기게 했다
   (release-guard `--log-file`/deploy-prep `--snapshot-log`와 같은 패턴 — 새 권한 불필요).
4. **CSV 파싱부 신규** — **구현됨.** 기존 Backoffice `CsvValidationService`의 결함 4건
   (따옴표 안 쉼표 미처리, 빈 줄 제거로 인한 라인 번호 어긋남, 중복 헤더 무음 병합, quoting
   없는 재조립)을 그대로 재현하지 않는 RFC4180 파서와, 그 결함들이 놓쳤던 자리를 메우는
   구조적 검증을 만들었다.

즉 이번 착수는 **시트별 스키마 지식이 필요한 2번만** 남기고 나머지를 다 만들었다. 2번은
스키마 매핑이 오면 별도로 붙인다 — 코드 구조(`tools/9c/lib/datasheet-validate.ts`)에 함수를
추가하고 CLI에서 같이 호출하도록 확장하면 된다.

## 도구 현황

| 도구 | 위치 | 역할 |
| --- | --- | --- |
| `datasheet-validate.ts` | `tools/9c/datasheet-validate.ts` (bun) | CLI 본체 |
| CSV 파서 | `tools/9c/lib/csv.ts` | RFC4180 파서(순수 함수). `qa-checklist.ts`와 공유 — 순환 참조를 막기 위해 별도 모듈로 분리 |
| 검증 로직 | `tools/9c/lib/datasheet-validate.ts` | 순수 함수(유닛 테스트 대상). 회차 diff는 `qa-checklist.ts`의 `diffSheet` 재사용 |
| 유닛 테스트 | `tools/9c/lib/datasheet-validate.test.ts` | 파서·검증 로직 + v200450 실패 모드 3종 회귀 케이스 + 회차 diff 케이스 + 2026-09-03 "조용한 OK" 점검 회귀(0행·중복 키·빈 헤더·탭 폴백·gviz headers), 네트워크 없이 실행 |
| 라이브 검증기 | `tools/9c/fixtures/verify-datasheet-validate.ts` | 실제 공개 밸런스 시트 CSV export를 직접 찔러 확인 + 회차 diff 라운드트립 |

실행: `bun test tools/9c/lib/datasheet-validate.test.ts` (유닛), `bun run tools/9c/fixtures/verify-datasheet-validate.ts` (라이브).

## 1. 무엇을 하는가

밸런스 구글 시트를 CSV로 내보낸 결과(로컬 파일 또는 공개 export URL)에 대해 아홉 가지
검증을 돌린다. 전부 **시트가 어떤 스키마인지 몰라도** 적용 가능한, 형식 자체의 결함이다.
(1-5는 2026-09-01 착수분, 6-9는 2026-09-03에 "조용한 OK" 점검으로 추가된 것 — §7 참고.)

1. **헤더 중복** — 같은 헤더 이름이 두 번 이상 나오면 FATAL. Backoffice의 기존 파서는
   `row[headers[j]]`로 Dictionary 키를 헤더 이름으로 써서 중복 헤더의 값을 무음으로 덮어쓴다
   (실측 사례: `worldboss_info.csv`의 `Vietnam` 중복, 부록 A-2) — 컬럼 하나가 통째로
   소실돼도 아무 에러가 안 뜬다. **이름이 빈 헤더는 여기서 세지 않는다**(2026-09-03) — 6번
   참고.
2. **행별 컬럼 수 불일치** — 헤더 칸 수와 다른 행이 있으면 FATAL. 이 스킬의 파서는 RFC4180을
   따라 따옴표 안 쉼표를 값으로 흡수하므로, 여기서 잡히는 불일치는 진짜 데이터 결함이지
   Backoffice의 `lines[i].Split(',')`가 내던 오탐(부록 A-1, `WorldBossActionPatternSheet.csv`
   같은 정상 CSV를 컬럼 수 불일치로 잘못 잡던 문제)이 아니다.
3. **키 컬럼 공백** — 지정한 키 컬럼(`--key-column`, 보통 `Id`)이 비어 있는 행이 있으면
   FATAL. v200450 실패 모드 중 "key 컬럼 비움 → `ArgumentException`"을 업로드 전에 미리
   잡는다. 키 컬럼을 지정하지 않았거나 헤더에 없으면 건너뛰고 WARN — 강제하지 않는다
   (시트마다 키 컬럼 이름이 다를 수 있음).
4. **행 수 급감** — `--baseline-rows`(또는 `--baseline-csv`에서 자동으로 뽑은 행 수)로 직전
   행 수를 넘기면, 이번 행 수가 그보다 줄었을 때 FATAL. v200450에서 `SkillBuffSheet` 188행이
   익스포트 과정에서 통째로 유실된 실패 모드를 사후 대조로 잡는다. 증가는 정상(패치로 항목
   추가)이라 통과. 기준값이 없으면(첫 실행) 비교 없이 정보성으로만 현재 행 수를 알려준다.
5. **회차 간 diff (N 대 N-1)** — `--baseline-csv`로 직전 회차 CSV 전체를 넘기면, 키 컬럼
   기준으로 추가·삭제·변경된 행과 컬럼 수를 계산해 보여준다(`qa-checklist.ts`의 `diffSheet`
   재사용). **diff 결과 자체에는 임계값 게이트가 없다** — 계산이 됐다면 아무리 많이
   바뀌어도 항상 OK로만 표시한다. "몇 % 이상 바뀌면 이상하다" 같은 규칙은 근거 없이 지어낸
   게이트가 되므로 만들지 않았다. 사람이 이 요약을 보고 "이번 회차에 의도한 만큼만
   바뀌었는지" 스스로 판단한다. (키 컬럼 미지정, 또는 키 컬럼이 한쪽 파일에 없어 계산
   자체가 안 되는 경우는 별개로 WARN — 이건 diff 결과에 대한 판단이 아니라 입력 부족을
   알리는 것이다.) baseline이 없으면(첫 실행) 비교를 건너뛴다(OK, 정보성).
6. **빈 헤더** (2026-09-03) — 이름 없는 열의 데이터가 전부 비어 있으면 WARN(구글이 데이터
   범위 밖 열까지 내보낸 아티팩트 — 실측: `MaterialItemSheet` 26칸 중 21칸), 값이 들어
   있으면 FATAL(업로드 시 이름 없는 열들이 한 키로 뭉개져 소실). 이걸 1번에서 분리하기
   전에는 정상 시트가 매번 "헤더 중복" FATAL로 떠서, 진짜 FATAL을 무시하게 만들었다.
7. **데이터 행 존재** (2026-09-03) — 헤더만 있고 0행이면 FATAL. 익스포트 실패의 전형인데,
   기준값 없이 첫 실행하면 나머지 검사를 전부 통과해 exit 0으로 끝나던 자리다.
8. **키 값 중복** (2026-09-03) — 같은 키 값이 두 번 이상 나오면 **WARN**. 행 수는 그대로라
   4번(행 수 급감)으로도, 1번(헤더 중복)으로도 안 걸리던 자리다.
   ⚠️ **FATAL이 아닌 이유** — 처음엔 "업로드 시 뒤 행이 앞 행을 무음으로 덮어쓴다"고 보고
   FATAL로 만들었는데, `planetarium/lib9c` 원본을 직접 읽어보니 **그 전제가 틀렸다**
   (2026-09-03 실측):
   - `Sheet<TKey,TValue>.AddRow`의 기본 구현은 `((IDictionary)_impl).Add(key, value)`라
     덮어쓰기가 아니라 **중복 키에 `ArgumentException`을 던진다**(`Set()`이 try로 감싸지도
     않는다). 즉 무음 사고가 아니라 로드 실패로 드러난다.
   - 그리고 **27개 시트가 `AddRow`를 오버라이드하는데 그중 25개가 "병합형"**이다 —
     `TryGetValue`로 기존 행을 찾아 리스트에 덧붙인다. `ArenaSheet`(한 시즌 = 여러 라운드
     행), `EventDungeonStageWaveSheet`(한 스테이지 = 여러 웨이브 행), `SkillBuffSheet`,
     `StageWaveSheet`, `RuneOptionSheet` 등에선 **중복 Id가 설계된 정상 형식**이다.

   어느 쪽인지는 시트 종류를 알아야 갈리는데 그 매핑은 이 스킬 범위 밖(§4)이라, WARN으로
   알리고 사람이 판단하게 한다.
9. **gviz headers 파라미터 / 요청한 탭 확인** (2026-09-03, `--url` 모드 전용) — URL에
   `headers=`가 없으면 WARN(대량 행 유실 위험), `sheet=`가 붙은 요청의 응답이 `sheet=`를 뺀
   기본 탭 응답과 같으면 WARN(탭 이름 오타 의심). 둘 다 §2의 ⚠️ 항목 참고.

## 2. 실행

```bash
# 로컬 CSV 파일 검증
bun run "$(git rev-parse --show-toplevel)/tools/9c/datasheet-validate.ts" --csv ./MaterialItemSheet.csv --key-column Id

# 구글 시트 CSV export URL 직접 검증 (공개 시트만 — 인증 불필요)
bun run "$(git rev-parse --show-toplevel)/tools/9c/datasheet-validate.ts" --url "https://docs.google.com/spreadsheets/d/1Di903g3_mxdDd6gZuNhczE4MXwFI-lWnOqzuVPbGM7k/gviz/tq?tqx=out:csv&sheet=MaterialItemSheet&headers=1" --key-column id --sheet-name MaterialItemSheet

# 직전 실행의 행 수만 기준값으로 넘겨 급감 검출 (전체 CSV를 안 남겨뒀을 때)
bun run "$(git rev-parse --show-toplevel)/tools/9c/datasheet-validate.ts" --csv ./MaterialItemSheet.csv --key-column Id --baseline-rows 421

# 직전 회차 CSV 전체를 넘겨 회차 간 diff까지 확인 (행 수 급감 검사도 여기서 자동으로 값을 뽑아 씀)
bun run "$(git rev-parse --show-toplevel)/tools/9c/datasheet-validate.ts" --csv ./MaterialItemSheet.csv --key-column Id --baseline-csv ./MaterialItemSheet.prev.csv

# JSON으로
bun run "$(git rev-parse --show-toplevel)/tools/9c/datasheet-validate.ts" --csv ./MaterialItemSheet.csv --json
```

FATAL이 하나라도 있으면 exit 1. 시트 탭마다(=lib9c TableCSV 파일마다) 따로 실행한다 — 이 CLI는
한 번에 한 CSV/탭만 본다. 회차마다 이번 실행의 CSV를 잘 보관해뒀다가 다음 실행 때
`--baseline-csv`로 넘기는 건 사람의 몫이다 — 이 스킬은 저장소를 만들지 않는다.

**시트 export URL 만드는 법** — 구글 시트 gviz 엔드포인트로 특정 탭만 CSV로 받는다:
`https://docs.google.com/spreadsheets/d/<시트ID>/gviz/tq?tqx=out:csv&sheet=<탭이름>&headers=1`.
밸런스 시트 ID(`docs/9c-update-automation-permission-request.md` ① 항목 참고)는
`1Di903g3_mxdDd6gZuNhczE4MXwFI-lWnOqzuVPbGM7k` — 2026-08-31 확인 기준 무인증 공개.

⚠️ **`&headers=1`을 반드시 붙일 것** (2026-09-03 실측으로 추가). 없으면 구글이 헤더 행 수를
**추측**하는데, 실패하면 데이터 행들을 헤더 한 줄로 접어버린다 — 실제 밸런스 시트
`CollectionSheet`가 `headers=1` 없이는 **13행**(첫 헤더가 `"id 1 2 3 4 …"`로 수백 개 id가
이어붙은 한 셀), 붙이면 **895행**으로 나온다. **882행이 조용히 사라진 CSV를 검증하게 되는
것**이고, 행 수가 0은 아니라 `데이터 행 존재` 검사로도 안 걸린다. 이 문서가 2026-09-03
이전에 안내하던 URL 패턴엔 이 파라미터가 빠져 있었으므로, **그 전에 URL 모드로 돌린 검증
결과는 탭에 따라 무의미할 수 있다.** 지금은 URL에 `headers=`가 없으면 스킬이 WARN을 낸다.

⚠️ **탭 이름 오타 주의** — 없는 탭 이름을 줘도 구글은 404가 아니라 **첫 번째 탭**을 200으로
돌려준다(2026-09-03 실측: 탭 미지정/없는 탭 A/없는 탭 B의 응답 md5가 동일). 그래서 오타가
나면 엉뚱한 시트를 검증하고 통과할 수 있다. 이 스킬은 `sheet=`가 붙은 URL이면 `sheet=`를 뺀
응답과 대조해, 내용이 같으면 WARN으로 알려준다(정말 첫 탭이 대상이면 무시해도 된다).

## 3. 판정 기준 요약

| 검사 | OK | WARN | FATAL |
| --- | --- | --- | --- |
| 헤더 중복 | 없음 | — | **이름 있는** 헤더가 중복 (빈 헤더는 아래 별도 검사로 분리, 2026-09-03) |
| 빈 헤더 | 없음 | 이름 없는 열이 있으나 그 열 데이터도 전부 비어 있음(구글 export 아티팩트) | 이름 없는 열에 **값이 들어있음** — 업로드 시 한 키로 뭉개져 소실 |
| 데이터 행 존재 | 1행 이상 | — | 헤더만 있고 0행(익스포트 실패 전형) |
| 키 값 중복 | 키 값이 전부 고유 | 같은 키 값이 2번 이상(병합형 시트면 정상, 아니면 로드 실패 — 아래 8번), 또는 키 컬럼 미지정/헤더에 없음(건너뜀) | — (시트 종류를 알아야 갈려서 FATAL로 단정하지 않음) |
| gviz headers 파라미터 | `headers=` 지정됨/URL 아님 | gviz URL인데 `headers=`가 없음(대량 행 유실 위험) | — |
| 요청한 탭 확인 | 기본 탭과 다른 내용 반환/해당 없음 | 기본 탭 응답과 동일(탭 이름 오타 의심), 또는 대조 실패 | — |
| 행별 컬럼 수 | 전부 일치 | — | 헤더와 칸 수 다른 행 존재 |
| 키 컬럼 공백 | 전부 채워짐 | 키 컬럼 미지정 또는 헤더에 없음(검사 건너뜀) | 빈 값 존재 |
| 행 수 급감 | 기준값 이상 유지/증가, 또는 기준값 없음(정보성) | — | 기준값보다 감소 |
| 회차 간 diff | 계산 성공(요약 표시), 또는 기준 CSV 없음(비교 건너뜀) | 키 컬럼 미지정, 또는 키 컬럼이 한쪽 파일 헤더에 없어 계산 실패 | — (diff 결과 자체에는 임계값 게이트 없음) |

## 4. 범위 밖 (설계 문서 대비 의도적으로 뺀 것)

- **시트 간 참조 ID 검증** — lib9c 스키마별 참조 규칙 매핑이 선행돼야 함. 미착수, 유일하게
  남은 항목.
- **타입 검증** (숫자 컬럼에 문자열이 들어갔는지 등) — 컬럼별 타입은 시트마다 다르고 lib9c
  스키마 지식이 필요해 미착수.
- **"너무 많이 바뀜" 게이트** — diff 계산이 안 되는 경우(키 컬럼 없음·계산 실패)는 WARN을
  내지만, diff가 실제로 계산됐을 때는 그 내용(얼마나 많이 바뀌었는지)에 임계값을 걸어
  WARN/FATAL로 올리지 않는다 — 근거 없이 지어낸 규칙이 되므로 만들지 않았다.
- **baseline CSV 자동 보관** — `--baseline-csv`는 사람이 파일을 직접 들고 있다가 넘기는
  구조다. "이번 실행 결과를 자동으로 다음 실행의 기준으로 저장"하는 저장소는 없다.
- **`/table-patch` 업로드·Sign 자체를 막는 것** — D4 원칙(자동화는 라이브를 바꾸는 호출을
  하지 않는다)에 따라 이 스킬은 읽기·검증만 한다. FATAL이 뜨면 "업로드 전에 다시 확인하라"고
  알려줄 뿐, Sign 버튼을 대신 막지 않는다(설계 문서 미해결 A와 동일한 이유 — Backoffice의
  기존 검증도 게이트가 아니라 경고 표시 전용이라 이 스킬의 판정도 마찬가지 위치에 있다).
- **`spec-to-datasheet`가 제안한 값 자체가 맞는지** — "형식은 맞는데 값이 틀린" 경우는 이
  스킬이 볼 수 있는 범위가 아니다. 설계 문서가 이 구간의 유일한 검출 지점으로 지목한 건
  사람의 QA 체크리스트다(2.1절).

## 5. 근거

- `docs/9c-update-automation-permission-request.md` ① — 밸런스 시트가 무인증 공개 상태임을
  실측으로 확인한 기록. 서비스 계정 공유 요청 자체가 철회됨.
- 설계 문서 부록 A-1 — Backoffice `CsvValidationService`의 결함 4건과 v200450 실패 모드 3종
  (헤더 뭉개짐, key 컬럼 비움, `SkillBuffSheet` 188행 유실)의 근거.
- 2026-09-01 lib9c 공개 git 이력 조사(`git ls-remote --tags`/`--heads`, GitHub commits 페이지) —
  태그·"latest-data" 브랜치가 지금 APV 범위보다 훨씬 전에 관리가 끊겼고 `development` 브랜치
  커밋 메시지도 릴리즈 버전을 체계적으로 남기지 않는다는 것을 확인, 미해결 B의 두 하위
  질문 중 회차 diff 기준선 쪽을 "별도 스냅샷"으로 판단한 근거. (대상 브랜치·PR 타겟 쪽은
  이 조사로 답이 나오지 않았다 — 여전히 열려 있음, 아래 참고.)
- **2026-09-03 "조용한 OK" 점검** — 이 스킬을 실제 실패 모드 입력으로 직접 찔러본 기록.
  유닛 테스트와 타입 체크를 전부 통과하는데도 조용히 OK를 내던 자리 4곳(0행 CSV, 중복 키
  값, gviz `headers=1` 누락, 탭 이름 오타 폴백)과, 반대로 정상 시트에 오탐 FATAL을 내던
  자리 1곳(빈 헤더를 "중복 헤더"로 계수)을 찾아 6-9번 검사로 고쳤다. 실측 근거:
  - 실제 밸런스 시트 `CollectionSheet` — `headers=1` 없이 13행 / 붙이면 895행(**882행 유실**).
  - 탭 미지정 / 없는 탭 A / 없는 탭 B 세 요청의 응답 md5가 동일 → 구글은 없는 탭에 404가
    아니라 첫 탭을 200으로 돌려준다.
  - `MaterialItemSheet` — 26칸 중 21칸이 빈 헤더이고 330행 전부 비어 있음(순수 export
    아티팩트). 이걸 중복으로 세던 탓에 정상 시트가 매번 FATAL로 떴다.

## 6. 다음에 할 일

| 항목 | 상태 | 필요한 것 |
| --- | --- | --- |
| 시트 간 참조 ID 검증 | 미착수 | lib9c 시트별 참조 규칙 매핑 (별도 조사) |
| 컬럼 타입 검증 | 미착수 | 시트별 컬럼 타입 정의 (별도 조사) |
| 미해결 B — 대상 브랜치·PR 타겟(main 대 development) | 미결정 — 이번 조사는 회차 diff 기준선만 답함 | `datasheet-to-csv` 착수 시 함께 결정 |
| `spec-to-datasheet` | 착수됨(2026-09-03) — 별도 스킬 | 노션 없이 구현됨(기획서를 사람이 직접 전달하는 전제). `.claude/skills/spec-to-datasheet/SKILL.md` 참고 |
| 2026-09-03 이전에 URL 모드로 돌린 검증 결과 | **신뢰할 수 없음** | 그때 안내하던 URL 패턴에 `headers=1`이 없어, 탭에 따라 대부분의 행이 빠진 CSV를 검증했을 수 있다. 필요하면 `&headers=1`을 붙여 다시 돌릴 것 |
| 탭 이름 폴백 검출의 오탐 | 알려진 한계 | 정말 첫 번째 탭을 대상으로 삼으면 WARN이 뜬다(무시해도 됨). 응답만으로 "어느 탭인지" 알 방법이 없어 더 정확하게는 못 만든다 |
| 헤더가 뭉개진 CSV를 파일(`--csv`)로 받았을 때 | 미착수 | URL이 없으면 `headers=1` 여부를 알 수 없다. "헤더 셀이 비정상적으로 긴" 같은 임계값은 근거 없이 지어낸 규칙이 되므로 만들지 않았다 |
