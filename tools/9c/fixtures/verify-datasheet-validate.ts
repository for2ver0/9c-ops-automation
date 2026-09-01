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
check("structural checks run without throwing", checks.length === 5, `got ${checks.length} checks`);
console.log(`(참고) 현재 ${TAB}: 헤더 ${csv.headers.length}칸 / ${csv.rows.length}행, 종합 판정 ${overallLevel(checks)}`);
for (const c of checks) {
  console.log(`  [${c.level}] ${c.name} — ${c.detail}`);
}

// --baseline-csv 회차 diff round-trip: 지금 받아온 라이브 CSV를 "직전 회차"로 재사용해서
// diffSheet가 실제 라이브 데이터 크기에서도 죽지 않고, 자기 자신과 비교했을 때 변경 0건을
// 정확히 보고하는지 확인한다. 이 시트의 실제 키 컬럼 이름을 가정하지 않고(위에서 이미
// CollectionSheet가 "id"라는 단순 헤더를 안 쓴다는 게 드러났다), 헤더의 첫 컬럼을 그대로
// 키로 써서 이 라운드트립 자체는 시트 구조와 무관하게 항상 유효하게 만든다.
const selfKeyColumn = csv.headers[0];
const selfChecks = runStructuralChecks(csv, { keyColumn: selfKeyColumn, baselineRows: null, baselineCsv: csv });
const diffCheck = selfChecks.find((c) => c.id === "baseline-diff");
check(
  "baseline-diff against itself reports zero changes on real live data",
  diffCheck !== undefined && diffCheck.detail.includes("추가 0행") && diffCheck.detail.includes("변경 0행"),
  diffCheck?.detail,
);

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log("\n모두 통과");
