#!/usr/bin/env bun
/**
 * datasheet-validate — CURRENTLY A PARTIAL BUILD. See
 * .claude/skills/datasheet-validate/SKILL.md and tools/9c/lib/datasheet-validate.ts for what's
 * in and out of scope. Short version: this checks CSV *structure* (the failure modes that
 * silently corrupt a `/table-patch` upload), not per-sheet schema/type/reference correctness —
 * that needs a lib9c schema mapping this pass didn't build.
 *
 * Usage:
 *   # 로컬 CSV 파일 검증
 *   bun run tools/9c/datasheet-validate.ts --csv ./MaterialItemSheet.csv --key-column Id
 *
 *   # 구글 시트 CSV export URL 직접 검증 (공개 시트만 — 인증 없음)
 *   bun run tools/9c/datasheet-validate.ts --url "https://docs.google.com/spreadsheets/d/<id>/gviz/tq?tqx=out:csv&sheet=<tab>" --key-column Id
 *
 *   # 직전 실행의 행 수를 기준값으로 넘겨 급감 검출
 *   bun run tools/9c/datasheet-validate.ts --csv ./MaterialItemSheet.csv --key-column Id --baseline-rows 421
 *
 *   # 직전 회차 CSV 전체를 넘겨 회차 간 diff(추가/삭제/변경 행·컬럼) 확인 — 행 수 급감
 *   # 검사도 이 파일에서 자동으로 기준값을 뽑아 씀(--baseline-rows 별도 지정 불필요)
 *   bun run tools/9c/datasheet-validate.ts --csv ./MaterialItemSheet.csv --key-column Id --baseline-csv ./MaterialItemSheet.prev.csv
 *
 *   bun run tools/9c/datasheet-validate.ts --csv ./x.csv --json
 */
import {
  parseCsv,
  runStructuralChecks,
  overallLevel,
  withGvizHeaders,
  type Check,
  type ParsedCsv,
} from "./lib/datasheet-validate";

interface Args {
  csvPath?: string;
  url?: string;
  keyColumn: string | null;
  baselineRows: number | null;
  baselineCsvPath?: string;
  /** 이 CSV가 어느 시트(탭)인지. 검증에는 안 쓰이고 --json 출력에 실려, datasheet-release-gate가
   *  manifest의 시트 이름과 대조하는 데 쓰인다(시트를 잘못 물려주는 사고 방지). */
  sheetName: string | null;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { keyColumn: null, baselineRows: null, sheetName: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--csv":
        args.csvPath = next();
        break;
      case "--url":
        args.url = next();
        break;
      case "--sheet-name":
        args.sheetName = next() ?? null;
        break;
      case "--key-column":
        args.keyColumn = next();
        break;
      case "--baseline-rows": {
        const v = Number(next());
        if (!Number.isFinite(v) || v < 0) throw new Error("--baseline-rows는 0 이상의 숫자여야 합니다.");
        args.baselineRows = v;
        break;
      }
      case "--baseline-csv":
        args.baselineCsvPath = next();
        break;
      case "--json":
        args.json = true;
        break;
      default:
        throw new Error(`알 수 없는 옵션: ${a}`);
    }
  }
  if (!args.csvPath && !args.url) throw new Error("--csv <경로> 또는 --url <CSV export URL> 중 하나가 필요합니다.");
  if (args.csvPath && args.url) throw new Error("--csv와 --url을 동시에 줄 수 없습니다.");
  return args;
}

async function readInput(args: Args): Promise<{ text: string; autoAddedHeaders: boolean }> {
  if (args.url) {
    const { url, added } = withGvizHeaders(args.url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
    return { text: await res.text(), autoAddedHeaders: added };
  }
  const file = Bun.file(args.csvPath!);
  if (!(await file.exists())) throw new Error(`파일을 찾을 수 없습니다: ${args.csvPath}`);
  return { text: await file.text(), autoAddedHeaders: false };
}

/**
 * `--url`에 sheet=가 있을 때, 같은 URL에서 sheet=만 뺀(=기본 탭) 응답을 받아온다.
 * 구글 gviz는 없는 탭 이름을 줘도 404가 아니라 기본 탭을 200으로 돌려주므로(2026-09-03 실측),
 * 두 응답이 같은지 비교해 탭 이름 오타를 잡기 위한 것이다. sheet=가 없거나 요청이 실패하면
 * null을 돌려주고, 그 경우 검사는 "해당 없음"/"대조 못 함"으로 처리된다.
 */
async function fetchDefaultTabText(url: string | undefined): Promise<string | null> {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!parsed.searchParams.has("sheet")) return null;
  parsed.searchParams.delete("sheet");
  // 요청 URL과 같은 조건으로 받아야 본문 대조가 의미 있으므로 여기도 headers=1을 맞춘다.
  const { url: defaultUrl } = withGvizHeaders(parsed.toString());
  try {
    const res = await fetch(defaultUrl);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** 위 대조가 의미 있는 경우(=URL에 sheet=가 있는 경우)에만 요청 본문을 넘긴다. */
function requestedTextForTabCheck(args: Args, text: string): string | null {
  if (!args.url) return null;
  try {
    return new URL(args.url).searchParams.has("sheet") ? text : null;
  } catch {
    return null;
  }
}

async function readBaselineCsv(path: string | undefined): Promise<ParsedCsv | null> {
  if (!path) return null;
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`--baseline-csv 파일을 찾을 수 없습니다: ${path}`);
  const csv = parseCsv(await file.text());
  if (csv.headers.length === 0) {
    throw new Error(`--baseline-csv 파일에서 헤더 행을 읽지 못했습니다: ${path}`);
  }
  return csv;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { text, autoAddedHeaders } = await readInput(args);
  const csv = parseCsv(text);

  if (csv.headers.length === 0) {
    throw new Error("CSV에서 헤더 행을 읽지 못했습니다 — 입력이 비어 있거나 형식이 CSV가 아닙니다.");
  }

  const baselineCsv = await readBaselineCsv(args.baselineCsvPath);
  const defaultTabText = await fetchDefaultTabText(args.url);
  const checks = runStructuralChecks(csv, {
    keyColumn: args.keyColumn,
    baselineRows: args.baselineRows,
    baselineCsv,
    requestedText: requestedTextForTabCheck(args, text),
    defaultTabText,
    url: args.url ?? null,
    autoAddedHeaders,
  });
  const summary = {
    source: args.url ?? args.csvPath!,
    sheetName: args.sheetName,
    headerCount: csv.headers.length,
    rowCount: csv.rows.length,
    level: overallLevel(checks),
    checks,
  };

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printHumanReadable(summary);
  }

  process.exit(summary.level === "FATAL" ? 1 : 0);
}

function printHumanReadable(summary: {
  source: string;
  headerCount: number;
  rowCount: number;
  level: string;
  checks: Check[];
}) {
  console.log(`전체 상태: ${summary.level}`);
  console.log(`소스: ${summary.source}`);
  console.log(`헤더 ${summary.headerCount}칸 / 데이터 ${summary.rowCount}행`);
  console.log("");
  for (const c of summary.checks) {
    const mark = c.ok ? "OK   " : c.level === "FATAL" ? "FATAL" : "WARN ";
    console.log(`[${mark}] ${c.name} — ${c.detail}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
