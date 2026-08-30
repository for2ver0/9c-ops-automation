# 상금 계산 입력 데이터 소스 — 확인된 사실

> 이 문서는 2026-08-30 세션에서 실측·조사로 확인된 내용만 담는다. 미확인 항목은 여기 없다.

## 1. 랭킹 (완료 시즌 리더보드)

- **엔드포인트**: `GET https://{network}-arena.9c.gg/leaderboard/completed?seasonId={id}` (Odin/Heimdall 확인, Thor는 아레나 엔드포인트 자체가 없음 — 별도 확인됨)
- **인증**: 불필요. Swagger(`/swagger/v1/swagger.json`)에 `security` 항목 없음. 실측: `seasonId=38`(Odin CHAMPIONSHIP, 완료)에 헤더 없이 정상 응답.
- **응답 스키마** (`CompletedSeasonLeaderboardResponse`):
  ```json
  {
    "season": { "id": 38, "seasonGroupId": 17, "startBlock": ..., "endBlock": ..., "arenaType": "CHAMPIONSHIP" },
    "leaderboard": [
      { "rank": 1, "avatarAddress": "0x...", "agentAddress": "0x...",
        "nameWithHash": "Mazi <size=80%><color=#A68F7E>#cf12</color></size>",
        "score": 3684, "totalWin": 122, "totalLose": 0, "level": 515 }
    ]
  }
  ```
  필드가 `ArenaRewardService.CalculateRewards`가 읽는 `ArenaRankingEntry` 프로퍼티(`NameWithHash`/`Ranking`/`Score`/`TotalWin`/`TotalLose`/`Level`/`AgentAddress`/`AvatarAddress`)와 1:1 대응(대소문자만 다름 — camelCase JSON).
- **시점 의존성**: 시즌 종료 후 조회하는 값이라 스냅샷 이슈 없음(완료된 시즌만 조회 가능하도록 서버가 막음).
- ⚠️ **`/leaderboard/completed`는 `cached-block-info`의 캐시된 "현재 시즌"을 기준으로 "완료 여부"를 판정한다 — 추정이 아니라 소스로 확인됨(2026-08-30, `ArenaService/Controllers/LeaderboardController.cs`의 `GetCompletedArenaLeaderboard`).** 실제 코드: `var currentSeasonInfo = await _seasonCacheRepo.GetSeasonAsync(); if (season.Id >= currentSeasonInfo.Id) return BadRequest("The requested block index corresponds to an ongoing or future season.");` — Redis에 캐시된 "현재 시즌 ID"와 단순 비교한다. 이 캐시는 별도 백그라운드 워커가 채우는데, 워커가 뒤처지면 최근에 끝난 시즌도 "아직 진행 중"으로 오판된다. 실측(2026-08-30): 캐시된 `currentBlockIndex=19,498,315`가 실제 최신 시즌(45번, 시작 블록 20,081,624)보다 58만 블록 이상 뒤처져 있었고, 이 상태에서 시즌 41·42를 조회하면 위 400이 났다. 더 오래된 완료 시즌(36·38·39·40)은 정상 응답. **→ 시즌 종료 직후 이 API를 호출하면 캐시 지연으로 일시적 400이 날 수 있다.** 재시도(지수 백오프) 후에도 실패하면 CSV 폴백으로 넘어가야 한다.
  - ⚠️ **같은 컨트롤러 메서드에 `catch (Exception ex) { return BadRequest(ex.Message); }`가 있어서, 캐시가 아예 비어있는 경우(위와는 다른 장애 — `CacheUnavailableException("Season cache is unavailable.")`)도 500/503이 아니라 그냥 400으로 나온다.** 즉 이 엔드포인트의 400은 "캐시가 뒤처짐"과 "캐시가 아예 없음" 두 가지 다른 상황을 구분 없이 같은 상태 코드로 낸다 — 메시지 본문(`ex.Message`)으로만 구분 가능. 반면 `/cached-block-info`는 캐시가 비었을 때 전용 `CacheExceptionFilter`가 잡아서 **정확히 503**을 낸다(스펙 문서 초안이 처음부터 맞았던 부분 — 확인됨).
- **인원수**: 완료 시즌 리더보드가 정확히 500명을 반환한다는 보장 없음(실측 36/38/39/40 각각 410/389/402/416명). 시즌 참여자 수가 500 미만이면 그만큼만 나옴 — 상금 표의 "인원 합 500" 불변식은 리워드 티어 정의(10구간 총합) 대상이지, 실제 참여자 수 대상이 아님을 재확인.
- `leaderboard/count?seasonId=`는 실측 시 0을 반환(파라미터 조합이 다른 것으로 추정, 신뢰하지 말 것 — 대신 `leaderboard` 배열 길이를 직접 센다).

## 2. 스테이킹 (garage 스냅샷)

- **엔드포인트**: `GET https://garage.nine-chronicles.dev/staking-for-arena/main/{PlanetName}/{seasonId}.json`
- **PlanetName 매핑** (`ArenaRewardService.GetPlanetNameFromId`, 이 API 전용): `0x000000000000`/`0x100000000000` → `Odin`, `0x000000000001`/`0x100000000001` → `Heimdall`, `0x000000000003`/`0x100000000003` → `Thor`.
- **인증**: 불필요.
- **시점 의존성 — 이미 해결된 구조**: 실측(seasonId=38) 결과 파일 자체가 `metadata.timestamp`/`metadata.currentBlockIndex`/`metadata.endBlockIndex`를 박아둔 **시즌 종료 시점 스냅샷**이었다. "현재 스테이킹 상태"를 매번 새로 계산하는 라이브 쿼리가 아니라 seasonId로 박제된 정적 파일 — 스냅샷 시점 문제가 API 설계 자체에서 이미 해소되어 있음.
- **응답 필드**: `address`(agent 주소), `deposit`(문자열 decimal), `startedBlockIndex`, `receivedBlockIndex`, `cancellableBlockIndex` — `StakeState` 모델과 1:1 대응. ⚠️ JSON의 `address` 필드가 실제로는 **agent 주소**를 담고 있다(코드에서 `StakeState.AgentAddress = agentAddressProp...`이므로 JSON에 `agentAddress` 필드도 별도로 존재 — 두 필드를 혼동하지 말 것. `deposit` 문자열을 `decimal.Parse`해서 스테이킹 레벨 판정에 씀).
- **스테이킹 레벨 판정** (`ArenaRewardService.GetStakingLevel`): `deposit >= 5000` → lv3, `deposit >= 500` → lv2, 그 외 0. 스펙 문서엔 없던 사실.
- **존재하지 않는 시즌**: 404.

## 3. 용기패스 (SeasonPass 어드민 API)

- **엔드포인트**: `GET {SEASONPASS_API_URL}/api/admin/premium-users?pass_type=CouragePass&season_index={n}&planet_id={planet_id}&limit=100&offset=0`
  - Mainnet 베이스: `https://seasonpass.9c.gg` (`NC_MAINNET_SEASONPASS_API_URL`)
  - 페이지네이션: 서버 `limit` 상한 100. 백오피스는 `offset`을 100씩 늘리며 `Items.Count < limit || Total <= allItems.Count`까지 반복 조회.
- **`planet_id` 값은 게임 플래닛 id 원문 그대로** — Odin `0x000000000000`, Heimdall `0x000000000001`, Thor `0x000000000003` (Internal 환경은 `0x1...` 접두). **garage 쪽의 "Odin"/"Heimdall" 이름 매핑을 여기 적용하면 안 됨** — 두 API가 요구하는 planet 식별자 형식이 다르다.
- **인증 — HS256 대칭키 JWT, Bearer 헤더**. 백오피스가 요청마다 즉석 발급(`SeasonPassRepository.GenerateJwtToken`):
  ```json
  { "iss": "<NC_MAINNET_SEASONPASS_JWT_ISSUER>", "aud": "SeasonPass", "iat": <now>, "nbf": <now>, "exp": <now+1h> }
  ```
  서버 검증(`apps/api/app/utils.py:12`): 알고리즘 HS256 고정 + 서버 보관 시크릿, `aud == "SeasonPass"`, `iat` 과거·`exp` 미래, **토큰 수명 ≤ 1시간**. `iss`는 검증 안 함(장식). 헤더 없으면 403, 잘못된 토큰이면 401 `{"detail":"Not Authorized"}` (실측 확인).
  - **시크릿(`NC_MAINNET_SEASONPASS_JWT_KEY`)은 k8s Secret 참조라 이 자동화 환경에서 접근 불가.** 별도로 전달받아야 API 경로를 쓸 수 있음 — **현재 미보유**.
- **시점 의존성 — 문제 없음**: `get_premium_users`가 `get_pass(sess, pass_type, season_index)`를 호출할 때 `validate_current`를 넘기지 않아 기본값 `False`. 이 플래그가 `True`일 때만 `start_timestamp <= now <= end_timestamp` 조건이 붙으므로, 기본 호출은 시즌 종료 후에도 정상 조회됨(아레나 정산이 시즌 종료 후 도는 구조와 부합).
- ⚠️ **조용한 함정**: `season_index`가 존재하지 않으면 `get_pass`가 `None`을 반환하는데, 이때 필터를 조용히 안 걸어서 **`is_premium=True`인 전 시즌·전체 유저**가 반환된다(빈 배열이 아님). `season_index=0`은 Python에서 falsy라 같은 경로를 탄다. **→ 응답의 `season_info.season_index`가 요청값과 일치하는지 반드시 검증해야 함.** 안 하면 소스가 스킬 자체에서 대량의 잘못된 데이터를 "정상"으로 오인.
- **대안 경로 (현재 이것만 실사용 가능)**:
  1. **CSV 업로드** — `ParseCouragePassFileAsync`, 컬럼 `avatarAddress,agentAddress,productId`. JWT 시크릿 미보유 상태에서는 이 경로가 사실상 유일한 실사용 경로.
  2. 백오피스 자체 REST 래퍼 `GET /api/arena/reward/courage-pass-entries?planet=&seasonIndex=` (`ArenaRewardController.cs:144`) — 백오피스 서버 자체에 대한 네트워크/인증 접근이 필요해 이 환경에서 미확인.

## 결론 — 이 스킬의 1차 구현 데이터 소스 전략

| 소스 | 방식 | 이유 |
| --- | --- | --- |
| 랭킹 | **API 기본** (`leaderboard/completed`) | 인증 불필요, 실측 확인, 시점 문제 없음 |
| 스테이킹 | **API 기본** (garage 스냅샷) | 인증 불필요, 실측 확인, 애초에 시점 스냅샷 구조 |
| 용기패스 | **CSV 폴백만 우선 구현** | API는 존재하나 JWT 시크릿 미보유로 현재 호출 불가. 시크릿 확보 시 어댑터만 교체하면 됨(계산 로직은 `List<CouragePassEntry>` 인터페이스로 이미 분리돼 있음) |

랭킹·스테이킹도 캐시 지연(위 1번 항목) 때문에 API 실패 시 CSV로 넘어가는 폴백은 유지한다.
