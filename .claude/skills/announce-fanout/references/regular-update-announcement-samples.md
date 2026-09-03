# 정규 업데이트 릴리즈 공지 실측 샘플 (담당자 제공, 2026-09-03)

> `tools/9c/lib/regular-update-announce-template.ts`가 이 2건을 역공학해서 만들어졌다.
> `arena-announce-template.ts`(샘플 3건)보다 근거가 얇다 — "확정"이 아니라 "2건 관측"으로
> 읽을 것. 템플릿을 고칠 때는 이 원문을 다시 참고할 것.

## 샘플 1 — v200470 (2026-08-25)

```
Hi @everyone 👋
We will be releasing v200470 on August 25, 2026 at 11:00 AM (KST).
This update includes ncu menu develope and new adventureboss reward
You can check the full details here:
🔗 https://docs.nine-chronicles.com/introduction/intro/roadmap-and-completed/release-notes#v200470
```

## 샘플 2 — v200460 (2026-07-21)

```
Hi @everyone 👋
We will be releasing v200460 on July 21, 2026 at 11:00 AM (KST).
This update includes new event stages and new collections.
You can check the full details here:
🔗 https://docs.nine-chronicles.com/introduction/intro/roadmap-and-completed/release-notes#v200460
```

## 이 2건에서 확정된 것

- 1·4·5번째 줄("Hi @everyone 👋" / "You can check the full details here:" / 🔗 링크 줄)은
  2건 전부 구조가 동일 — 고정 템플릿.
- 2번째 줄 형식: `We will be releasing v{APV} on {Month D, YYYY} at {time} (KST).` — 변수는
  APV와 날짜뿐. **시각은 2건 다 "11:00 AM"** — 그런데 관측 2건뿐이라 이게 항상 고정인지,
  두 릴리즈가 우연히 같은 시각이었는지는 구분이 안 된다. 그래서 이 모듈은 "11:00 AM"을
  기본값으로 쓰되 호출자가 덮어쓸 수 있게 열어둔다.
- 3번째 줄(업데이트 요약 한 줄)은 사람이 그때그때 쓰는 자유 문구 — `arena-announce`의 메달
  문단과 같은 원칙으로, 이 모듈은 이 줄을 절대 자동 생성하지 않는다. 샘플 1에는 "develope"
  오타가 있는데(정상 철자는 develop), 이 문구는 항상 호출자가 직접 채우므로 재현 대상이 아니다.
- 링크 앵커(`#v{APV}`)는 2번째 줄의 APV와 같은 값 — 즉 버전 숫자를 두 번 따로 입력할 슬롯이
  없고 한 곳에서만 받는다(입력 하나로 두 곳에 쓰이므로 둘이 어긋나는 실수 자체가 구조적으로
  불가능).
- 링크 대상은 깃북 릴리즈 노트 페이지(`release-notes.ts` 스킬이 만드는 그 문서)의 버전 앵커 —
  아레나 공지의 "보상 상세 페이지"처럼 별도 URL을 사람이 채워야 하는 슬롯이 아니라, APV만
  있으면 기계적으로 조립 가능하다.

## 기존 announce-fanout(TextNotice 재포장) 접근과의 관계 — 중요

기존 `tools/9c/lib/announce-fanout.ts`의 `buildAnnouncementDraft`는 인게임 공지판
(`TextNotice{,_KR,_JP}.json`)의 EN/KR/JP 본문을 그대로 옮겨 담는 형태로 만들어져 있었다 —
그때는 "실제 과거 디스코드 공지 샘플이 없어서" 그게 최선의 근거 있는 선택이었다(SKILL.md
참고). 그런데 이번에 확보한 실제 샘플 2건은 그것과 전혀 다른 형태다: 3개 언어 본문을 통째로
옮기는 게 아니라, **버전 번호 + 날짜/시각 + 사람이 쓴 한 줄 요약 + 깃북 링크**뿐인 훨씬 짧은
글이다. 즉 실측 결과 실제 정규 업데이트 공지는 인게임 공지판 내용을 재포장한 게 아니었다.

그래서 두 함수는 서로 다른 걸 만드는 별개 도구로 유지한다 — `buildAnnouncementDraft`(기존,
`announce-fanout.ts`)는 TextNotice 원문을 언어별로 대사·확인하고 싶을 때, 이 문서가 뒷받침하는
새 템플릿(`regular-update-announce-template.ts`)은 실제로 디스코드에 올라갈 릴리즈 공지 초안이
필요할 때 쓴다. 기존 함수를 삭제하거나 이 템플릿으로 대체하지 않는다 — 용도가 다르다.
