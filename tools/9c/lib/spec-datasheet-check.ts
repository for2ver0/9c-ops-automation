/**
 * spec-datasheet-check — 기획서(사람이 텍스트/파일로 직접 전달)와 밸런스 시트 CSV가
 * 실제로 일치하는지 대사한다. datasheet-validate가 CSV *구조*만 보는 것과 달리, 이 모듈은
 * "값이 기획서와 맞는지"를 본다 — 원래 spec-to-datasheet가 노션에서 기획 문서를 직접 읽어와
 * 하려던 일 중 절반이다(나머지 절반인 "밸런스 시트 입력용 정리 이슈 초안 생성"은 여전히
 * 노션 접근이 필요해 범위 밖).
 *
 * 이 모듈은 기획서 문장을 이해하지 않는다 — "쿨타임 5→3으로 변경" 같은 문장에서 시트/행/
 * 컬럼/기대값을 뽑아내는 건 사람 또는 에이전트가 기획서를 읽고 assertions로 정리하는 일이고,
 * 이 모듈은 그 assertions가 실제 CSV와 맞는지만 기계적으로 대조한다(값 자체의 해석은 안 함).
 */
import type { ParsedCsv } from "./csv";

export type Level = "OK" | "WARN" | "FATAL";

export interface Assertion {
  /** 이 assertion이 어느 시트(탭)에 대한 것인지. 생략하면 --sheet-name과 무관하게 항상 적용됨. */
  readonly sheet?: string;
  readonly id: string;
  readonly column: string;
  readonly expected: string;
  /** 기획서 원문 근거(선택) — 사람이 나중에 왜 이 값을 기대했는지 되짚어볼 때 도움. */
  readonly note?: string;
}

export type AssertionStatus = "OK" | "MISMATCH" | "ROW_NOT_FOUND" | "COLUMN_NOT_FOUND";

export interface AssertionResult {
  readonly assertion: Assertion;
  readonly status: AssertionStatus;
  readonly level: Level;
  readonly detail: string;
}

/** --sheet-name이 주어지면 그 시트에 안 맞는 assertion(sheet 필드가 다르게 지정된 것)은
 *  건너뛴다. sheet 필드가 없는 assertion은 항상 적용 대상(단일 시트 시나리오 기본값). */
export function filterAssertionsForSheet(
  assertions: readonly Assertion[],
  sheetName: string | null,
): Assertion[] {
  if (sheetName === null) return [...assertions];
  return assertions.filter((a) => a.sheet === undefined || a.sheet === sheetName);
}

/** 문자열이 다르더라도 둘 다 숫자로 읽히고 값이 같으면(예: "3" vs "3.0") 일치로 본다 —
 *  구글 시트 export가 숫자 표기를 살짝 다르게 내보내는 경우 오탐을 막기 위함. */
function valuesEqual(actual: string, expected: string): boolean {
  const a = actual.trim();
  const e = expected.trim();
  if (a === e) return true;
  if (a === "" || e === "") return false;
  const an = Number(a);
  const en = Number(e);
  return Number.isFinite(an) && Number.isFinite(en) && an === en;
}

export function checkAssertion(csv: ParsedCsv, keyColumn: string, assertion: Assertion): AssertionResult {
  const keyIdx = csv.headers.findIndex((h) => h.toLowerCase() === keyColumn.toLowerCase());
  if (keyIdx === -1) {
    return {
      assertion,
      status: "COLUMN_NOT_FOUND",
      level: "FATAL",
      detail: `키 컬럼 "${keyColumn}"이 시트 헤더에 없습니다.`,
    };
  }
  const colIdx = csv.headers.findIndex((h) => h.toLowerCase() === assertion.column.toLowerCase());
  if (colIdx === -1) {
    return {
      assertion,
      status: "COLUMN_NOT_FOUND",
      level: "FATAL",
      detail: `컬럼 "${assertion.column}"이 시트 헤더에 없습니다 (기획서: ${assertion.note ?? "근거 없음"}).`,
    };
  }
  const row = csv.rows.find((r) => (r[keyIdx] ?? "").trim() === assertion.id.trim());
  if (!row) {
    return {
      assertion,
      status: "ROW_NOT_FOUND",
      level: "FATAL",
      detail: `${keyColumn}="${assertion.id}"인 행을 찾지 못했습니다 (기획서: ${assertion.note ?? "근거 없음"}).`,
    };
  }
  const actual = row[colIdx] ?? "";
  if (!valuesEqual(actual, assertion.expected)) {
    return {
      assertion,
      status: "MISMATCH",
      level: "FATAL",
      detail:
        `${keyColumn}="${assertion.id}"의 "${assertion.column}": 기획서 기대값 "${assertion.expected}" / ` +
        `시트 실제값 "${actual}" (기획서: ${assertion.note ?? "근거 없음"}).`,
    };
  }
  return {
    assertion,
    status: "OK",
    level: "OK",
    detail: `${keyColumn}="${assertion.id}"의 "${assertion.column}" = "${actual}" (기획서와 일치).`,
  };
}

export function overallLevel(results: readonly AssertionResult[]): Level {
  if (results.some((r) => r.level === "FATAL")) return "FATAL";
  if (results.some((r) => r.level === "WARN")) return "WARN";
  return "OK";
}

export interface CheckAssertionsResult {
  readonly results: AssertionResult[];
  /** --sheet-name과 안 맞아 이번 실행에서 건너뛴 assertion 수 (문제 아님 — 다른 시트용). */
  readonly skipped: number;
}

export function checkAssertions(
  csv: ParsedCsv,
  keyColumn: string,
  assertions: readonly Assertion[],
  sheetName: string | null,
): CheckAssertionsResult {
  const applicable = filterAssertionsForSheet(assertions, sheetName);
  const skipped = assertions.length - applicable.length;
  const results = applicable.map((a) => checkAssertion(csv, keyColumn, a));
  return { results, skipped };
}
