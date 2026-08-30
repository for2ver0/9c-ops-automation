# 정책 ID 검증 경로 조사 — 두 차례 독립 조사 비교 (2026-08-30)

> 스펙 문서 §8-2의 유일한 **설계 차단** 항목("정책 ID 검증 경로 유무")에 대한 조사 기록.
> 결론: **검증 경로가 없다.** 이 문서는 그 결론에 이른 두 차례 독립 조사와, 이 세션이 자체적으로
> 라이브 Swagger로 확인한 내용을 종합한다.

## 이 세션이 직접 확인한 것 (Swagger + 라이브 curl)

`odin-arena.9c.gg/swagger/v1/swagger.json` 전체를 훑었다:

- `SeasonResponse`가 `battleTicketPolicy`/`refreshTicketPolicy`를 embed하지만, 그 내용물
  (`TicketPolicyResponse`)엔 `defaultTicketsPerRound`/`maxPurchasableTicketsPerRound`/
  `purchasePrices` 3개 필드뿐이다. **`id`도 `name`도 없다.**
- 21개 전체 엔드포인트 경로 중 `/policies` 류의 독립 조회 엔드포인트가 없다.
- 전체 스키마 프로퍼티 이름을 `"olicy"`로 grep해도 `battleTicketPolicy`/`refreshTicketPolicy`
  (값 객체 자체) 두 개만 걸린다. ID/이름을 노출하는 필드가 어디에도 없다.

→ **공개 API로는 정책 ID를 이름으로 읽어 대조하는 게 원천적으로 불가능**하다는 걸 스키마 레벨에서
확인. (아래 사용자 조사 1)과 독립적으로 같은 결론에 도달함.

## 사용자의 조사 — 두 답변 비교

### 공통으로 확인된 것 (완전히 일치)

- 정책 이름/ID 6개 목록(케이싱 차이 포함 — heimdall만 대소문자 다름)이 두 답변에서 **글자 하나
  안 틀리고 일치**.
- odin 44개 시즌, heimdall 42개 시즌의 policy id별 매핑이 **완전히 동일**.
- `battle_ticket_policy_id == refresh_ticket_policy_id`가 전 시즌 예외 없이 성립.
- 답변2의 티켓 정책 수치(policy 6 = default 7 / 라운드최대 4 / 시즌최대 24)는 이 세션이 스킬 1
  개발 중 라이브로 직접 조회한 시즌 44(CHAMPIONSHIP) 값과 정확히 일치 — 교차검증됨.

### 차이 1 — 답변2에만 Thor 데이터가 있음

답변1은 odin·heimdall만 조사. 답변2는 thor(8시즌)까지 포함. Thor는 공개 아레나 API 자체가 없지만
(DNS 미해석, 이 세션에서 확인), **DB 레벨에는 시즌 데이터가 실제로 존재**한다 — "엔드포인트 없음"과
"데이터 없음"은 다른 문제였다.

### 차이 2 — "관습 파괴 사례"의 신뢰도 판단이 다름 (가장 중요)

- **답변1**: policy 1("[deprecated] Season")이 odin·heimdall 양쪽에서 SEASON+CHAMPIONSHIP에
  걸쳐 쓰였다는 걸 반례로 제시. 블록 폭은 확인하지 않음.
- **답변2**: 같은 사례를 발견했지만, odin s1·heimdall s1·thor s1이 전부 **블록 폭 1~2**라는 걸
  짚었다 — 시드/더미 row일 가능성이 높다는 뜻. 대신 **thor 시즌 2(블록 3~6802, 실제 운영 구간)에서
  policy 6 "new Championship"이 OFF_SEASON에 쓰인 사례**를 반례로 제시.

**판단**: 답변1의 "스모킹건"은 더미 데이터일 가능성이 있어 근거로 쓰기엔 약하다. 답변2가 찾은
thor s2(블록 폭이 있는 진짜 운영 시즌)가 훨씬 신뢰할 수 있는 반례다. → `arena-policy-fingerprint.ts`는
odin/heimdall/thor의 season id=1을 전부 "신뢰 가능한 관측"에서 제외하고, thor policy 6을
OFF_SEASON+CHAMPIONSHIP 혼재로 기록했다.

## 최종 설계 결론

1. "이름 → 타입" 추론은 코드가 보증하지 않는 **관습**일 뿐이고, 신뢰할 수 있는 반례(thor s2)가
   실측으로 확인됐다.
2. 판정 등급은 **경고(WARN)로 고정** — "가정 검증 후 확정(통과 시 치명)"이라는 스펙 문서 원안의
   조건부 문구는 폐기한다. 이 체크는 구조적으로 FATAL이 될 수 없다(검증할 정본 자체가 없으므로).
3. 현재(비-deprecated) 정책 4/5/6은 odin·heimdall에서는 교차 사용 없이 깨끗하다 — 이걸
   "타입별 알려진 ID 지문"으로 써서 화이트리스트 대조에 활용(`arena-policy-fingerprint.ts`).
   단, thor의 policy 6은 예외 — 혼재 이력이 있으므로 어떤 타입으로 넣어도 WARN.
4. 문구는 항상 관측 사실로만 표현한다 — "이 정책은 SEASON 전용이다"(X) /
   "지금까지 관측된 바로는 이 정책이 SEASON에서만 쓰였다"(O). `arena-policy-fingerprint.test.ts`의
   "never claims FATAL-grade certainty in its wording" 테스트가 `전용`/`반드시`/`무조건` 같은
   단정적 표현이 안 섞이는지 기계적으로 검사한다.
