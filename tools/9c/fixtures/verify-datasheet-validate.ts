#!/usr/bin/env bun
/**
 * Live smoke test for datasheet-validate — confirms the balance sheet endpoint confirmed
 * public in docs/9c-update-automation-permission-request.md (① 항목, 2026-08-31 확인) is
 * still reachable without auth and comes back as parseable CSV. Unlike the unit tests (fixed
 * strings, exact failure-mode fixtures), this hits the real network, so it only asserts
 * invariants that should hold regardless of the sheet's current content (not exact row/column
 * counts, which change every balance patch).
 */
import { parseCsv, runStructuralChecks, overallLevel } from "../lib/datasheet-validate";

let failed = 0;

function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`PASS  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const SHEET_ID = "1Di903g3_mxdDd6gZuNhczE4MXwFI-lWnOqzuVPbGM7k";
const TAB = "CollectionSheet"; // 권한 요청 문서 ①에서 무인증 200으로 확인된 데이터 탭 중 하나
const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${TAB}`;

const res = await fetch(url);
check("balance sheet CSV export responds 200 without auth", res.ok, `got HTTP ${res.status}`);

const text = await res.text();
const csv = parseCsv(text);
check("parses to at least one header column", csv.headers.length > 0, `got ${csv.headers.length}`);
check("parses to at least one data row", csv.rows.length > 0, `got ${csv.rows.length}`);

const checks = runStructuralChecks(csv, { keyColumn: "id", baselineRows: null });
check("structural checks run without throwing", checks.length === 4, `got ${checks.length} checks`);
console.log(`(참고) 현재 ${TAB}: 헤더 ${csv.headers.length}칸 / ${csv.rows.length}행, 종합 판정 ${overallLevel(checks)}`);
for (const c of checks) {
  console.log(`  [${c.level}] ${c.name} — ${c.detail}`);
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log("\n모두 통과");
