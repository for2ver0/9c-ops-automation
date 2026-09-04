/**
 * spec-to-datasheet-apply.ts — 사람이 승인한 spec-to-datasheet 작업 지시서 중, 자동으로 써도
 * 안전한 항목만 골라낸다(순수 함수, 네트워크 없음). 실제 Sheets API 호출은
 * `tools/9c/spec-to-datasheet-apply.ts`(CLI)에서만 한다.
 *
 * "안전한 항목"의 기준은 엄격하다 — level이 OK인 CHANGE, 그리고 gap이 없는 NEW_ROW만이다.
 * WARN(병합형 시트로 의심되는 중복 키, 컬럼이 안 채워진 새 행)과 FATAL(컬럼 없음, 계획 모순)은
 * 사람이 시트 원본을 보고 직접 판단해야 하는 항목이라 이 필터를 절대 통과시키지 않는다 —
 * `buildWorkItem`/`findNewRowGaps`가 이미 그렇게 판정한 이유(병합형 시트를 자동으로 뭉개는
 * 사고, 빈 칸이 남은 행이 그대로 올라가는 사고)를 여기서 다시 무시하면 안 되기 때문이다.
 */
import type { ParsedCsv } from "./csv";
import type { PlanItem, PlanSummary, WorkItem } from "./spec-to-datasheet";

export interface CellUpdate {
  readonly sheet: string;
  readonly id: string;
  readonly column: string;
  /** csv.rows의 0-based 인덱스. `sheetValuesToParsedCsv`로 만든 csv일 때만 "실제 행 번호 - 2"와 같다. */
  readonly rowIndex0: number;
  readonly colIndex0: number;
  readonly before: string;
  readonly after: string;
}

export interface RowInsert {
  readonly sheet: string;
  readonly id: string;
  /** headers와 같은 순서. */
  readonly values: string[];
}

export interface WriteTargets {
  readonly cellUpdates: CellUpdate[];
  readonly rowInserts: RowInsert[];
  /** WARN·FATAL·gap 있는 NEW_ROW — 자동으로 쓰지 않고 사람에게 그대로 보여줄 항목. */
  readonly skipped: WorkItem[];
}

function findColumnIndex(headers: readonly string[], name: string): number {
  return headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
}

/** 새 행 하나를 헤더 순서에 맞춘 값 배열로 조립한다. 키 컬럼엔 id를 넣는다. */
export function buildRowValues(
  headers: readonly string[],
  keyColumn: string,
  id: string,
  itemsForId: readonly PlanItem[],
): string[] {
  const values = headers.map(() => "");
  const keyIdx = findColumnIndex(headers, keyColumn);
  if (keyIdx !== -1) values[keyIdx] = id;
  for (const item of itemsForId) {
    const idx = findColumnIndex(headers, item.column);
    if (idx !== -1) values[idx] = item.expected;
  }
  return values;
}

export function selectWriteTargets(
  csv: ParsedCsv,
  keyColumn: string,
  summary: PlanSummary,
  sheetName: string,
): WriteTargets {
  const keyIdx = findColumnIndex(csv.headers, keyColumn);
  const gapById = new Map(summary.gaps.map((g) => [g.id, g.missingColumns.length === 0]));

  const cellUpdates: CellUpdate[] = [];
  const skipped: WorkItem[] = [];
  const newRowIdsClean = new Set<string>();
  const newRowItemsById = new Map<string, PlanItem[]>();

  for (const w of summary.workItems) {
    if (w.level === "OK" && w.status === "CHANGE") {
      const colIdx = findColumnIndex(csv.headers, w.item.column);
      const rowIndex0 = keyIdx === -1 ? -1 : csv.rows.findIndex((r) => (r[keyIdx] ?? "").trim() === w.item.id.trim());
      if (colIdx === -1 || rowIndex0 === -1) {
        // 재조회 시점에 컬럼/행이 사라진 경우 — 승인 이후 시트가 바뀐 것이므로 자동 반영하지
        // 않고 사람에게 넘긴다.
        skipped.push(w);
        continue;
      }
      cellUpdates.push({
        sheet: sheetName,
        id: w.item.id,
        column: w.item.column,
        rowIndex0,
        colIndex0: colIdx,
        before: w.currentValue ?? "",
        after: w.item.expected,
      });
      continue;
    }
    if (w.status === "NEW_ROW" && w.level === "OK" && gapById.get(w.item.id) === true) {
      newRowIdsClean.add(w.item.id);
      const list = newRowItemsById.get(w.item.id) ?? [];
      list.push(w.item);
      newRowItemsById.set(w.item.id, list);
      continue;
    }
    // NO_CHANGE(OK)는 쓸 게 없으므로 사람에게 보고할 항목(skipped)에도 넣지 않는다.
    if (w.status === "NO_CHANGE" && w.level === "OK") continue;
    skipped.push(w);
  }

  const rowInserts: RowInsert[] = [...newRowIdsClean].map((id) => ({
    sheet: sheetName,
    id,
    values: buildRowValues(csv.headers, keyColumn, id, newRowItemsById.get(id)!),
  }));

  return { cellUpdates, rowInserts, skipped };
}

/** 새 행 삽입 로그 항목의 `column` 자리에 쓰는 센티널 — 셀 하나가 아니라 행 전체를 추가했다는 뜻. */
export const NEW_ROW_COLUMN_SENTINEL = "*new-row*";

export interface SheetWriteLogEntry {
  readonly observedAt: string;
  readonly sheet: string;
  readonly id: string;
  /** 셀 변경이면 실제 컬럼명, 새 행 삽입이면 `NEW_ROW_COLUMN_SENTINEL`. */
  readonly column: string;
  /** 새 행 삽입은 이전 값이 없으므로 null. */
  readonly before: string | null;
  readonly after: string;
  /** Sheets API 응답이 알려준 실제 반영 위치(A1 표기) — 추정값이 아니다. */
  readonly range: string;
  readonly planFile: string;
}

export function isSheetWriteLogEntry(v: unknown): v is SheetWriteLogEntry {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.observedAt === "string" &&
    typeof o.sheet === "string" &&
    typeof o.id === "string" &&
    typeof o.column === "string" &&
    (o.before === null || typeof o.before === "string") &&
    typeof o.after === "string" &&
    typeof o.range === "string" &&
    typeof o.planFile === "string"
  );
}
