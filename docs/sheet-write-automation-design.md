# 구글 시트 실제 입력 자동화 — 설계 결정 기록

## 1. 결론 요약

| 항목 | 내용 |
| --- | --- |
| **무엇을 결정했나** | `spec-to-datasheet`가 만든 작업 지시서 중 사람이 승인한 항목에 한해, `spec-to-datasheet-apply`가 실제로 구글 시트에 값을 쓰도록 범위를 넓힘 |
| **누가 요청했나** | 담당자 (2026-09-04) |
| **기존 원칙과의 관계** | `.claude/skills/spec-to-datasheet/SKILL.md` §5(및 `regular-update-prep/SKILL.md` ②단계, `README.md` §2.1 ②행)에 산발적으로 적혀 있던 "구글 시트 값 입력은 사람이 한다(D4)"에 대한 **명시적 예외**. `regular-update-prep/SKILL.md`·`regular-update.md`의 "핵심 제약(다른 무엇보다 우선)" 4개 항목(백오피스 업로드·Sign, 깃북 게시, 디스코드 게시, 메인넷 배포 실행)은 애초에 여기 시트 입력을 포함하지 않았으므로 **그대로 유지**된다 |
| **핵심 안전장치** | 이중 게이트(대화형 승인 + CLI `--apply` 플래그) + 재조회(로컬 CSV 폐기, 쓰기 직전 시트를 다시 읽어 재계산) + WARN·FATAL 항목 자동 반영 절대 금지 + 모든 성공 쓰기는 감사 로그 |
| **현재 상태** | 구현 완료(`tools/9c/spec-to-datasheet-apply.ts` + `tools/9c/lib/{a1-notation,google-sheets-auth,google-sheets-values,spec-to-datasheet-apply}.ts`, 유닛 테스트 34건). §4의 미해결 항목은 실제 회차에서 처음 쓰기 전 반드시 확인 |

> 이 문서는 `spec-to-datasheet`의 기존 SKILL.md를 대체하지 않는다. "시트에 값을 실제로 입력하는
> 것"에 한해 "사람이 한다"를 "사람이 승인하면 에이전트가 대행할 수 있다"로 바꾸는 addendum이다.
> 나머지 D4 보호 대상(백오피스 업로드, 깃북 게시, 디스코드 게시, 메인넷 배포)은 이번 변경과
> 무관하며 그대로 사람이 직접 한다. 이 문서의 골격은 같은 종류의 선례인
> `docs/arena-settlement-automation-design.md`(아레나 정산 실행을 사람 승인 하에 에이전트가
> 서명 요청까지 하도록 D4 예외를 연 결정 기록)를 따른다.

## 2. 배경

`spec-to-datasheet`은 원래 "무엇을 어떻게 바꿔야 하는지" 지시서까지만 만들고, 실제 시트 편집은
전부 사람이 구글 시트 UI에서 직접 했다. 담당자가 이 경계를 옮기고 싶어 해서(2026-09-04),
사용자와 아래를 확인했다:

1. 구글 시트 쓰기용 서비스 계정 자격증명이 이미 확보돼 있는가 → **이미 확보됨/확보 중**
2. 사람의 승인을 어떤 방식으로 요구할 것인가 → **이중 게이트**: (a) 에이전트가 지시서를
   사람에게 보여주고 대화형으로 명시적 확인을 받은 뒤 (b) `spec-to-datasheet-apply`를
   `--apply` 플래그와 함께 실행 — 플래그가 없으면 무조건 dry-run(API 호출 없음)이다
3. 이번 변경의 적용 범위 → **D4 원칙 자체를 예외 문서로 재검토하되, 기능 변경은 "구글 시트
   셀 입력" 한 곳에만 적용**한다. 백오피스 업로드·깃북 게시·디스코드 게시·메인넷 배포는 이번
   범위 밖이며 계속 사람이 직접 한다.

## 3. 확정된 아키텍처 원칙

- **키 보관 원칙은 `arena-settlement-automation-design.md`와 다르다.** 아레나 정산은 "서명
  전용 서비스(KMS/HSM) 경유, 에이전트는 개인키를 절대 보관하지 않는다"가 가능했지만, 구글
  서비스 계정에는 그런 별도 서명 서비스 개념이 없다 — **서비스 계정 키 파일 자체가 도구 실행
  환경에 존재한다는 것을 전제로 안전장치를 설계했다.** 그래서: 키 파일은 레포에 절대 커밋하지
  않고(`.gitignore`에 `*service-account*.json`/`*sa-key*.json` 방어 패턴 추가), CLI 플래그가
  아니라 `GOOGLE_SHEETS_SA_KEY_PATH` 환경변수로 실행할 때마다 사람이 직접 주입하며, 서비스
  계정은 대상 스프레드시트 한 곳에만 최소 권한(편집자)으로 공유해 블라스트 반경을 제한한다.
- **이중 게이트 — 사람 확인 없이는, `--apply` 없이는 아무 것도 안 쓴다.** 대화형 승인은
  `spec-to-datasheet-apply` 바깥(에이전트-사람 대화)에서 이뤄지고, CLI 자체는 `--apply`가
  없으면 기본적으로 dry-run이라 인증조차 시도하지 않는다.
- **재조회 원칙 — 로컬 CSV(gviz export)는 쓰기 판정에 쓰지 않는다.** gviz CSV export는 전부
  따옴표로 감싸고, 컬럼 타입을 추론해 안 맞는 값을 조용히 비우며, `headers=1` 유무로 행 수
  자체가 달라진다(`datasheet-validate` 실측). `--apply` 시점엔 항상 Sheets API로 그 순간의
  원본 값을 새로 읽어 작업 지시서를 재계산하고, 그 결과가 `FATAL`이면(컬럼 없음·계획 모순 —
  승인 이후 시트가 바뀌었을 가능성) 쓰기 0건으로 즉시 중단한다.
- **WARN·FATAL은 이 경로로도 절대 자동 반영되지 않는다.** 병합형 시트로 의심되는 중복 키,
  컬럼이 안 채워진 새 행은 사람이 시트 원본을 보고 직접 처리해야 한다 — `selectWriteTargets`가
  이 두 경우를 기계적으로 필터링해 "안전한 항목"(level OK인 CHANGE, gap 없는 NEW_ROW)만 쓴다.
- **모든 성공한 쓰기는 감사 로그(JSONL)로 남는다.** 셀 하나를 쓸 때마다 `{observedAt, sheet,
  id, column, before, after, range, planFile}`를 `--log-file`에 append한다. 새 행 삽입의
  `range`는 API 응답의 `updatedRange`를 그대로 쓴다(추정하지 않음 — append는 대상 위치를 API가
  정하므로 동시 편집 시 어디에 붙었는지 응답으로만 알 수 있다). 셀 변경은 `values.update`(PUT)가
  지정한 range에 결정적으로 쓰이므로 우리가 계산한 range를 그대로 기록한다.
- **부분 실패는 중단하지 않는다.** 쓰기 목록 중 하나가 API 에러로 실패해도 나머지 항목은 계속
  진행하고, 성공/실패 건수를 마지막 요약과 종료 코드(실패가 하나라도 있으면 1)로 보고한다 —
  한 항목의 실패로 이미 성공한 다른 쓰기까지 못 보고 남겨두는 쪽이 더 위험하다고 판단했다.

## 4. 미해결 항목 — 실제 회차에서 처음 쓰기 전 반드시 정해야 함

| 항목 | 필요한 결정 |
| --- | --- |
| 서비스 계정 스프레드시트 공유 여부 | 대상 밸런스 스프레드시트에 서비스 계정이 실제로 편집자로 공유됐는지 사전 확인(현재 gviz 무인증 읽기는 "링크가 있으면 접근 가능"일 뿐, 편집 권한과 무관 — `docs/9c-update-automation-permission-request.md` ①) |
| 키 보관 방식 | 로컬 파일 경로 주입으로 충분한지, 1Password 등에서 실행할 때마다 직접 값을 꺼내 임시 파일로 주입할지(S3 자격증명과 같은 D1 방식) |
| 대화형 승인 UX | 항목별 개별 승인인지 지시서 전체 일괄 승인인지, 승인자를 제한할지 |
| 감사 로그 저장 위치·보존기간 | `--log-file`은 로컬 파일뿐 — 중앙 집계나 장기 보존이 필요한지 |
| Sheets API 쿼터/배치 여부 | 기본 할당량(분당 요청 수) 안에서 대량 CHANGE를 낱개 `values.update`로 보내도 되는지, `values.batchUpdate`로 묶어야 하는지 |
| 동시 편집 충돌 | 재조회~쓰기 사이의 미세한 창에서 다른 사람이 같은 셀/행을 고치는 경우 대응 |
| 알림 채널 | 아레나 정산처럼 "실행 즉시 담당자 알림"이 필요한지 — 필요하면 어디로(디스코드는 자동 게시 경로 자체가 없음, `permission-request.md` ⑤) |
| 롤백 절차 | 잘못된 값을 썼을 때 되돌리는 절차 — 시트는 트랜잭션이 아니므로 사람이 감사 로그를 보고 직접 되돌려야 함 |
| 차등 접근 권한 | 지금은 단일 서비스 계정·단일 접근 모델로 시작 — 후속 설계로 미룸(아레나 정산과 동일 판단) |

2026-09-05 검증 기록 — 자격증명 없이 확인 가능한 범위는 따로 확인해뒀다. `signServiceAccountJwt`가
만든 JWT를 임시 RSA 키쌍으로 서명·검증해 (a) RS256 서명이 대응 공개키로 검증되고 (b) 클레임이
구글 서비스 계정 흐름과 일치함(`iss`=클라이언트 이메일, `aud`=`https://oauth2.googleapis.com/token`,
`scope` 그대로 전달, `exp`=`iat`+3600, base64url 패딩 없음)을 확인했다. 토큰 교환도 문서화된
형식(`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` + `assertion`)이고, 호출 URL
세 가지(`values/{range}` GET, 같은 경로 PUT + `valueInputOption`, `values/{range}:append` POST +
`insertDataOption=INSERT_ROWS`)도 Sheets API v4 형식과 일치한다. **다만 실제 인증된 쓰기는 아직
한 번도 실행된 적이 없다** — 위 표 첫 행(서비스 계정 편집자 공유)이 풀려야 처음 확인할 수 있고,
그때까지 "형식은 맞다"와 "실제로 써진다"는 다른 이야기로 남는다.

## 5. 관계 문서

- `.claude/skills/spec-to-datasheet/SKILL.md` §5 — 이 문서가 예외를 정의하는 원래 원칙
- `.claude/skills/regular-update-prep/SKILL.md` ②단계 — 오케스트레이션에서 이 예외가 어떻게 쓰이는지
- `docs/arena-settlement-automation-design.md` — D4 예외 문서의 골격이 된 선례
- `docs/9c-update-automation-permission-request.md` ① — 시트 "읽기"가 이미 무인증 공개임을 확인한 문서(쓰기 권한과는 무관)
- `tools/9c/lib/datasheet-validate.ts` — gviz CSV export의 실측 함정(재조회 원칙의 근거)
