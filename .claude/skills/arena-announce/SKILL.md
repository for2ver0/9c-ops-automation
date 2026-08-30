---
name: arena-announce
description: Nine Chronicles 아레나 시즌 시작 디스코드 공지 초안을 만들 때 사용. Odin+Heimdall 시즌 페어(seasonGroupId·arenaType)를 입력하면 실제 공지 3건에서 역공학한 고정 템플릿으로 초안을 만들고, 등록 시 실수(seasonGroupId=0으로 "Season 0"이 찍히는 등)를 FATAL로, 메달 조정 문단이 필요할 수 있는 상황을 WARN으로 잡는다. "이번 시즌 공지 초안 만들어줘" 같은 요청에 사용. 실제 디스코드 전송은 이 스킬의 범위 밖 — 초안까지만 만들고 게시는 사람이 직접 한다.
---

# 아레나 시즌 공지 초안

> 이 스킬은 2026-08-30 세션에서 처음 SKILL.md로 작성됐다. 5개 스킬 중 3순위. 담당자가 제공한 실제
> 공지 3건을 역공학해서 템플릿을 확정했다 — 원문은 `references/announcement-samples.md`.

## 도구 현황

| 도구 | 위치 | 역할 |
| --- | --- | --- |
| `arena-announce.ts` | `tools/9c/arena-announce.ts` (bun) | CLI 본체 |
| `arena-announce-template.ts` | `tools/9c/lib/arena-announce-template.ts` | 순수 템플릿 생성 + 대사 로직 |
| 유닛 테스트 | `tools/9c/lib/arena-announce-template.test.ts` | 실제 공지 3건 골든 텍스트 대조 |

실행: `bun test tools/9c/lib/arena-announce-template.test.ts` (13 pass).

---

## 한눈에 보기 (TL;DR)

- **무엇을 하는 스킬인가**: Odin 시즌 하나 + Heimdall 시즌 하나(페어)를 지정하면, 실제 과거 공지
  3건에서 확정된 고정 템플릿으로 초안을 만들고, 등록 데이터의 이상(번호 누락, 메달 조정 필요 여부,
  페어 시작 시각이 너무 떨어져 있는지)을 대사해서 보여준다.
- **핵심 원칙**: 문구는 절대 마음대로 지어내지 않는다 — 실제 샘플 3건에서 **바이트 단위로 동일했던
  부분만** 고정 템플릿으로 쓰고, 나머지(메달 문단)는 조건만 검출하고 문구는 사람이 채운다.
- **꼭 알아야 할 핵심 사실 5가지**:
    1. 공개 시즌 번호 = `seasonGroupId`. 실측 6쌍(네트워크×시즌) 전부 정확히 일치.
    2. **메달 조정 문단은 고정 문구가 아니다.** 조건(챔피언십 있음 + `requiredMedalCount==0`)은
       확정됐지만, 문구 자체가 "Ragnarok Breaker"라는 특정 과거 이벤트를 명시한다 — 조건이 같다고
       다음에도 그대로 쓰면 엉뚱한 이유를 재사용하는 사고가 난다. **그래서 자동 삽입하지 않고
       참고용으로만 보여준다.**
    3. **`seasonGroupId == 0`은 FATAL이다.** 오프시즌이 아닌데 0이면 등록 시 번호 누락 — 실제로
       2026-08-30에 heimdall sid=42(진행 중인 SEASON)에서 발견됐다. 그대로 뒀으면 "Season 0"이
       공개 공지로 나갈 뻔했다.
    4. 오프시즌은 공지 대상이 아니다(실측 3/3건 확인). `--*-arena-type OFF_SEASON`은 이 스킬이
       바로 거부한다.
    5. **티켓 가격은 공지 문구에 안 들어간다.** DB 타임스탬프 확인 결과 최근 11개월 가까이 가격
       변경 이벤트가 0건 — 그래서 이 스킬은 티켓 수치를 텍스트에 넣으려 하지 않는다.
- **범위 밖**: 실제 디스코드 전송(사람이 직접), 링크 URL 채우기(사람이 직접 — `prize_detail_url`은
  고정 디스코드 채널값이라 실제 보상 페이지 URL과 다름), 티켓 가격이 실제로 바뀐 드문 경우의 전용
  문구(샘플이 아직 없음).

---

## 0. 적용 범위 확인

**Odin+Heimdall SEASON/CHAMPIONSHIP 페어의 공지 초안 생성**에만 적용된다. 범위 밖:

- 실제 게시 — discord.com은 이 환경 방화벽 허용 목록에도 없고, 외부 공개는 되돌릴 수 없어서 애초에
  자동화 대상이 아니다(스펙 §4).
- 오프시즌 공지 — 애초에 존재하지 않는다.
- 티켓 가격이 바뀐 경우의 공지 — 샘플이 없어서 템플릿을 못 만든다. 실제로 그런 공지가 나가면
  `references/announcement-samples.md`에 추가하고 템플릿을 확장해야 한다.

## 1. 입력

| CLI 플래그 | 비고 |
| --- | --- |
| `--odin-season-group-id` / `--odin-arena-type` | SEASON 또는 CHAMPIONSHIP만 |
| `--heimdall-season-group-id` / `--heimdall-arena-type` | SEASON 또는 CHAMPIONSHIP만 |

`arena-reward-table`/`arena-season-preview`와 같은 원칙 — 명시 입력 필수, "지금 진행 중인 시즌"을
스킬이 알아서 추측하지 않는다. **페어 자동 선택도 안 한다** — sid가 아니라 시작 시각 근접도로
페어를 잡아야 하는데, 후보가 여럿일 때 "어느 걸 고를지"는 스킬이 떠안지 않고 항상 사람이 정한다.
대신 `--list`로 후보를 보여주기만 한다(아래).

## 2. 실행

```bash
# 어떤 시즌이 있는지 먼저 훑어보기 (고르지는 않음)
bun run tools/9c/arena-announce.ts --list

# 초안 생성
bun run tools/9c/arena-announce.ts \
  --odin-season-group-id 39 --odin-arena-type SEASON \
  --heimdall-season-group-id 9 --heimdall-arena-type CHAMPIONSHIP
```

`--list`는 두 네트워크의 진행 중·예정 시즌을 `groupId`/타입/예상 시작(KST)으로만 나열한다 — 여기서
`seasonGroupId=0` 버그가 있으면 이 단계에서부터 바로 눈에 띈다(⚠️ 표시).

라이브 `/seasons`에서 두 시즌을 찾아 `seasonGroupId`/`requiredMedalCount`/`startBlock`을 읽고,
초안 + 대사 리포트를 출력한다. `--json`으로 구조화된 출력도 가능.

## 3. 판정 기준

| 등급 | 이 스킬에서 실제로 나오는 항목 |
| --- | --- |
| **OK** | seasonGroupId 정상, 직전 시즌 +1 번호 일치, 시작 시각 근접 |
| **WARN** | 챔피언십의 `requiredMedalCount==0`(메달 문단 검토 필요 — 0이 아니면 정상 범위라 WARN 없음), 직전 시즌 +1 번호가 안 맞음, 페어 시작 시각이 3일 이상 벌어짐 |
| **FATAL** | `seasonGroupId == 0` — **초안 자체를 안 보여준다.** 데이터가 잘못된 채로 사람이 실수로 그대로 게시하는 걸 막는 게 이 등급의 존재 이유 |

`seasonGroupId == 0`은 **두 가지 독립된 체크**(정확히 0인지 / 직전 시즌+1과 일치하는지)로 동시에
잡힌다 — 후자는 0이 아닌 다른 번호 실수(건너뜀·중복)도 잡는 더 넓은 체크라 겹치는 게 의도적이다.

## 4. 수용 기준 (완료 판정) — 현재 상태

| 항목 | 상태 |
| --- | --- |
| 실제 공지 3건을 사람이 "그대로 사용 가능"으로 판정 | ✅ **3건 전부 골든 텍스트 바이트 단위 재현** (`arena-announce-template.test.ts`) — 스펙 §6-4 원문은 "샘플 2종"이지만 3건을 확보해 더 강하게 검증 |
| 티켓 대사가 라이브 값과 일치 | ⚠️ **스코프 재정의됨** — 실측 결과 티켓 가격이 공지 문구 자체에 안 들어간다는 게 확인돼서, "라이브 정책과 텍스트 대조"가 아니라 "가격 변경이 드묾을 확인하고 문구에서 아예 제외"로 바뀜. 가격이 실제로 바뀌는 드문 경우의 전용 템플릿은 샘플이 없어 미착수 |
| 실측 데이터 이상 검출 | ✅ **실제 라이브 버그 1건 발견·검증** — heimdall sid=42의 `seasonGroupId=0`을 FATAL로 정확히 차단 (2026-08-30 라이브 확인) |

---

## 5. 근거 (확인됨)

| 사실 | 근거 |
| --- | --- |
| 공지 3건의 첫 3줄은 완전히 동일 | 담당자 제공 원문(`references/announcement-samples.md`) |
| 공개 시즌 번호 = `seasonGroupId`, 6쌍 전부 정확히 일치 | 담당자 대조, 이 세션이 라이브로 재확인 |
| 메달 문단 조건: 페어에 CHAMPIONSHIP + `requiredMedalCount==0`. 과거 챔피언십은 실제 메달 요구치가 있었음(odin g16=60, heimdall g8=50), 0으로 바뀐 건 odin g17/heimdall g9부터 | 담당자 DB 조사 |
| 링크 대상 URL은 `prize_detail_url`(DB 고정, 디스코드 채널)과 다른 별도 보상 페이지 — 자동 생성 불가 | 담당자 확인, 스펙 §5-1과 교차 |
| 티켓 정책 12개 row 전부 `created_at==updated_at`, 마지막 정책 교체 2025-10-01 — 최근 11개월 가격 변경 이벤트 0건 | 담당자 DB 타임스탬프 조사 |
| **heimdall 진행 중 시즌(sid=42, SEASON)의 `seasonGroupId=0`** — 정상이면 24여야 함(g23 다음), 등록 누락으로 추정 | 담당자 발견, 이 세션이 라이브로 재확인·CLI FATAL 검증(2026-08-30) |
| 위 버그는 `seasonGroupId==0` 체크뿐 아니라 "직전 동일 타입 시즌 번호+1과 다름" 체크로도 독립적으로 잡힘(`checkSequentialSeasonNumber`) — 두 체크가 같은 실제 사례에서 동시에 WARN/FATAL을 냄을 라이브로 확인 | 담당자 제안, 이 세션이 구현·라이브 검증(2026-08-30) |
| "직전 시즌" 조회는 `seasonGroupId==0`인 행(OFF_SEASON뿐 아니라 heimdall sid=1·sid=42 같은 이상치도 포함)을 반드시 제외해야 함 — 안 그러면 heimdall sid=42(groupId=0) 다음에 등록될 진짜 시즌이 "직전=0 → 기대값 1"로 오탐남. 라이브 데이터로 시뮬레이션해 실제로 그렇게 됨을 확인(수정 전 `previousSameType`이 sid=42를 골랐음) | 담당자 리뷰로 배포 전 발견, 이 세션이 수정·시뮬레이션 검증(2026-08-30) |
| 링크 줄 앞의 보이지 않는 문자는 U+2060 WORD JOINER(UTF-8 `e2 81 a0`) — ZWJ(U+200D)도 ZWSP(U+200B)도 아님. 소스·테스트 파일 모두 hexdump로 정확한 코드포인트 확인, 상수(`WORD_JOINER`)로 추출해 재발 방지 | 담당자 바이트 분석, 이 세션이 hexdump로 재확인(2026-08-30) |
| 페어링은 season id가 아니라 시작 시각 근접도로 판단해야 함(id는 네트워크별로 결번이 있어 우연히 같을 뿐) | 담당자 확인 |

## 6. 아직 해소되지 않은 것

| 항목 | 상태 | 필요한 것 |
| --- | --- | --- |
| 티켓 가격 변경 시 전용 공지 템플릿 | 샘플 없음 — 최근 11개월간 발생 안 함 | 실제로 가격이 바뀌는 공지가 나가면 그 원문을 `references/announcement-samples.md`에 추가 |
| 시작 시각 근접도 임계값(현재 3일) | 이 세션이 임의로 정함 — 실제 3건은 전부 1~2일 이내였음 | 더 많은 과거 페어 사례로 임계값 검증 |
| 메달 문단 외 다른 조건부 문단이 있을 가능성 | 3건만으로는 다른 조건부 요소(예: 특별 이벤트 안내)를 다 못 봤을 수 있음 | 더 많은 과거 공지 샘플 확보 시 재검토 |
