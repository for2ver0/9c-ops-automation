/**
 * google-sheets-values.ts — Sheets API `values.get` 응답(2차원 문자열 배열)을 기존
 * `ParsedCsv` 모양으로 바꾸는 어댑터.
 *
 * 이 변환으로 만든 `ParsedCsv`에만 "rows의 0-based 인덱스 r → 실제 시트 행 번호 r + 2"라는
 * 불변식이 성립한다(헤더가 1행, 데이터는 2행부터). `./csv.ts`의 `parseCsv`(gviz CSV export
 * 기반)로 만든 `ParsedCsv`에는 이 불변식이 성립하지 않는다 — gviz는 값을 전부 따옴표로 감싸고
 * 컬럼 타입을 추론해 타입에 안 맞는 값을 조용히 비우는 등, "지금 실제로 시트에 뭐가 들어있는지"의
 * 정본이 아니기 때문이다(datasheet-validate.ts가 실측으로 확인한 함정). 그래서
 * `spec-to-datasheet-apply`는 `--apply` 시 로컬 CSV를 버리고 이 함수로 새로 읽은 값만 쓴다.
 */
import type { ParsedCsv } from "./csv";

export function sheetValuesToParsedCsv(values: readonly (readonly string[])[]): ParsedCsv {
  if (values.length === 0) return { headers: [], rows: [] };
  const [headerRow, ...dataRows] = values;
  const headers = [...headerRow!];
  const width = headers.length;
  // Sheets API는 각 행의 마지막 비어있지 않은 셀까지만 배열을 채워 돌려준다 — 짧은 행은 헤더
  // 길이만큼 ""로 패딩해야 buildWorkItem 등 기존 컬럼 인덱스 조회가 그대로 맞는다.
  const rows = dataRows.map((r) => {
    const padded = [...r];
    while (padded.length < width) padded.push("");
    return padded;
  });
  return { headers, rows };
}
