#!/usr/bin/env bun
/**
 * Live smoke test for datasheet-validate — confirms the balance sheet endpoint confirmed
 * public in docs/9c-update-automation-permission-request.md (① 항목, 2026-08-31 확인) is
 * still reachable without auth and comes back as parseable CSV. Unlike the unit tests (fixed
 * strings, exact failure-mode fixtures), this hits the real network, so it only asserts
 * invariants that should hold regardless of the sheet's current content (not exact row/column
 * counts, which change every balance patch).
 *
 * ⚠️ 2026-09-02 정정: 이전에는 `CollectionSheet` 탭으로 이 스모크 테스트를 돌렸는데, 각 헤더
 * 칸에 "id 1 2 3 ... 101"처럼 값이 공백으로 뭉쳐 들어와서 `--key-column id`가 매번 헤더를
 * 못 찾아 WARN으로 건너뛰었다. 그런데 이 스크립트는 `checks.length === 5`(예외 없이
 * 실행됐는지)만 확인하고 개별 항목 결과는 검증하지 않아서, "키 컬럼 공백" 검사가 사실상 한
 * 번도 라이브 데이터로 정상 실행된 적이 없는데도 "모두 통과"가 찍혔다. 그래서
 * `MaterialItemSheet`로 바꾸고 개별 항목까지 단언하도록 고쳤다.
 *
 * ⚠️⚠️ 2026-09-03 재정정 — 위 진단의 **원인 분석이 틀렸다.** 그때는 `CollectionSheet`가
 * "행/열이 전치된 비정형 구조"라고 결론지었는데, 실제로는 **시트가 아니라 URL 문제**였다.
 * gviz는 헤더 행 수를 추측하는데 `headers=1`을 안 주면 추측에 실패해 데이터 행들을 헤더 한
 * 줄로 접어버린다:
 *     ...&sheet=CollectionSheet            → 13행  (헤더가 "id 1 2 3 …"로 뭉침)
 *     ...&sheet=CollectionSheet&headers=1  → 895행 (헤더 "id","item_id1",… 정상)
 * 즉 그 탭은 완전히 정상적인 테이블이고, 우리가 882행이 사라진 CSV를 보고 있었을 뿐이다.
 * SKILL.md가 안내하던 URL 패턴에 이 파라미터가 빠져 있던 게 근본 원인이라 문서·도구를 함께
 * 고쳤고(`checkGvizHeadersParam`), 이 스크립트의 URL에도 `headers=1`을 붙였다.
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
// headers=1 필수 — 없으면 탭에 따라 데이터 행이 헤더로 접혀 대량 유실된다(위 2026-09-03 재정정).
const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${TAB}&headers=1`;

const res = await fetch(url);
check("balance sheet CSV export responds 200 without auth", res.ok, `got HTTP ${res.status}`);

const text = await res.text();
const csv = parseCsv(text);
check("parses to at least one header column", csv.headers.length > 0, `got ${csv.headers.length}`);
check("parses to at least one data row", csv.rows.length > 0, `got ${csv.rows.length}`);

// rawText는 반드시 넘긴다 — 안 넘기면 `csv-quoting`이 "원문을 받지 못해 건너뜁니다"라는
// **OK**를 내고(gviz 응답은 실제로 전부 따옴표다), 내부 fullyQuoted도 false가 되어 CLI와 다른
// 행 집합으로 판정한다. 라이브 대조가 목적인 스크립트가 CLI와 다르게 동작하면 의미가 없다.
const checks = runStructuralChecks(csv, { keyColumn: "id", baselineRows: null, url, rawText: text });
// 개수 대신 **검사 id 집합**을 단언한다 — 예전엔 `checks.length === 5`로 박아둬서 검사가
// 늘어날 때마다(2026-09-03에 4종 추가) 내용과 무관하게 깨졌고, 무엇이 빠졌는지도 알려주지
// 않았다. 집합으로 보면 "어느 검사가 사라졌는지"가 바로 나온다.
const EXPECTED_CHECK_IDS = [
  "duplicate-headers",
  "empty-headers",
  "row-column-counts",
  "has-data-rows",
  "key-column-non-empty",
  "duplicate-key-values",
  "row-count-vs-baseline",
  "baseline-diff",
  "requested-tab-fallback",
  "gviz-headers-param",
  "lib9c-skipped-rows",
  "csv-quoting",
].sort();
const actualIds = checks.map((c) => c.id).sort();
const missing = EXPECTED_CHECK_IDS.filter((id) => !actualIds.includes(id));
// 양방향으로 본다 — 예전엔 missing만 봐서, 검사를 새로 추가하면 이 목록이 낡아도 통과했다
// (2026-09-03에 lib9c-skipped-rows·csv-quoting 2종이 빠진 채 통과하고 있었다).
const unexpected = actualIds.filter((id) => !EXPECTED_CHECK_IDS.includes(id));
check(
  "the live check id set matches this script exactly (neither missing nor undeclared)",
  missing.length === 0 && unexpected.length === 0,
  [missing.length ? `missing: ${missing.join(", ")}` : "", unexpected.length ? `undeclared: ${unexpected.join(", ")}` : ""]
    .filter(Boolean)
    .join(" / ") || undefined,
);
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
const selfChecks = runStructuralChecks(csv, { keyColumn: "id", baselineRows: null, baselineCsv: csv, rawText: text });
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
