# 공지 문구 실측 샘플 (담당자 제공, 2026-08-30)

> `tools/9c/lib/arena-announce-template.ts`가 이 3건을 역공학해서 만들어졌다. 템플릿을 고칠 때는
> 이 원문을 다시 참고할 것 — 특히 메달 문단이 "고정 문구"가 아니라 "조건부, 그리고 문구 자체는
> 그 시점 이벤트에 종속적"이라는 점.

## 시즌 1 — Odin Season 39 / Heimdall Championship 9

```
Dear @everyone

New Seasons of Arena are just around the corner.
Check out the rewards from the links below.
Don't miss out on the Arena bonus rewards that come with the Season Pass!

For the time being, the medals required to participate in the Championship have been adjusted to 0
for adventurers newly exploring NineChronicles through Ragnarok Breaker — we look forward to your active participation!

⁠[Odin] Arena Season 39
⁠[Heimdall] Arena Championship 9
```

## 시즌 2 — Odin Championship 17 / Heimdall Season 23

```
Dear @everyone

New Seasons of Arena are just around the corner.
Check out the rewards from the links below.
Don't miss out on the Arena bonus rewards that come with the Season Pass!

For the time being, the medals required to participate in the Championship have been adjusted to 0
for adventurers newly exploring NineChronicles through Ragnarok Breaker — we look forward to your active participation!

⁠[Odin] Arena Championship 17
⁠[Heimdall] Arena Season 23
```

## 시즌 3 — Odin Season 38 / Heimdall Season 22

```
Dear @everyone

New Seasons of Arena are just around the corner.
Check out the rewards from the links below.
Don't miss out on the Arena bonus rewards that come with the Season Pass!

⁠[Odin] Arena Season 38
⁠[Heimdall] Arena Season 22
```

## 이 3건에서 확정된 것 (근거는 `arena-announce-template.ts` 모듈 doc comment)

- 첫 3줄(`Dear @everyone` ~ `Season Pass!`)은 3건 전부 완전히 동일 — 고정 템플릿.
- 공개 시즌 번호 = `seasonGroupId`. 6개(네트워크×시즌) 전부 정확히 일치 확인.
- 메달 문단은 조건부: 페어에 CHAMPIONSHIP이 있고 그 `requiredMedalCount == 0`일 때만 등장(시즌1·2).
  둘 다 SEASON인 시즌3엔 없음. 문구 자체가 "Ragnarok Breaker"라는 특정 과거 이벤트를 명시하므로,
  조건이 같다고 문구까지 그대로 재사용하면 안 됨 — 그래서 이 스킬은 자동 삽입하지 않고 참고용으로만
  보여준다.
- 링크 줄 형식: `⁠[네트워크] Arena {타입} {seasonGroupId}` — 대괄호 안 공백 없음, "Rewards" 접미사
  없음. 상금 표 PNG 제목(`[ 네트워크 ] Arena 타입 번호 Rewards`, 스펙 §7-2)과는 별개 형식.
- 링크가 가리키는 실제 URL은 `prize_detail_url`(DB 고정값, 디스코드 채널)과 다른 별도의 보상 상세
  페이지 — 자동 생성 불가, 사람이 채우는 슬롯.
- 오프시즌 공지는 0/3건 — 오프시즌은 아예 공지가 안 나감.
- 티켓 가격/구매 관련 문구는 0/3건에 등장. 담당자가 DB 타임스탬프로 확인: 전체 12개 티켓 정책
  row가 전부 `created_at == updated_at`(한 번도 수정 안 됨), 마지막 정책 교체가 2025-10-01(약
  11개월 전) — 최근 1년 가까이 가격 변경 이벤트 자체가 없어서 공지에 안 들어가는 게 자연스러움.
