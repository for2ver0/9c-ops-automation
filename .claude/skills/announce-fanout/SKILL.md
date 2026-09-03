---
name: announce-fanout
description: 나인 크로니클 정규 업데이트 디스코드 공지 초안을 만들 때 사용. 실제 릴리즈 공지(버전+날짜+한줄요약+깃북 링크)가 필요하면 `regular-update-announce-template.ts`(실측 샘플 2건에서 역공학한 고정 템플릿)를, 인게임 공지판(TextNotice EN/KR/JP) 내용 자체를 언어별로 대사·확인하고 싶으면 기존 `announce-fanout.ts`(버전 불일치·빈 본문·번역 누락 의심 검사)를 쓴다. "이번 업데이트 디스코드 공지 초안 만들어줘", "공지 언어별로 다른 거 없는지 확인해줘" 같은 요청에 사용. 인게임 공지판 CDN을 읽기만 하므로 권한 승인 없이 바로 실행 가능(release-guard와 동일 소스). ⚠️ 원래 설계 문서가 그리던 두 역할(9단계: 정규 업데이트 공지 변환 / 11단계: 휴장·이벤트 공지 초안) 중 이 스킬은 9단계만 구현한다 — 11단계는 Event.json을 읽는 것 자체는 이제 막혀 있지 않지만(공개 CDN으로 확인됨), 그 파일엔 배너 이미지명·링크 같은 메타데이터만 있고 초안화할 문구 자체가 없어 범위 밖이다(아래 참고). 실제 디스코드 게시는 이 스킬의 범위 밖 — 초안까지만 만들고 게시는 사람이 직접 한다(arena-announce와 동일 패턴).
---

# announce-fanout (부분 구현 — 정규 업데이트 공지 변환만, 휴장/이벤트 공지는 미착수)

> 이 스킬은 2026-09-01 세션에서 처음 SKILL.md로 작성됐다. 설계 문서("나인 크로니클
> 업데이트 자동화 설계" §3 9·11단계)가 announce-fanout에 요구한 것 중 **권한 없이 바로
> 착수 가능한 절반만** 구현했다. 왜 이렇게 됐는지, 그리고 `arena-announce`와 왜 접근이
> 다른지 먼저 읽을 것.

## 무엇이 왜 이렇게 됐는지

설계 문서는 이 스킬에 두 역할을 맡긴다.

1. **§3 9단계 — 정규 업데이트 릴리즈 → 디스코드 공지 변환.** 인게임 공지판
   (`TextNotice{,_KR,_JP}.json`)은 이미 인증 없는 공개 CDN이고, `release-guard`가 같은
   소스를 이미 검증하고 있다(`tools/9c/lib/release-guard.ts`의 `fetchNoticeHead`). **이번에
   만든 것.**
2. **§3 11단계 — 휴장(점검)·이벤트 공지 문구·일정·이미지 초안.** **미착수 — 그런데 막힌
   이유가 바뀌었다.** 원래는 "S3 읽기 권한(⑧)이 없어서"로 적어뒀는데, 2026-09-01에
   `Event.json`이 인증 없는 공개 CDN으로도 서빙된다는 게 확인돼(`release-guard`에 이미
   `fetchEventJsonSnapshot`으로 구현됨) 읽기 자체는 막혀 있지 않다. 대신 실제 내용을 열어
   보니 **초안화할 "문구"가 이 파일에 아예 없다** — `Event.json`은 `BannerImageName`·
   `Url`·`BeginDateTime`/`EndDateTime` 같은 배너 메타데이터일 뿐이고, `Description`
   필드도 `"savekey"`/`"monstercollection"` 같은 내부 식별자지 사람이 읽는 공지 문구가
   아니다. 즉 이 스킬이 재포장할 원문 자체가 없다 — TextNotice*.json(9단계가 쓰는 소스)과
   근본적으로 다른 종류의 데이터다. 진짜 "휴장 문구"가 어디서 작성되는지(별도 시스템?
   이미지 안에 텍스트로 들어감?)부터 다시 조사해야 한다.

### `arena-announce`와 다른 점 — 왜 처음엔 "고정 템플릿"이 아니었나 (2026-09-03 이후 절반 해소)

`arena-announce`는 담당자가 실제로 과거에 게시한 디스코드 공지 3건을 통째로 받아, 바이트
단위로 재현되는 고정 템플릿을 만들었다(`arena-announce-template.ts` 모듈 doc, 심지어
숨은 문자(word joiner)까지 재현). 이 스킬은 **처음엔 그런 실제 샘플을 받지 못해서** 새
문구를 짓는 대신 이미 검증·게시된 인게임 공지판 내용을 그대로 재포장하는 우회로를 택했다
(아래 `buildAnnouncementDraft`, `tools/9c/lib/announce-fanout.ts`).

**2026-09-03에 담당자가 실제 정규 업데이트 디스코드 공지 2건을 제공**했고, 그 내용은
예상과 달랐다 — 인게임 공지판 3개 언어 본문을 옮긴 게 아니라, **버전+날짜/시각+한 줄 요약
+깃북 링크**뿐인 훨씬 짧은 글이었다(실측 원문:
`references/regular-update-announcement-samples.md`). 그래서 `arena-announce`와 같은
방식(문구 고정 + 조건부 슬롯 분리)으로 새 모듈 `regular-update-announce-template.ts`를
추가했다 — 기존 `buildAnnouncementDraft`(TextNotice 재포장)를 대체하지 않는다. 용도가
다르다: 하나는 "실제로 디스코드에 올릴 릴리즈 공지 초안"이고, 다른 하나는 "인게임 공지판
3개 언어가 서로 어긋나지 않는지 대사하는 도구"다. 다만 샘플이 2건뿐이라 `arena-announce`
(3건, 전부 byte-identical 확인)보다 근거가 얇다 — 특히 "11:00 AM (KST)"가 항상 고정
시각인지, 이번 두 릴리즈가 우연히 같았는지는 아직 구분이 안 된다(모듈 doc 참고).

## 도구 현황

| 도구 | 위치 | 역할 |
| --- | --- | --- |
| `announce-fanout.ts` | `tools/9c/announce-fanout.ts` (bun) | CLI — 인게임 공지판(TextNotice) 언어별 대사 |
| 로직 | `tools/9c/lib/announce-fanout.ts` | 순수 함수(유닛 테스트 대상) — `release-guard.ts`의 `fetchNoticeHead`/`checkNoticeFilesAgree`/`checkNoticeEmptyContents` 재사용 |
| 유닛 테스트 | `tools/9c/lib/announce-fanout.test.ts` | 초안 생성·언어별 길이 균형·불일치 검출, 네트워크 없이 실행 |
| 라이브 검증기 | `tools/9c/fixtures/verify-announce-fanout.ts` | 실제 공지판 CDN을 직접 찔러 확인 |
| `regular-update-announce.ts` | `tools/9c/regular-update-announce.ts` (bun) | CLI — 실제 릴리즈 공지(버전/날짜/요약/링크) 초안, 실측 샘플 2건 기반 고정 템플릿 |
| 로직 | `tools/9c/lib/regular-update-announce-template.ts` | 순수 함수 — 요약 문구 존재·출시일 실재 여부·APV 양수·출시일 과거 여부·시각 관측치 이탈을 검사 |
| 유닛 테스트 | `tools/9c/lib/regular-update-announce-template.test.ts` | 실제 공지 2건 골든 텍스트 대조, 네트워크 없이 실행 |

실행: `bun test tools/9c/lib/announce-fanout.test.ts` / `bun test tools/9c/lib/regular-update-announce-template.test.ts` (유닛), `bun run tools/9c/fixtures/verify-announce-fanout.ts` (라이브).

### `regular-update-announce.ts` 실행 예시

```bash
bun run "$(git rev-parse --show-toplevel)/tools/9c/regular-update-announce.ts" \
  --apv 200480 --release-date 2026-09-22 \
  --summary "This update includes new arena rewards and bug fixes."
```

`--release-date`는 `YYYY-MM-DD`(KST 기준 달력 날짜). 시각은 생략 시 관측 기본값
`11:00 AM`을 쓰고, 다르면 `--release-time "3:00 PM"`처럼 덮어쓸 수 있다(그러면 WARN으로
"관측치와 다름"만 표시 — 틀렸다는 뜻은 아니다). 요약 문구가 비어 있으면 FATAL, 출시일이
오늘(KST)보다 과거면 WARN.

## 1. 무엇을 하는가

1. **인게임 공지판(EN/KR/JP) 최상단 항목을 가져온다** — release-guard와 동일 함수 재사용.
2. **언어별 버전 일치 검사** — 세 언어의 헤더 APV가 다르면 WARN(release-guard의
   `checkNoticeFilesAgree` 재사용, 중복 구현 안 함).
3. **빈 본문 검사** — 언어별로 본문이 비어 있으면 FATAL(release-guard의
   `checkNoticeEmptyContents` 재사용).
4. **번역 누락 의심(신규)** — 가장 짧은 언어 본문이 가장 긴 언어 본문의 20% 미만이면 WARN.
   ⚠️ **이 20%는 근거 없이 임의로 정한 값이다**(2026-09-03 점검에서 드러남). 관측치는 1건뿐 —
   2026-09-03 라이브 기준 EN 977자 / KR 518자 / JP 468자로 비율 0.479였다. 실제 번역 누락
   사례를 몇 건 모아 분포를 보기 전까지는 이 값을 신뢰하지 말 것: WARN이 떠도 "누락 확정"이
   아니고, 안 떠도 "누락 없음"이 아니다. 이 저장소는 다른 곳에서 근거 없는 임계값을 만들지
   않는다는 원칙을 지켜왔고(`datasheet-validate`), 임의로 정한 값은 공개해왔다
   (`arena-season-checklist`의 캐시 지연 100,000블록) — 이 검사만 그 공개가 빠져 있었다.
   실제 번역 품질은 알 수 없으므로 이 정도의 거친 신호만 준다.
5. **디스코드 초안 조립** — 세 언어 본문을 그대로 옮겨 `[EN]`/`[KR]`/`[JP]` 섹션으로 나눈
   텍스트를 만든다. 본문이 비어 있으면 "(본문 없음 — 채우세요)"로 명시하지, 빈 칸을
   조용히 넘기지 않는다.

## 2. 실행

```bash
bun run "$(git rev-parse --show-toplevel)/tools/9c/announce-fanout.ts"

# JSON으로
bun run "$(git rev-parse --show-toplevel)/tools/9c/announce-fanout.ts" --json
```

FATAL(언어별 본문이 비어 있음)이 있으면 exit 1.

## 3. 판정 기준 요약

| 검사 | OK | WARN | FATAL |
| --- | --- | --- | --- |
| 언어별 공지 버전 일치 | 3개 언어 동일 APV | 불일치 | — |
| 언어별 본문 비어있음 | 본문 있음 | — | 비어있음 |
| 언어별 본문 길이 균형 | 최단/최장 비율 ≥ 20% | 최단이 최장의 20% 미만(번역 누락 의심 — ⚠️ 임계값 20%는 임의, §1-4 참고) | — |

## 3-1. `regular-update-announce.ts` — 실제 릴리즈 공지 초안 (2026-09-03 추가)

`TextNotice` 재포장과 별개로, 실제 디스코드에 올릴 릴리즈 공지 초안이 필요하면 이 CLI를
쓴다. 실측 샘플 2건에서 역공학한 고정 템플릿(위 "`arena-announce`와 다른 점" 절 참고) —
버전·날짜/시각·요약·링크 4개 슬롯 중 요약만 사람이 채운다.

```bash
bun run "$(git rev-parse --show-toplevel)/tools/9c/regular-update-announce.ts" \
  --apv 200480 --release-date 2026-09-22 \
  --summary "This update includes new arena rewards and bug fixes."
```

| 검사 | OK | WARN | FATAL |
| --- | --- | --- | --- |
| 요약 문구 존재 | 채워짐 | — | 비어 있음(자동 생성 안 함) |
| 출시일이 실재하는 날짜 (2026-09-04) | 달력에 있는 날짜 | — | 없는 날짜(2026-02-30, 2026-13-01 등) |
| APV가 양의 정수 (2026-09-04) | 양의 정수 | — | 0·음수·소수 |
| 출시일이 과거가 아님(KST) | 오늘 이후 | 오늘보다 과거(오타·재사용 의심) | — |
| 출시 시각이 과거 관측치와 다름 | (해당 없음 — 아래 참고) | `--release-time`을 관측치 `11:00 AM`과 다른 값으로 명시(틀렸다는 뜻 아님, 확인만 요청) | — |

⚠️ 시각 검사는 **다를 때만 결과 목록에 실린다.** `--release-time`을 생략하거나 관측치와
같은 값을 주면 그 항목 자체가 나오지 않는다(실측). 표의 OK 칸을 "확인해서 정상"으로 읽지
말 것 — 확인한 게 아니라 실행되지 않은 것이다. 관측 샘플이 2건뿐이라 이 값을 게이트로 쓸
근거가 없어 이렇게 뒀다.

⚠️ **뒤늦은 "조용한 OK" 점검 (2026-09-04).** 이 도구는 커밋 `5ba2f61`이 "실행 도구가 있는
스킬 14개를 네 라운드에 걸쳐 모두 점검했다"고 선언한 **뒤에** `5cafb47`로 추가돼, 그 점검을
받지 않은 유일한 도구였다. 뒤늦게 같은 방식으로 찔러보니 3건이 나왔고 위 두 검사로 막았다:

- `--release-date 2026-02-30` → exit 0으로 **"March 2, 2026"** 초안 생성. `Date.UTC`가 범위를
  벗어난 값을 조용히 굴린다. `2026-09-31` → October 1, `2026-13-01` → **January 1, 2027**
  (해까지 바뀐다). @everyone 공지에 담당자가 친 날짜와 다른 날짜가 나가는 사고다.
- `--apv -5` → exit 0으로 `"We will be releasing v-5 on …"` 생성.
- 윤년은 실제 달력대로 판정한다(2028-02-29 통과, 2027-02-29 차단) — 회귀 테스트로 고정.

## 4. 범위 밖 (설계 문서 대비 의도적으로 뺀 것)

- **휴장(점검)·이벤트 공지 초안(11단계)** — 읽기 권한 문제가 아니다(2026-09-01 정정, 위
  "무엇이 왜 이렇게 됐는지" 참고). `Event.json`엔 초안화할 문구 자체가 없어 미착수.
- **실제 디스코드 게시** — 웹훅/봇 자체가 존재하지 않는다고 확인됨
  (`docs/9c-update-automation-permission-request.md` ⑤ 참고). 초안까지만 만들고, 게시는
  담당자가 `announcement` 채널에 직접 한다.
- **새 마케팅 문구 창작** — `regular-update-announce.ts`의 요약 한 줄도 항상 사람이 쓴다.
  실측 샘플 2건으로 확인된 건 "형식"이지 "문구를 대신 지어도 된다"가 아니다.
- **이미지 초안** — 텍스트만 다룬다. 이미지 제작/삽입은 범위 밖.

## 5. 다음에 할 일

| 항목 | 상태 | 필요한 것 |
| --- | --- | --- |
| 휴장/이벤트 공지 초안(11단계) | 미착수 | 진짜 "휴장 문구"가 어디서 작성되는지 조사 필요 — Event.json은 원문이 아님(위 참고) |
| 실제 과거 디스코드 공지 샘플 확보 | ✅ 2026-09-03 해소 — 담당자가 2건 제공, `regular-update-announce-template.ts`로 구현 | — |
| 릴리즈 공지 시각(`11:00 AM`)이 정말 고정 관행인지 | 미확정 — 관측 2건뿐 | 릴리즈가 몇 건 더 쌓이면 시각이 항상 같은지 재확인 |
| 이미지 초안 | 미착수 | 별도 검토 필요 |
