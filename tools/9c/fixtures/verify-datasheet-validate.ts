#!/usr/bin/env bun
/**
 * Live smoke test for datasheet-validate — confirms the balance sheet endpoint confirmed
 * public in docs/9c-update-automation-permission-request.md (① 항목, 2026-08-31 확인) is
 * still reachable without auth and comes back as parseable CSV. Unlike the unit tests (fixed
 * strings, exact failure-mode fixtures), this hits the real network, so it only asserts
 * invariants that should hold regardless of the sheet's current content (not exact row/column
 * counts, which change every balance patch).
 *
 * ⚠️ 2026-09-02 정정: 이전에는 `CollectionSheet` 탭으로 이 스모크 테스트를 돌렸는데, 실측
 * 해보니 그 탭은 행/열이 전치된(각 헤더 칸에 "id 1 2 3 ... 101"처럼 그 컬럼 전체 값이
 * 공백으로 뭉쳐 들어가는) 비정형 구조였다 — SKILL.md 예시가 가정하는 "행 하나 = 항목 하나,
 * Id가 첫 컬럼" 구조가 아니다. 그 결과 `--key-column id`가 매번 헤더를 못 찾아 WARN으로
 * 건너뛰었는데, 이 스크립트는 `checks.length === 5`(예외 없이 실행됐는지)만 확인하고
 * 개별 항목의 결과는 검증하지 않아서, "키 컬럼 공백" 검사가 사실상 한 번도 라이브 데이터로
 * 정상 실행된 적이 없는데도 "모두 통과"가 찍혔다. `MaterialItemSheet`(SKILL.md 예시가 실제로
 * 쓰는 탭)로 바꿔서 정상적인 Id 컬럼 구조에서 이 검사가 실제로 OK를 내는지까지 단언한다.
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
const TAB = "MaterialItemSheet"; // SKILL.md 예시가 실제로 쓰는 탭 — 행 하나 = 항목 하나, id가 첫 컬럼인 정상 구조(실측 확인)
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

// 핵심: "키 컬럼 공백" 검사가 문서 예시(--key-column Id)와 같은 조건에서 라이브 데이터로
// 실제 OK를 내는지 직접 단언한다 — 이게 없으면 이 검사가 예외 없이 "실행됐다"는 것만 알 뿐,
// 실제로 "Id" 헤더를 찾아서 제대로 동작했다는 보장이 없다(이 스크립트가 처음 추가된
// 2026-09-01부터 CollectionSheet를 썼을 때 WARN-스킵을 "통과"로 오인해온 상태였다).
const keyColumnCheck = checks.find((c) => c.id === "key-column-non-empty");
check(
  "key-column-non-empty actually finds the Id header and returns OK on real live data (not a silent skip)",
  keyColumnCheck?.level === "OK",
  keyColumnCheck?.detail,
);

// --baseline-csv 회차 diff round-trip: 지금 받아온 라이브 CSV를 "직전 회차"로 재사용해서
// diffSheet가 실제 라이브 데이터 크기에서도 죽지 않고, 자기 자신과 비교했을 때 변경 0건을
// 정확히 보고하는지 확인한다.
const selfChecks = runStructuralChecks(csv, { keyColumn: "id", baselineRows: null, baselineCsv: csv });
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
