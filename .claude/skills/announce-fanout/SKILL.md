---
name: announce-fanout
description: 나인 크로니클 정규 업데이트의 인게임 공지(TextNotice EN/KR/JP) 내용을 디스코드 공지 초안으로 재포장하고, 언어별 버전 불일치·빈 본문·번역 누락 의심을 잡을 때 사용. "이번 업데이트 디스코드 공지 초안 만들어줘", "공지 언어별로 다른 거 없는지 확인해줘" 같은 요청에 사용. 인게임 공지판 CDN을 읽기만 하므로 권한 승인 없이 바로 실행 가능(release-guard와 동일 소스). ⚠️ 원래 설계 문서가 그리던 두 역할(9단계: 정규 업데이트 공지 변환 / 11단계: 휴장·이벤트 공지 초안) 중 이 스킬은 9단계만 구현한다 — 11단계의 원본인 Event.json은 S3 읽기 권한(⑧)이 아직 없어 범위 밖이다(아래 참고). 실제 디스코드 게시는 이 스킬의 범위 밖 — 초안까지만 만들고 게시는 사람이 직접 한다(arena-announce와 동일 패턴).
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
2. **§3 11단계 — 휴장(점검)·이벤트 공지 문구·일정·이미지 초안.** 이 초안의 원본은
   `Event.json`(Backoffice `/event-banner-manager`가 관리)인데, S3
   `9c-assets/live-assets/Json/Event.json` 읽기 권한(⑧)이 아직 승인 대기 중이다
   (`docs/9c-update-automation-permission-request.md` ⑧ 참고). **미착수** — 권한이 오면
   release-guard의 스냅샷 기능과 함께 붙인다.

### `arena-announce`와 다른 점 — 왜 "고정 템플릿"이 아닌가

`arena-announce`는 담당자가 실제로 과거에 게시한 디스코드 공지 3건을 통째로 받아, 바이트
단위로 재현되는 고정 템플릿을 만들었다(`arena-announce-template.ts` 모듈 doc, 심지어
숨은 문자(word joiner)까지 재현). 이 스킬은 **그런 실제 샘플을 아직 받지 못했다** — 정규
업데이트 디스코드 공지의 과거 게시물이 이번 착수에 제공되지 않았다.

실제 샘플 없이 "이런 형식일 것 같다"는 템플릿을 만드는 건 근거 없는 카피 발명이다. 그래서
이 스킬은 새 문구를 짓지 않는다 — **이미 검증·게시된 인게임 공지판의 내용을 그대로 가져와
디스코드에 올리기 좋은 형태로 재포장**할 뿐이다. 초안 맨 아래에 "검증된 고정 템플릿이
아니다, 채널의 과거 게시물과 비교해 다듬으라"는 경고를 항상 붙인다.

**나중에 실제 과거 정규 업데이트 디스코드 공지 샘플이 확보되면**, `arena-announce`와 같은
방식(문구 고정 + 조건부 문단 분리)으로 다시 만들 가치가 있다 — 지금은 그 재료가 없다.

## 도구 현황

| 도구 | 위치 | 역할 |
| --- | --- | --- |
| `announce-fanout.ts` | `tools/9c/announce-fanout.ts` (bun) | CLI 본체 |
| 로직 | `tools/9c/lib/announce-fanout.ts` | 순수 함수(유닛 테스트 대상) — `release-guard.ts`의 `fetchNoticeHead`/`checkNoticeFilesAgree`/`checkNoticeEmptyContents` 재사용 |
| 유닛 테스트 | `tools/9c/lib/announce-fanout.test.ts` | 초안 생성·언어별 길이 균형·불일치 검출, 네트워크 없이 실행 |
| 라이브 검증기 | `tools/9c/fixtures/verify-announce-fanout.ts` | 실제 공지판 CDN을 직접 찔러 확인 |

실행: `bun test tools/9c/lib/announce-fanout.test.ts` (유닛), `bun run tools/9c/fixtures/verify-announce-fanout.ts` (라이브).

## 1. 무엇을 하는가

1. **인게임 공지판(EN/KR/JP) 최상단 항목을 가져온다** — release-guard와 동일 함수 재사용.
2. **언어별 버전 일치 검사** — 세 언어의 헤더 APV가 다르면 WARN(release-guard의
   `checkNoticeFilesAgree` 재사용, 중복 구현 안 함).
3. **빈 본문 검사** — 언어별로 본문이 비어 있으면 FATAL(release-guard의
   `checkNoticeEmptyContents` 재사용).
4. **번역 누락 의심(신규)** — 가장 짧은 언어 본문이 가장 긴 언어 본문의 20% 미만이면 WARN.
   실제 번역 품질은 알 수 없으므로 이 정도의 거친 신호만 준다.
5. **디스코드 초안 조립** — 세 언어 본문을 그대로 옮겨 `[EN]`/`[KR]`/`[JP]` 섹션으로 나눈
   텍스트를 만든다. 본문이 비어 있으면 "(본문 없음 — 채우세요)"로 명시하지, 빈 칸을
   조용히 넘기지 않는다.

## 2. 실행

```bash
bun run tools/9c/announce-fanout.ts

# JSON으로
bun run tools/9c/announce-fanout.ts --json
```

FATAL(언어별 본문이 비어 있음)이 있으면 exit 1.

## 3. 판정 기준 요약

| 검사 | OK | WARN | FATAL |
| --- | --- | --- | --- |
| 언어별 공지 버전 일치 | 3개 언어 동일 APV | 불일치 | — |
| 언어별 본문 비어있음 | 본문 있음 | — | 비어있음 |
| 언어별 본문 길이 균형 | 최단/최장 비율 ≥ 20% | 최단이 최장의 20% 미만(번역 누락 의심) | — |

## 4. 범위 밖 (설계 문서 대비 의도적으로 뺀 것)

- **휴장(점검)·이벤트 공지 초안(11단계)** — `Event.json` S3 읽기 권한(⑧) 대기 중. 미착수.
- **실제 디스코드 게시** — 웹훅/봇 자체가 존재하지 않는다고 확인됨
  (`docs/9c-update-automation-permission-request.md` ⑤ 참고). 초안까지만 만들고, 게시는
  담당자가 `announcement` 채널에 직접 한다.
- **새 마케팅 문구 창작** — 위 "무엇이 왜 이렇게 됐는지" 참고. 실제 과거 샘플이 없어 시도하지
  않는다.
- **이미지 초안** — 텍스트만 다룬다. 이미지 제작/삽입은 범위 밖.

## 5. 다음에 할 일

| 항목 | 상태 | 필요한 것 |
| --- | --- | --- |
| 휴장/이벤트 공지 초안(11단계) | 미착수 | ⑧ S3 읽기 권한 승인 + release-guard의 Event.json 스냅샷 기능 |
| 실제 과거 디스코드 공지 샘플 확보 | 미착수 | 담당자가 정규 업데이트 공지 샘플 몇 건 제공 → arena-announce 수준 고정 템플릿으로 재작업 가능 |
| 이미지 초안 | 미착수 | 별도 검토 필요 |
