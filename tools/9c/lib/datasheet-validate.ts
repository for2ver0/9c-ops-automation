/**
 * datasheet-validate — CURRENTLY A PARTIAL BUILD covering only the "CSV 파싱부 신규" +
 * generic structural checks slice of the design doc's datasheet-validate scope. See
 * .claude/skills/datasheet-validate/SKILL.md for the full story; short version:
 *
 * The design doc (부록 A-1) lists four "새로 설계할 항목" for this skill:
 *   1. 구글 시트 단계 사전 검증 — 이 모듈이 하는 것(파일 하나 단위로).
 *   2. 시트 간 참조 ID 검증 — 미착수. lib9c 스키마별 참조 규칙을 개별로 알아야 해서
 *      스키마 매핑 작업이 선행돼야 한다.
 *   3. 회차 간 시트 diff (N 대 N-1) — 미착수. 비교 기준선을 lib9c 커밋/태그에서 가져올지
 *      별도 스냅샷을 둘지 설계 문서 자체가 미정(미해결 B)이라 구현할 수 없다.
 *   4. CSV 파싱부 신규 — **이 모듈이 하는 것.** 기존 Backoffice `CsvValidationService`의
 *      결함 4건(따옴표 안 쉼표 미처리, 빈 줄 제거로 인한 라인 번호 어긋남, 중복 헤더 무음
 *      병합, quoting 없는 재조립)을 재현하지 않는 파서 + 그 결함들이 놓쳤던 걸 잡는 구조적
 *      검증(중복 헤더, 행별 컬럼 수 불일치, 키 컬럼 공백, 행 수 급감)을 제공한다.
 *
 * 이 모듈은 스키마별 타입·참조 규칙을 모른다 — lib9c의 각 ISheet 구현이 컬럼을 어떻게
 * 쓰는지는 시트마다 다르고, 그 매핑을 만드는 일 자체가 큰 작업이라 이번 착수 범위 밖이다.
 * 대신 "어느 시트에나 적용되는" 구조적 결함(v200450에서 실제로 터진 3종 포함)만 잡는다.
 */

export type Level = "OK" | "WARN" | "FATAL";

export interface Check {
  readonly id: string;
  readonly name: string;
  readonly ok: boolean;
  readonly level: Level;
  readonly detail: string;
}

export interface ParsedCsv {
  readonly headers: string[];
  /** 각 행은 헤더와 같은 순서의 문자열 배열. 원본 줄바꿈(따옴표 안)은 보존됨. */
  readonly rows: string[][];
}

// ---------------------------------------------------------------------------------------
// CSV 파서 (RFC4180 준수) — Backoffice CsvValidationService의 lines[i].Split(',') 대체
// ---------------------------------------------------------------------------------------

/**
 * RFC4180 방식 CSV 파서. Backoffice `ValidateBasicCsvFormat`/`ParseCsv`가 가진 결함(부록
 * A-1)을 재현하지 않는다:
 *   - 따옴표로 감싼 필드 안의 쉼표·줄바꿈을 값의 일부로 취급한다("`WorldBossActionPatternSheet.csv`
 *     같은 정상 CSV를 컬럼 수 불일치로 오탐"하던 버그의 원인).
 *   - `""`(이스케이프된 따옴표)를 `"` 한 글자로 되돌린다.
 *   - 빈 줄을 파싱 전에 미리 제거하지 않는다 — 원본 줄 번호가 그대로 유지된다(Backoffice는
 *     `RemoveEmptyEntries`로 먼저 제거해 에러 메시지의 줄 번호가 실제 파일과 어긋났다).
 * 헤더 중복은 여기서 병합하지 않고 그대로 배열에 남긴다 — 병합 여부 판단은
 * `checkDuplicateHeaders`가 명시적으로 한다.
 */
export function parseCsv(text: string): ParsedCsv {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rawRows = tokenizeCsvRows(normalized);
  if (rawRows.length === 0) return { headers: [], rows: [] };
  const [headers, ...rows] = rawRows;
  return { headers, rows };
}

function tokenizeCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  let sawAnyChar = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i];
    sawAnyChar = true;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      endField();
      i++;
      continue;
    }
    if (c === "\n") {
      endRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (sawAnyChar && (field.length > 0 || row.length > 0)) {
    endRow();
  }
  // 파일 끝의 완전히 빈 줄(트레일링 개행)로 생긴 [""] 한 칸짜리 행은 실질적으로 빈 줄이므로 버린다.
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
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
  for (const h of headers) seen.set(h, (seen.get(h) ?? 0) + 1);
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
 *  여기서 불일치가 나오면 실제 데이터 결함(열 누락/추가)이지 파싱 오탐이 아니다. */
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
 *  시트마다 키 컬럼 이름이 다를 수 있어서 강제하지 않는다. */
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

export function overallLevel(checks: readonly Check[]): Level {
  if (checks.some((c) => c.level === "FATAL")) return "FATAL";
  if (checks.some((c) => c.level === "WARN")) return "WARN";
  return "OK";
}

export function runStructuralChecks(
  csv: ParsedCsv,
  opts: { keyColumn: string | null; baselineRows: number | null },
): Check[] {
  return [
    checkDuplicateHeaders(csv.headers),
    checkRowColumnCounts(csv.headers, csv.rows),
    checkKeyColumnNonEmpty(csv.headers, csv.rows, opts.keyColumn),
    checkRowCountAgainstBaseline(csv.rows.length, opts.baselineRows),
  ];
}
