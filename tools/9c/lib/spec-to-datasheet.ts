/**
 * spec-to-datasheet — 기획서에서 뽑은 "계획"(어느 시트의 어느 행/컬럼을 어떤 값으로)을 현재
 * 밸런스 시트 CSV와 대조해, 시트에 입력할 **작업 지시서**(현재값 → 제안값)를 만든다.
 * `spec-datasheet-check`의 거울상이다:
 *
 *   - `spec-to-datasheet`  : 시트를 **고치기 전**에 본다. "행이 없다" = 새로 추가해야 함(정상).
 *   - `spec-datasheet-check`: 시트를 **고친 뒤**에 본다.  "행이 없다" = 반영 누락(FATAL).
 *
 * 두 스킬의 입력 JSON 형식은 **의도적으로 동일하다**(`PlanItem` = `Assertion`). 같은 파일을
 * 작성 전엔 지시서로, 작성 후엔 검증용 assertions로 그대로 재사용하기 위한 것이라 별도 변환
 * 단계를 두지 않았다 — 형식이 갈라지면 그 순간 왕복이 깨진다.
 *
 * 이 모듈도 기획서 문장을 이해하지 않는다. 자연어에서 계획을 뽑는 건 에이전트/사람의 몫이고
 * (`spec-datasheet-check`와 같은 이유 — 잘못 파싱한 항목이 시트 값과 우연히 맞아 문제를
 * 놓칠 수 있다), 이 모듈은 이미 정리된 계획과 실제 CSV를 기계적으로 대조만 한다.
 *
 * 설계 문서가 원래 `spec-to-datasheet`에 요구했던 "노션 API로 기획 문서 페이지를 직접 읽기"는
 * 구현하지 않았다 — 기획서를 사람이 파일/텍스트로 직접 전달하는 것으로 확정됐기 때문이다
 * (2026-09-03). 노션 연동이 필요해지면 그때 이 모듈 앞단에 붙이면 되고, 대조 로직 자체는
 * 입력이 어디서 왔는지와 무관하다.
 */
import type { ParsedCsv } from "./csv";
import {
  filterAssertionsForSheet,
  findConflictingAssertions,
  type Assertion,
  type AssertionConflict,
} from "./spec-datasheet-check";

export type { AssertionConflict as PlanConflict };

export type Level = "OK" | "WARN" | "FATAL";

/** 계획 항목. `spec-datasheet-check`의 `Assertion`과 같은 모양이다(위 모듈 주석 참고) —
 *  같은 JSON 파일을 두 스킬이 그대로 주고받게 하려는 의도다. */
export type PlanItem = Assertion;

export type ChangeStatus = "NEW_ROW" | "CHANGE" | "NO_CHANGE" | "COLUMN_NOT_FOUND";

export interface WorkItem {
  readonly item: PlanItem;
  readonly status: ChangeStatus;
  readonly level: Level;
  /** 시트의 현재 값. 행 자체가 없으면(NEW_ROW) null, 컬럼을 못 찾으면(COLUMN_NOT_FOUND) null. */
  readonly currentValue: string | null;
  readonly detail: string;
}

/** 새로 추가해야 하는 행에 대해, 계획이 값을 안 준 컬럼 목록. 행을 새로 넣으려면 계획에 적힌
 *  컬럼만이 아니라 시트의 모든 컬럼을 채워야 하는데, 그걸 놓치면 빈 칸이 있는 행이 그대로
 *  업로드된다(datasheet-validate의 키 컬럼 공백·컬럼 수 불일치 FATAL로 뒤늦게 잡히거나,
 *  최악의 경우 통과해버린다). 그래서 지시서 단계에서 미리 알려준다. */
export interface NewRowGap {
  readonly id: string;
  readonly missingColumns: string[];
}

export { filterAssertionsForSheet as filterPlanForSheet };

/** 문자열이 달라도 둘 다 숫자로 읽히고 값이 같으면 "이미 반영됨"으로 본다(예: "3" vs "3.0").
 *  spec-datasheet-check의 valuesEqual과 같은 규칙 — 두 스킬이 같은 파일을 주고받으므로 판정
 *  기준이 갈라지면 안 된다. */
function valuesEqual(a: string, b: string): boolean {
  const x = a.trim();
  const y = b.trim();
  if (x === y) return true;
  if (x === "" || y === "") return false;
  const xn = Number(x);
  const yn = Number(y);
  return Number.isFinite(xn) && Number.isFinite(yn) && xn === yn;
}

function findColumnIndex(headers: readonly string[], name: string): number {
  return headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
}

export function buildWorkItem(csv: ParsedCsv, keyColumn: string, item: PlanItem): WorkItem {
  const keyIdx = findColumnIndex(csv.headers, keyColumn);
  if (keyIdx === -1) {
    return {
      item,
      status: "COLUMN_NOT_FOUND",
      level: "FATAL",
      currentValue: null,
      detail: `키 컬럼 "${keyColumn}"이 시트 헤더에 없습니다.`,
    };
  }
  const colIdx = findColumnIndex(csv.headers, item.column);
  if (colIdx === -1) {
    return {
      item,
      status: "COLUMN_NOT_FOUND",
      level: "FATAL",
      currentValue: null,
      detail: `컬럼 "${item.column}"이 시트 헤더에 없습니다 — 컬럼명 오타이거나 이 시트가 아닐 수 있습니다.`,
    };
  }
  // 키가 중복된 시트에서 첫 행만 보면, 뒤쪽 중복 행이 옛 값을 갖고 있어도 "작업 불필요"로
  // 넘어가버린다 — 그래서 일치하는 행을 전부 본다(spec-datasheet-check의 checkAssertion과
  // 같은 이유·같은 처리).
  const rows = csv.rows.filter((r) => (r[keyIdx] ?? "").trim() === item.id.trim());
  if (rows.length === 0) {
    return {
      item,
      status: "NEW_ROW",
      level: "OK",
      currentValue: null,
      detail: `${keyColumn}="${item.id}" 행을 새로 추가하고 "${item.column}"에 "${item.expected}"를 넣으세요.`,
    };
  }
  const currents = rows.map((r) => r[colIdx] ?? "");
  const distinct = [...new Set(currents)];
  const dupNote = rows.length > 1 ? ` ⚠️ 이 ${keyColumn} 값을 가진 행이 ${rows.length}개입니다 — 어느 행이 정본인지 확인하고 전부 반영하세요.` : "";
  const allSatisfied = currents.every((c) => valuesEqual(c, item.expected));

  if (allSatisfied) {
    return {
      item,
      status: "NO_CHANGE",
      level: rows.length > 1 ? "WARN" : "OK",
      currentValue: currents[0]!,
      detail: `${keyColumn}="${item.id}"의 "${item.column}"은 이미 "${currents[0]}" — 작업 불필요.${dupNote}`,
    };
  }
  const shown = distinct.map((v) => `"${v}"`).join(", ");
  return {
    item,
    status: "CHANGE",
    level: rows.length > 1 ? "WARN" : "OK",
    currentValue: currents[0]!,
    detail: `${keyColumn}="${item.id}"의 "${item.column}": ${shown} → "${item.expected}"로 변경.${dupNote}`,
  };
}

/** NEW_ROW로 판정된 id별로, 계획이 값을 안 준 컬럼을 찾는다. 키 컬럼은 id 자체로 채워지므로
 *  제외한다. 결과가 비어 있으면 그 행은 계획만으로 전부 채울 수 있다는 뜻이다. */
export function findNewRowGaps(
  csv: ParsedCsv,
  keyColumn: string,
  workItems: readonly WorkItem[],
): NewRowGap[] {
  const newRowIds = [...new Set(workItems.filter((w) => w.status === "NEW_ROW").map((w) => w.item.id))];
  return newRowIds.map((id) => {
    const covered = new Set(
      workItems
        .filter((w) => w.item.id === id)
        .map((w) => w.item.column.toLowerCase()),
    );
    covered.add(keyColumn.toLowerCase());
    const missingColumns = csv.headers.filter((h) => !covered.has(h.toLowerCase()));
    return { id, missingColumns };
  });
}

export function overallLevel(
  workItems: readonly WorkItem[],
  gaps: readonly NewRowGap[],
  conflicts: readonly AssertionConflict[] = [],
): Level {
  // 계획 자체가 모순이면(같은 대상에 다른 값) 어떤 지시서도 성립하지 않는다 — 시트 상태와
  // 무관하게 FATAL.
  if (conflicts.length > 0) return "FATAL";
  if (workItems.some((w) => w.level === "FATAL")) return "FATAL";
  if (workItems.some((w) => w.level === "WARN")) return "WARN";
  // 새 행에 값이 안 정해진 컬럼이 있으면 사람이 채워야 하므로 WARN — 지시서를 그대로 따라
  // 입력해도 빈 칸이 남는다는 뜻이다.
  if (gaps.some((g) => g.missingColumns.length > 0)) return "WARN";
  return "OK";
}

export interface PlanSummary {
  readonly workItems: WorkItem[];
  readonly gaps: NewRowGap[];
  /** --sheet-name과 안 맞아 이번 실행에서 건너뛴 계획 항목 수(다른 시트용 — 문제 아님). */
  readonly skipped: number;
  /** 계획 파일 자체의 모순(같은 대상에 다른 expected). 있으면 무조건 FATAL. */
  readonly conflicts: AssertionConflict[];
  readonly level: Level;
  readonly counts: Record<ChangeStatus, number>;
}

export function buildPlan(
  csv: ParsedCsv,
  keyColumn: string,
  plan: readonly PlanItem[],
  sheetName: string | null,
): PlanSummary {
  const applicable = filterAssertionsForSheet(plan, sheetName);
  const skipped = plan.length - applicable.length;
  const workItems = applicable.map((i) => buildWorkItem(csv, keyColumn, i));
  const gaps = findNewRowGaps(csv, keyColumn, workItems);
  const conflicts = findConflictingAssertions(applicable);
  const counts: Record<ChangeStatus, number> = {
    NEW_ROW: 0,
    CHANGE: 0,
    NO_CHANGE: 0,
    COLUMN_NOT_FOUND: 0,
  };
  for (const w of workItems) counts[w.status]++;
  return { workItems, gaps, skipped, conflicts, level: overallLevel(workItems, gaps, conflicts), counts };
}
