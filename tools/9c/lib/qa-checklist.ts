/**
 * qa-checklist — CURRENTLY A PARTIAL BUILD. 설계 문서("나인 크로니클 업데이트 자동화 설계")
 * §3 6단계는 이 스킬의 입력을 "시트 diff + 기능 범위"로, 역할을 "회귀 테스트 체크리스트·
 * 케이스 이슈"로 그린다. 실제로 만들어보니 이 둘의 성격이 갈렸다:
 *
 *   - **"시트 diff"** — 두 CSV(전/후)를 키 컬럼 기준으로 대조해 추가/삭제/변경된 행과, 어떤
 *     컬럼이 바뀌었는지를 계산하는 건 **스키마 지식이 필요 없다.** 이번에 만든 것.
 *   - **"기능 범위" 매핑** — "이 시트가 바뀌면 어떤 게임 기능을 테스트해야 하는지"
 *     (예: SkillSheet 변경 → 스킬 데미지 QA, MaterialItemSheet 변경 → 제작 QA)는 시트별로
 *     다른 lib9c 도메인 지식이 필요하다. `datasheet-validate`가 "시트 간 참조 ID 검증"을
 *     미룬 것과 같은 이유(부록 A-1)로 이번 착수에 넣지 않았다.
 *
 * 그래서 이 모듈이 실제로 내는 체크리스트는 "이 시트의 Id N번, 컬럼 X가 A→B로 바뀌었다"
 * 수준의 **사실 목록**이다. "그래서 뭘 테스트해야 하는지"는 QA 담당자가 채운다 — 이 모듈은
 * 어디를 봐야 하는지 정확히 짚어주는 것까지만 한다.
 *
 * `diffSheet`는 이후 `datasheet-validate.ts`의 "회차 간 시트 diff" 검사에도 그대로
 * 재사용된다(중복 구현 안 함). CSV 파서(`parseCsv`)는 `./csv`에 있다 — 이 모듈과
 * datasheet-validate가 서로의 함수를 가져다 쓰는 순환 참조를 만들지 않기 위해서다.
 */
import { parseCsv, type ParsedCsv } from "./csv";

export { parseCsv };
export type { ParsedCsv };

export interface ColumnSetChange {
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

/** 두 헤더 목록을 비교해 추가/삭제된 컬럼을 찾는다. 순서 변경은 무시(값 비교엔 영향 없음). */
export function diffHeaders(before: readonly string[], after: readonly string[]): ColumnSetChange {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((h) => !beforeSet.has(h)),
    removed: before.filter((h) => !afterSet.has(h)),
  };
}

export interface ChangedField {
  readonly column: string;
  readonly before: string;
  readonly after: string;
}

export interface ChangedRow {
  readonly key: string;
  readonly fields: readonly ChangedField[];
}

export interface SheetDiff {
  readonly keyColumn: string;
  readonly columnChanges: ColumnSetChange;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly ChangedRow[];
  /** 같은 파일 안에서 키 값이 중복된 경우 — 마지막 행이 diff에 쓰였다는 뜻이므로 결과를
   *  전적으로 신뢰하기 전에 원본을 확인해야 한다(datasheet-validate의 중복 헤더 검사와
   *  같은 계열의 함정이지만 여기선 행 키 기준). */
  readonly duplicateKeysBefore: readonly string[];
  readonly duplicateKeysAfter: readonly string[];
}

function indexByKey(csv: ParsedCsv, keyColIdx: number): { map: Map<string, Record<string, string>>; duplicates: string[] } {
  const map = new Map<string, Record<string, string>>();
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const row of csv.rows) {
    const key = row[keyColIdx];
    if (key === undefined || key.trim().length === 0) continue; // 키 공백 행은 datasheet-validate가 별도로 잡는다
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
    const record: Record<string, string> = {};
    csv.headers.forEach((h, i) => {
      record[h] = row[i] ?? "";
    });
    map.set(key, record);
  }
  return { map, duplicates };
}

/**
 * 키 컬럼 기준으로 두 CSV를 대조한다. 값 비교는 양쪽에 공통으로 존재하는 컬럼에서만
 * 이뤄진다 — 컬럼 자체의 추가/삭제는 `columnChanges`로 별도 보고한다.
 */
export function diffSheet(before: ParsedCsv, after: ParsedCsv, keyColumn: string): SheetDiff {
  const beforeIdx = before.headers.findIndex((h) => h.toLowerCase() === keyColumn.toLowerCase());
  const afterIdx = after.headers.findIndex((h) => h.toLowerCase() === keyColumn.toLowerCase());
  if (beforeIdx === -1 || afterIdx === -1) {
    const missing = beforeIdx === -1 && afterIdx === -1 ? "양쪽 모두" : beforeIdx === -1 ? "이전(before) 쪽" : "이후(after) 쪽";
    throw new Error(`키 컬럼 "${keyColumn}"이 ${missing} 헤더에 없습니다 — diff를 계산할 수 없습니다.`);
  }

  const columnChanges = diffHeaders(before.headers, after.headers);
  const commonColumns = before.headers.filter((h) => after.headers.includes(h));

  const { map: beforeMap, duplicates: duplicateKeysBefore } = indexByKey(before, beforeIdx);
  const { map: afterMap, duplicates: duplicateKeysAfter } = indexByKey(after, afterIdx);

  const added: string[] = [];
  const removed: string[] = [];
  const changed: ChangedRow[] = [];

  for (const key of afterMap.keys()) {
    if (!beforeMap.has(key)) added.push(key);
  }
  for (const key of beforeMap.keys()) {
    if (!afterMap.has(key)) removed.push(key);
  }
  for (const [key, afterRow] of afterMap) {
    const beforeRow = beforeMap.get(key);
    if (!beforeRow) continue;
    const fields: ChangedField[] = [];
    for (const col of commonColumns) {
      if (col === keyColumn) continue;
      const b = beforeRow[col] ?? "";
      const a = afterRow[col] ?? "";
      if (b !== a) fields.push({ column: col, before: b, after: a });
    }
    if (fields.length > 0) changed.push({ key, fields });
  }

  added.sort();
  removed.sort();
  changed.sort((a, b) => a.key.localeCompare(b.key));

  return { keyColumn, columnChanges, added, removed, changed, duplicateKeysBefore, duplicateKeysAfter };
}

// ---------------------------------------------------------------------------------------
// 체크리스트 텍스트 생성
// ---------------------------------------------------------------------------------------

const SAMPLE_LIMIT = 20;

function sampleList(items: readonly string[]): string {
  const shown = items.slice(0, SAMPLE_LIMIT).join(", ");
  const more = items.length > SAMPLE_LIMIT ? ` 외 ${items.length - SAMPLE_LIMIT}건` : "";
  return shown + more;
}

/** 시트 하나의 diff를 사람이 훑을 수 있는 체크리스트 줄 목록으로 바꾼다. "무엇을 테스트해야
 *  하는지"가 아니라 "무엇이 바뀌었는지"만 정확히 짚는다 — 판단은 QA 담당자 몫(모듈 doc 참고). */
export function buildQaChecklist(sheetName: string, diff: SheetDiff): string[] {
  const items: string[] = [];

  if (diff.columnChanges.added.length > 0) {
    items.push(`[ ] ${sheetName}: 컬럼 추가됨 — ${diff.columnChanges.added.join(", ")} (신규 컬럼의 기본값/영향 범위 확인)`);
  }
  if (diff.columnChanges.removed.length > 0) {
    items.push(`[ ] ${sheetName}: 컬럼 삭제됨 — ${diff.columnChanges.removed.join(", ")} (이 컬럼을 참조하던 코드/다른 시트가 없는지 확인)`);
  }

  if (diff.added.length > 0) {
    items.push(`[ ] ${sheetName}: 신규 행 ${diff.added.length}건 추가 — ${sampleList(diff.added)} (신규 항목이 게임 내에서 정상 동작하는지 확인)`);
  }
  if (diff.removed.length > 0) {
    items.push(`[ ] ${sheetName}: 행 ${diff.removed.length}건 삭제 — ${sampleList(diff.removed)} (삭제된 항목을 참조하던 다른 시트/저장 데이터가 깨지지 않는지 확인)`);
  }

  for (const row of diff.changed.slice(0, SAMPLE_LIMIT)) {
    const fieldDesc = row.fields.map((f) => `${f.column} "${f.before}"→"${f.after}"`).join(", ");
    items.push(`[ ] ${sheetName} ${diff.keyColumn}=${row.key}: ${fieldDesc}`);
  }
  if (diff.changed.length > SAMPLE_LIMIT) {
    items.push(`[ ] ${sheetName}: 그 외 ${diff.changed.length - SAMPLE_LIMIT}건의 변경 행이 더 있습니다 — --json으로 전체 목록 확인.`);
  }

  if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0 && diff.columnChanges.added.length === 0 && diff.columnChanges.removed.length === 0) {
    items.push(`[x] ${sheetName}: 변경 없음.`);
  }

  if (diff.duplicateKeysBefore.length > 0) {
    items.push(`[!] ${sheetName}: 이전(before) 파일에 중복된 ${diff.keyColumn} 발견 — ${sampleList(diff.duplicateKeysBefore)} (diff는 마지막 값만 반영했습니다, 원본 확인 필요)`);
  }
  if (diff.duplicateKeysAfter.length > 0) {
    items.push(`[!] ${sheetName}: 이후(after) 파일에 중복된 ${diff.keyColumn} 발견 — ${sampleList(diff.duplicateKeysAfter)} (diff는 마지막 값만 반영했습니다, 원본 확인 필요)`);
  }

  return items;
}
