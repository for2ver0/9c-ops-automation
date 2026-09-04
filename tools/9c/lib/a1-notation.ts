/**
 * a1-notation.ts — 구글 시트 A1 표기법 변환. `spec-to-datasheet-apply`가 실제로 쓸 셀 범위를
 * 계산할 때만 쓰는 순수 함수다(네트워크 없음).
 */

/** 0-based 컬럼 인덱스를 시트 컬럼 문자(A, B, ..., Z, AA, ...)로 바꾼다. */
export function columnIndexToLetter(index0: number): string {
  if (!Number.isInteger(index0) || index0 < 0) {
    throw new Error(`컬럼 인덱스는 0 이상의 정수여야 합니다: ${index0}`);
  }
  let n = index0 + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 시트 이름을 A1 범위에 안전하게 넣기 위해 작은따옴표로 감싼다(구글 시트 규칙 — 이름 안의
 *  작은따옴표는 두 배로 이스케이프). 공백·특수문자가 없는 이름도 항상 감싸면 안전하다. */
export function quoteSheetName(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

/** 0-based 컬럼 인덱스와 1-based 행 번호로 단일 셀의 A1 범위(`'시트명'!B7`)를 만든다. */
export function cellA1(sheetName: string, colIndex0: number, rowNumber1Based: number): string {
  if (!Number.isInteger(rowNumber1Based) || rowNumber1Based < 1) {
    throw new Error(`행 번호는 1 이상의 정수여야 합니다: ${rowNumber1Based}`);
  }
  return `${quoteSheetName(sheetName)}!${columnIndexToLetter(colIndex0)}${rowNumber1Based}`;
}
