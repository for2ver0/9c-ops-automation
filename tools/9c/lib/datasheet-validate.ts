/**
 * datasheet-validate — CURRENTLY A PARTIAL BUILD covering three of the four "새로 설계할
 * 항목" the design doc (부록 A-1) lists for this skill. See
 * .claude/skills/datasheet-validate/SKILL.md for the full story; short version:
 *
 *   1. 구글 시트 단계 사전 검증 — 이 모듈이 하는 것(파일 하나 단위로).
 *   2. 시트 간 참조 ID 검증 — 미착수. lib9c 스키마별 참조 규칙을 개별로 알아야 해서
 *      스키마 매핑 작업이 선행돼야 한다.
 *   3. 회차 간 시트 diff (N 대 N-1) — **이번에 추가한 것.** 설계 문서는 "비교 기준선을
 *      lib9c 커밋/태그에서 가져올지 별도 스냅샷을 둘지 미정"(미해결 B)이라고 적어뒀는데,
 *      2026-09-01에 lib9c 공개 git 이력을 직접 조사해보니 태그(`v200220`에서 멈춤)와
 *      "latest-data" 브랜치(`v200390`에서 멈춤) 둘 다 지금 APV 범위(200450+)보다 훨씬
 *      전에 관리가 끊겼고, `development` 브랜치 커밋 메시지도 릴리즈 버전을 체계적으로
 *      남기지 않는다 — 즉 git 이력에서 N-1을 자동으로 찾아올 방법이 없다는 뜻이다.
 *      그래서 남은 선택지는 별도 스냅샷뿐이고, `--baseline-csv`로 사람이 직전 실행의
 *      CSV를 직접 넘기게 했다(release-guard `--log-file`/deploy-prep `--snapshot-log`와
 *      같은 "사람이 파일을 들고 있는" 패턴 — 새 권한이 필요 없다). diff 엔진은
 *      `qa-checklist.ts`의 `diffSheet`를 재사용한다(중복 구현 안 함).
 *   4. CSV 파싱부 신규 — 기존 Backoffice `CsvValidationService`의 결함 4건(따옴표 안
 *      쉼표 미처리, 빈 줄 제거로 인한 라인 번호 어긋남, 중복 헤더 무음 병합, quoting 없는
 *      재조립)을 재현하지 않는 RFC4180 파서 + 그 결함들이 놓쳤던 걸 잡는 구조적 검증(중복
 *      헤더, 행별 컬럼 수 불일치, 키 컬럼 공백, 행 수 급감)을 제공한다. 파서 자체는
 *      `./csv`로 옮겨졌다 — qa-checklist가 이 모듈의 parseCsv를 가져다 쓰는데, 이 모듈도
 *      qa-checklist의 diffSheet를 가져다 쓰게 되면서 생기는 순환 참조를 끊기 위해서다.
 *
 * 이 모듈은 스키마별 타입·참조 규칙을 모른다 — lib9c의 각 ISheet 구현이 컬럼을 어떻게
 * 쓰는지는 시트마다 다르고, 그 매핑을 만드는 일 자체가 큰 작업이라 이번 착수 범위 밖이다.
 * 대신 "어느 시트에나 적용되는" 구조적 결함(v200450에서 실제로 터진 3종 포함)만 잡는다.
 */
import { diffSheet, type SheetDiff } from "./qa-checklist";

export { parseCsv } from "./csv";
export type { ParsedCsv } from "./csv";
import type { ParsedCsv } from "./csv";

export type Level = "OK" | "WARN" | "FATAL";

export interface Check {
  readonly id: string;
  readonly name: string;
  readonly ok: boolean;
  readonly level: Level;
  readonly detail: string;
}

// ---------------------------------------------------------------------------------------
// 구조적 검증 (순수 함수 — 유닛 테스트 대상)
// ---------------------------------------------------------------------------------------

/** 중복 헤더 검출. Backoffice `ParseCsv`가 `row[headers[j]]`로 Dictionary 키를 헤더 이름으로
 *  써서 중복 헤더의 값을 무음으로 덮어쓰던 버그(부록 A-1) — 여기서는 조용히 넘어가지 않고
 *  FATAL로 잡는다. 실측 사례: `worldboss_info.csv`의 `Vietnam` 중복(부록 A-2). */
export function checkDuplicateHeaders(headers: readonly string[]): Check {
  const id = "duplicate-headers";
  const name = "헤더 중복";
  const seen = new Map<string, number>();
  // 이름이 빈 헤더는 여기서 세지 않는다 (2026-09-03). 구글 시트 gviz는 데이터 범위 밖 열을
  // 빈 헤더로 함께 내보내는데(실측: MaterialItemSheet 26칸 중 21칸이 빈 헤더, 330행 전부
  // 비어 있음), 그걸 "중복 헤더"로 세면 정상 시트가 매번 FATAL로 뜬다. 그러면 진짜 사고
  // (부록 A-2의 worldboss_info.csv `Vietnam` 중복 같은 **이름 있는** 중복)를 봐도 사람이
  // 무시하게 된다. 빈 헤더는 checkEmptyHeaders가 데이터 유무까지 보고 따로 판정한다.
  for (const h of headers) {
    if (h.trim() === "") continue;
    seen.set(h, (seen.get(h) ?? 0) + 1);
  }
  const dupes = [...seen.entries()].filter(([, count]) => count > 1).map(([h]) => h);
  if (dupes.length > 0) {
    return {
      id,
      name,
      ok: false,
      level: "FATAL",
      detail: `중복된 헤더: ${dupes.join(", ")} — 이대로 두면 값이 무음으로 덮어써져 컬럼 하나가 통째로 소실될 수 있습니다.`,
    };
  }
  return { id, name, ok: true, level: "OK", detail: "중복 헤더 없음." };
}

/** 행별 컬럼 수가 헤더 수와 일치하는지. 파서가 따옴표 안 쉼표를 이미 값으로 흡수했으므로,
 *  여기서 불일치가 나오면 실제 데이터 결함(열 누락/추가)이지 파싱 오탐이 아니다.
 *
 *  알려진 한계: `line`은 논리 행 인덱스로 계산한다(1개 논리 행 = 물리 파일 1줄이라는 가정).
 *  어떤 행이든 따옴표 안에 개행을 포함하면 그 이후 모든 행은 실제 물리 줄 번호보다 작게
 *  보고된다 — 파서가 물리 줄 번호를 별도로 추적하지 않기 때문. 진단이 완전히 틀리는 건
 *  아니고(그 행 근처를 찾는 데는 쓸 수 있음) 정확한 줄 번호가 필요하면 직접 세어야 한다. */
export function checkRowColumnCounts(headers: readonly string[], rows: readonly string[][]): Check {
  const id = "row-column-counts";
  const name = "행별 컬럼 수 일치";
  const mismatches: Array<{ line: number; count: number }> = [];
  rows.forEach((row, idx) => {
    if (row.length !== headers.length) {
      mismatches.push({ line: idx + 2, count: row.length }); // +2: 1-index + 헤더 행
    }
  });
  if (mismatches.length > 0) {
    const sample = mismatches
      .slice(0, 5)
      .map((m) => `${m.line}행(${m.count}칸)`)
      .join(", ");
    const more = mismatches.length > 5 ? ` 외 ${mismatches.length - 5}건` : "";
    return {
      id,
      name,
      ok: false,
      level: "FATAL",
      detail: `헤더는 ${headers.length}칸인데 컬럼 수가 다른 행: ${sample}${more}.`,
    };
  }
  return { id, name, ok: true, level: "OK", detail: `모든 행이 헤더와 같은 ${headers.length}칸.` };
}

/** 지정된 키 컬럼(보통 Id)이 비어 있는 행 검출. Backoffice에 그대로 올리면 key 컬럼이 빈
 *  값으로 `ISheet.Set`에 들어가 `ArgumentException`을 내는 실패 모드(부록 A-1, v200450)를
 *  업로드 전에 미리 잡는다. keyColumn이 헤더에 없으면 스킵(WARN)이지 실패가 아니다 —
 *  시트마다 키 컬럼 이름이 다를 수 있어서 강제하지 않는다.
 *
 *  `line`은 checkRowColumnCounts와 같은 논리 행 인덱스 방식이라 같은 한계(따옴표 안 개행이
 *  있는 행 이후로는 물리 줄 번호보다 작게 보고됨)를 그대로 갖는다 — 위 주석 참고. */
export function checkKeyColumnNonEmpty(
  headers: readonly string[],
  rows: readonly string[][],
  keyColumn: string | null,
): Check {
  const id = "key-column-non-empty";
  const name = "키 컬럼 공백";
  if (keyColumn === null) {
    return { id, name, ok: true, level: "WARN", detail: "키 컬럼이 지정되지 않아 이 검사를 건너뜁니다 (--key-column으로 지정하세요)." };
  }
  const colIdx = headers.findIndex((h) => h.toLowerCase() === keyColumn.toLowerCase());
  if (colIdx === -1) {
    return { id, name, ok: false, level: "WARN", detail: `키 컬럼 "${keyColumn}"이 헤더에 없습니다 — 이 검사를 건너뜁니다.` };
  }
  const emptyLines = rows
    .map((row, idx) => ({ line: idx + 2, value: row[colIdx] }))
    .filter((r) => r.value === undefined || r.value.trim().length === 0)
    .map((r) => r.line);
  if (emptyLines.length > 0) {
    const sample = emptyLines.slice(0, 10).join(", ");
    const more = emptyLines.length > 10 ? ` 외 ${emptyLines.length - 10}건` : "";
    return {
      id,
      name,
      ok: false,
      level: "FATAL",
      detail: `키 컬럼 "${keyColumn}"이 비어 있는 행: ${sample}행${more} — 업로드 시 ArgumentException으로 이어질 수 있습니다.`,
    };
  }
  return { id, name, ok: true, level: "OK", detail: `키 컬럼 "${keyColumn}" 전부 채워짐.` };
}

/**
 * gviz URL에 `headers=1`이 빠진 경우 경고 (2026-09-03 추가). 구글 gviz는 헤더 행이 몇 줄인지
 * **추측**하는데, 추측에 실패하면 데이터 행들을 헤더 한 줄로 접어버린다. 실측(2026-09-03,
 * 실제 밸런스 시트 `CollectionSheet`):
 *
 *   - `...&sheet=CollectionSheet`          → 13행, 첫 헤더가 `"id 1 2 3 4 5 …"`(수백 개 id가
 *                                             공백으로 이어붙은 한 셀). **882행 유실.**
 *   - `...&sheet=CollectionSheet&headers=1` → 895행, 헤더 `"id","item_id1","count1",…` 정상.
 *
 * 즉 이 파라미터가 없으면 시트에 따라 데이터의 대부분이 조용히 사라진 CSV를 검증하게 된다
 * (v200450의 `SkillBuffSheet` 188행 유실과 같은 종류의 사고인데, 이번엔 익스포트 도구가 아니라
 * URL 한 조각이 원인이다). 행 수가 0은 아니라서 `checkHasDataRows`로도 안 걸리고, 기준값이
 * 없으면 급감 검사로도 안 걸린다.
 */
export function checkGvizHeadersParam(url: string | null): Check {
  const id = "gviz-headers-param";
  const name = "gviz headers 파라미터";
  if (url === null) {
    return { id, name, ok: true, level: "OK", detail: "로컬 파일이라 해당 없음." };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { id, name, ok: true, level: "OK", detail: "URL을 해석하지 못해 건너뜁니다." };
  }
  if (!parsed.pathname.includes("/gviz/tq")) {
    return { id, name, ok: true, level: "OK", detail: "gviz export URL이 아니라 해당 없음." };
  }
  if (!parsed.searchParams.has("headers")) {
    return {
      id,
      name,
      ok: false,
      level: "WARN",
      detail:
        "gviz URL에 headers=1이 없습니다 — 구글이 헤더 행 수를 잘못 추측하면 데이터 행이 헤더 한 줄로 접혀 대량 유실됩니다(실측: CollectionSheet 895행 → 13행). URL 끝에 &headers=1을 붙여 다시 확인하세요.",
    };
  }
  return { id, name, ok: true, level: "OK", detail: `headers=${parsed.searchParams.get("headers")} 지정됨.` };
}

/**
 * 이름이 없는(빈) 헤더 열 판정 (2026-09-03 추가). 두 경우를 구분한다:
 *
 *   - 빈 헤더 열이 **전부 빈 값**이면 WARN — 구글 시트가 데이터 범위 밖 열까지 내보낸
 *     아티팩트다(실측: `MaterialItemSheet`가 26칸 중 21칸이 이 경우, 330행 전부 비어 있음).
 *     업로드에 실질적 영향은 없지만, 열을 지우고 다시 내보내는 게 깔끔하므로 알려는 준다.
 *   - 빈 헤더 열에 **데이터가 있으면** FATAL — 이건 진짜 사고다. Backoffice 파서는 헤더
 *     이름을 Dictionary 키로 쓰므로 이름 없는 열들이 키 ""로 뭉개지고, 그 열의 값이 통째로
 *     소실된다(부록 A-1의 중복 헤더 무음 병합과 같은 실패 모드).
 *
 * 이 검사를 분리하기 전에는 `checkDuplicateHeaders`가 빈 헤더 2개 이상을 "중복"으로 세서
 * 정상 시트에 매번 FATAL을 냈다 — 진짜 FATAL을 무시하게 만드는 오탐이라 갈라놓았다.
 */
export function checkEmptyHeaders(headers: readonly string[], rows: readonly string[][]): Check {
  const id = "empty-headers";
  const name = "빈 헤더";
  const emptyIdx = headers.map((h, i) => [h, i] as const).filter(([h]) => h.trim() === "").map(([, i]) => i);
  if (emptyIdx.length === 0) {
    return { id, name, ok: true, level: "OK", detail: "모든 헤더에 이름이 있음." };
  }
  const withData = emptyIdx.filter((i) => rows.some((r) => (r[i] ?? "").trim() !== ""));
  if (withData.length > 0) {
    return {
      id,
      name,
      ok: false,
      level: "FATAL",
      detail: `헤더 이름이 없는데 값이 들어있는 열: ${withData.map((i) => `${i + 1}번째 칸`).join(", ")} — 업로드 시 이름 없는 열들이 한 키로 뭉개져 값이 소실됩니다.`,
    };
  }
  return {
    id,
    name,
    ok: false,
    level: "WARN",
    detail: `이름 없는 빈 열 ${emptyIdx.length}개 (데이터도 전부 비어 있음) — 구글 시트가 데이터 범위 밖 열까지 내보낸 것으로 보입니다. 그대로 둬도 값 손실은 없지만, 열을 지우고 다시 내보내면 깔끔합니다.`,
  };
}

/**
 * 데이터 행이 하나도 없는 CSV 검출 (2026-09-03 추가). 헤더만 있고 0행인 파일은 기준값이
 * 없으면 기존 검사 다섯 개를 전부 통과해 exit 0으로 끝났다 — 익스포트 실패의 전형(탭 이름
 * 오타로 빈 응답, 필터가 걸린 채 export, 익스포트 도구 오류)인데 조용히 OK가 나오던 자리다.
 * lib9c TableCSV 중 데이터 행이 0개인 정상 상태는 없으므로 FATAL로 잡는다.
 */
export function checkHasDataRows(rowCount: number): Check {
  const id = "has-data-rows";
  const name = "데이터 행 존재";
  if (rowCount === 0) {
    return {
      id,
      name,
      ok: false,
      level: "FATAL",
      detail:
        "헤더만 있고 데이터 행이 0개입니다 — 익스포트 실패(탭 이름 오타, 필터 걸린 채 export, 도구 오류)일 가능성이 높습니다. 원본 시트를 확인하세요.",
    };
  }
  return { id, name, ok: true, level: "OK", detail: `데이터 ${rowCount}행.` };
}

/**
 * 키 컬럼 **값**의 중복 검출 (2026-09-03 추가, 같은 날 등급 정정). 기존 `checkDuplicateHeaders`는
 * 헤더 이름의 중복만 봤고 Id 값이 겹치는 건 아무도 안 봤다.
 *
 * ⚠️ **등급이 WARN인 이유 — 중복 Id는 시트에 따라 정상이다.** 처음엔 "업로드 시 뒤 행이 앞
 * 행을 무음으로 덮어쓴다"고 보고 FATAL로 만들었는데, lib9c 원본을 직접 읽어보니 **둘 다
 * 틀렸다**(2026-09-03 실측, `planetarium/lib9c` main):
 *
 *   - `Sheet<TKey,TValue>.AddRow`의 기본 구현은 `((IDictionary)_impl).Add(key, value)`다.
 *     이건 덮어쓰기(`_impl[key] = value`)가 아니라 중복 키에 **ArgumentException을 던진다**.
 *     `Set()`은 그 호출을 try로 감싸지 않으므로, 병합형이 아닌 시트에서 중복 Id는 무음 사고가
 *     아니라 로드 실패로 드러난다.
 *   - 더 중요한 건, **27개 시트가 `AddRow`를 오버라이드하고 그중 25개가 "병합형"**이라는
 *     점이다(`TryGetValue`로 기존 행을 찾아 리스트에 덧붙임). `ArenaSheet`(한 시즌 = 여러
 *     라운드 행), `EventDungeonStageWaveSheet`(한 스테이지 = 여러 웨이브 행),
 *     `SkillBuffSheet`, `StageWaveSheet`, `RuneOptionSheet` 등 — 이 시트들에선 **중복 Id가
 *     설계된 정상 형식**이다.
 *
 * 어느 쪽인지는 시트 종류를 알아야 갈리는데, 그 시트별 매핑은 이 스킬의 범위 밖이다(SKILL.md
 * §4 "시트 간 참조 ID·타입 검증"과 같은 이유). 그래서 FATAL로 단정하지 않고 WARN으로 알리고
 * 사람이 판단하게 한다 — 정상 데이터에 FATAL을 상시로 내면 진짜 FATAL을 무시하게 되므로,
 * 이 파일의 `checkEmptyHeaders` 분리와 같은 판단이다.
 *
 * 빈 값은 여기서 세지 않는다 — `checkKeyColumnNonEmpty`가 이미 FATAL로 잡으므로 같은 문제를
 * "빈 문자열이 중복"으로 두 번 보고하지 않기 위해서다.
 */
export function checkDuplicateKeyValues(
  headers: readonly string[],
  rows: readonly string[][],
  keyColumn: string | null,
): Check {
  const id = "duplicate-key-values";
  const name = "키 값 중복";
  if (keyColumn === null) {
    return { id, name, ok: true, level: "WARN", detail: "키 컬럼이 지정되지 않아 이 검사를 건너뜁니다 (--key-column으로 지정하세요)." };
  }
  const colIdx = headers.findIndex((h) => h.toLowerCase() === keyColumn.toLowerCase());
  if (colIdx === -1) {
    return { id, name, ok: false, level: "WARN", detail: `키 컬럼 "${keyColumn}"이 헤더에 없습니다 — 이 검사를 건너뜁니다.` };
  }
  const counts = new Map<string, number>();
  for (const row of rows) {
    const v = (row[colIdx] ?? "").trim();
    if (v === "") continue; // 빈 값은 checkKeyColumnNonEmpty의 몫
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const dupes = [...counts.entries()].filter(([, c]) => c > 1);
  if (dupes.length > 0) {
    const sample = dupes.slice(0, 5).map(([v, c]) => `"${v}"(${c}회)`).join(", ");
    const more = dupes.length > 5 ? ` 외 ${dupes.length - 5}건` : "";
    return {
      id,
      name,
      ok: false,
      level: "WARN",
      detail:
        `키 컬럼 "${keyColumn}"에 중복된 값: ${sample}${more} — 이 시트가 병합형(같은 id의 여러 행을 한 항목으로 합치는 lib9c 시트 25종, 예: ArenaSheet·SkillBuffSheet·EventDungeonStageWaveSheet)이면 정상입니다. ` +
        `아니라면 로드 시 ArgumentException으로 실패합니다 — 어느 쪽인지 시트 종류를 확인하세요.`,
    };
  }
  return { id, name, ok: true, level: "OK", detail: `키 컬럼 "${keyColumn}" 값이 전부 고유함.` };
}

/**
 * 구글 시트 gviz의 "없는 탭 → 첫 탭 폴백" 검출 (2026-09-03 추가). `?sheet=<탭이름>`에 오타가
 * 있어도 구글은 404를 주지 않고 **기본(첫) 탭을 200으로 돌려준다** — 2026-09-03에 실제 공개
 * 시트로 확인했다(탭 미지정 / 없는 탭 A / 없는 탭 B 세 응답이 md5까지 동일). 그래서 탭 이름을
 * 잘못 적으면 전혀 다른 시트를 검증하고 OK를 받게 된다.
 *
 * 응답 본문만으로는 "이게 어느 탭인지" 알 방법이 없으므로, `sheet=`를 뺀 같은 URL(=기본 탭)을
 * 한 번 더 받아 본문이 같은지 비교한다. 같으면 폴백일 수 있다고 WARN을 낸다 — 사용자가 정말
 * 첫 번째 탭을 대상으로 삼은 경우엔 오탐이므로 FATAL로 올리지 않는다.
 */
export function checkRequestedTabIsNotDefault(requestedText: string | null, defaultTabText: string | null): Check {
  const id = "requested-tab-fallback";
  const name = "요청한 탭 확인";
  if (requestedText === null) {
    // 대조 입력 자체가 안 들어온 경우다 — 로컬 파일이거나, URL에 sheet=가 없거나, 호출자가
    // 대조용 본문을 넘기지 않았을 수 있다. 셋을 구분할 정보가 이 함수엔 없으므로 뭉뚱그려
    // 말한다("sheet=가 없어서"라고 단정하면 sheet=가 있는 호출에서 틀린 설명이 된다).
    return { id, name, ok: true, level: "OK", detail: "탭 대조 입력이 없어 해당 없음(로컬 파일이거나 대조를 요청하지 않은 실행)." };
  }
  if (defaultTabText === null) {
    return { id, name, ok: false, level: "WARN", detail: "기본 탭 응답을 받지 못해 폴백 여부를 대조하지 못했습니다." };
  }
  if (requestedText === defaultTabText) {
    return {
      id,
      name,
      ok: false,
      level: "WARN",
      detail:
        "요청한 탭의 응답이 sheet= 없는(기본 탭) 응답과 완전히 같습니다 — 탭 이름 오타로 구글이 첫 번째 탭을 돌려준 것일 수 있습니다. 탭 이름을 확인하세요(정말 첫 탭이 대상이면 무시해도 됩니다).",
    };
  }
  return { id, name, ok: true, level: "OK", detail: "요청한 탭이 기본 탭과 다른 내용을 반환했습니다." };
}

/**
 * 직전 기준(baseline) 행 수 대비 급감 검출. v200450에서 `SkillBuffSheet` 188행이 익스포트
 * 과정에서 통째로 유실된 실패 모드(부록 A-1)를 사후 대조로 잡는다. baseline이 없으면(첫
 * 실행) 비교 없이 정보성으로만 표시한다. 증가는 정상(패치로 항목 추가)이라 통과.
 */
export function checkRowCountAgainstBaseline(rowCount: number, baselineCount: number | null): Check {
  const id = "row-count-vs-baseline";
  const name = "행 수 급감";
  if (baselineCount === null) {
    return { id, name, ok: true, level: "OK", detail: `기준값 없음 — 현재 ${rowCount}행을 다음 실행의 기준으로 쓰세요(--baseline-rows).` };
  }
  if (rowCount < baselineCount) {
    const dropped = baselineCount - rowCount;
    return {
      id,
      name,
      ok: false,
      level: "FATAL",
      detail: `직전 ${baselineCount}행 → 현재 ${rowCount}행 (${dropped}행 감소) — SkillBuffSheet 188행 유실과 같은 패턴일 수 있습니다. 익스포트를 다시 확인하세요.`,
    };
  }
  return { id, name, ok: true, level: "OK", detail: `직전 ${baselineCount}행 → 현재 ${rowCount}행 (감소 없음).` };
}

/**
 * 회차 간 시트 diff (N 대 N-1). `--baseline-csv`로 사람이 넘긴 직전 회차 CSV와 지금 CSV를
 * `qa-checklist.ts`의 `diffSheet`로 대조해 추가·삭제·변경된 행/컬럼 수를 보여준다. 항상
 * 정보성(OK)이다 — "몇 % 이상 바뀌면 이상하다" 같은 임계값은 근거 없이 지어낸 게이트가
 * 되므로 만들지 않았다(설계 문서 전반의 원칙 — 근거 없는 규칙을 판정에 쓰지 않는다). 사람이
 * 이 요약을 보고 "이번 회차에 의도한 만큼만 바뀌었는지" 스스로 판단한다. baseline이
 * 없으면(첫 실행이거나 --baseline-csv 미지정) 비교 없이 건너뛴다 — WARN이 아니다, 첫
 * 실행은 정상 상황이다.
 */
export function checkBaselineDiff(csv: ParsedCsv, baseline: ParsedCsv | null, keyColumn: string | null): Check {
  const id = "baseline-diff";
  const name = "회차 간 diff (N 대 N-1)";
  if (baseline === null) {
    return { id, name, ok: true, level: "OK", detail: "기준(직전 회차) CSV 없음 — 비교를 건너뜁니다(--baseline-csv로 지정하면 다음부터 비교됩니다)." };
  }
  if (keyColumn === null) {
    return { id, name, ok: true, level: "WARN", detail: "키 컬럼이 지정되지 않아 회차 간 diff를 건너뜁니다 (--key-column으로 지정하세요)." };
  }
  let diff: SheetDiff;
  try {
    diff = diffSheet(baseline, csv, keyColumn);
  } catch (e) {
    return { id, name, ok: false, level: "WARN", detail: `diff 계산 실패: ${e instanceof Error ? e.message : e}` };
  }
  const dupNote =
    diff.duplicateKeysBefore.length > 0 || diff.duplicateKeysAfter.length > 0
      ? ` (주의: 중복 키가 있어 diff는 마지막 값만 반영함 — 원본 확인 필요)`
      : "";
  return {
    id,
    name,
    ok: true,
    level: "OK",
    detail: `직전 회차 대비 추가 ${diff.added.length}행 / 삭제 ${diff.removed.length}행 / 변경 ${diff.changed.length}행 / 컬럼 추가 ${diff.columnChanges.added.length}개 / 컬럼 삭제 ${diff.columnChanges.removed.length}개${dupNote}`,
  };
}

export function overallLevel(checks: readonly Check[]): Level {
  if (checks.some((c) => c.level === "FATAL")) return "FATAL";
  if (checks.some((c) => c.level === "WARN")) return "WARN";
  return "OK";
}

export function runStructuralChecks(
  csv: ParsedCsv,
  opts: {
    keyColumn: string | null;
    baselineRows: number | null;
    baselineCsv?: ParsedCsv | null;
    /** `--url`에 sheet=가 있을 때 받아온 원문과, sheet=를 뺀 기본 탭 원문. 폴백 대조용
     *  (checkRequestedTabIsNotDefault 참고). 로컬 파일이면 둘 다 null. */
    requestedText?: string | null;
    defaultTabText?: string | null;
    /** `--url`로 받은 원본 URL(로컬 파일이면 null). gviz headers 파라미터 점검에 쓴다. */
    url?: string | null;
  },
): Check[] {
  const baselineCsv = opts.baselineCsv ?? null;
  // baselineCsv가 있으면 거기서 행 수를 자동으로 뽑아 쓴다 — 급감 검사를 위해 --baseline-rows를
  // 따로 또 계산해서 넘길 필요가 없다. 둘 다 명시적으로 주어졌으면 --baseline-rows가 우선(더
  // 명시적인 입력을 존중).
  const baselineRows = opts.baselineRows ?? (baselineCsv ? baselineCsv.rows.length : null);
  return [
    checkDuplicateHeaders(csv.headers),
    checkEmptyHeaders(csv.headers, csv.rows),
    checkRowColumnCounts(csv.headers, csv.rows),
    checkHasDataRows(csv.rows.length),
    checkKeyColumnNonEmpty(csv.headers, csv.rows, opts.keyColumn),
    checkDuplicateKeyValues(csv.headers, csv.rows, opts.keyColumn),
    checkRowCountAgainstBaseline(csv.rows.length, baselineRows),
    checkBaselineDiff(csv, baselineCsv, opts.keyColumn),
    checkRequestedTabIsNotDefault(opts.requestedText ?? null, opts.defaultTabText ?? null),
    checkGvizHeadersParam(opts.url ?? null),
  ];
}
