/**
 * lib9c-tablecsv.ts — `planetarium/lib9c`의 `Lib9c/TableCSV/<시트명>.csv`를 읽는다. 이 경로는
 * lib9c가 실제로 로드하는 밸런스 데이터 원본이고(2026-09-04 실측: `SkillSheet.csv` 등 140개,
 * 파일명이 시트 이름과 정확히 일치, LF만·따옴표 없음), `datasheet-to-csv`가 구글 시트의 현재
 * 값과 대조할 "before"로 쓴다.
 *
 * gviz와 달리 이 원본은 애초에 따옴표를 안 쓰고 타입 추론도 없다 — `raw.githubusercontent.com`
 * 무인증 GET으로 원문 그대로 읽는다.
 */
import { parseCsv, type ParsedCsv } from "./csv";

export function lib9cTableCsvUrl(sheetName: string, ref: string): string {
  return `https://raw.githubusercontent.com/planetarium/lib9c/${encodeURIComponent(ref)}/Lib9c/TableCSV/${encodeURIComponent(sheetName)}.csv`;
}

export interface Lib9cCsvResult {
  /** 시트가 lib9c에 아직 없으면(404) null — 에러가 아니라 "전부 신규"라는 뜻. */
  readonly csv: ParsedCsv | null;
  readonly rawText: string | null;
}

/** 얇은 네트워크 래퍼 — 테스트 제외(기존 관례와 같은 위치). */
export async function fetchLib9cCsv(sheetName: string, ref: string): Promise<Lib9cCsvResult> {
  const url = lib9cTableCsvUrl(sheetName, ref);
  const res = await fetch(url);
  if (res.status === 404) return { csv: null, rawText: null };
  if (!res.ok) throw new Error(`lib9c TableCSV를 읽지 못했습니다(${url}): ${res.status}`);
  const rawText = await res.text();
  return { csv: parseCsv(rawText), rawText };
}
