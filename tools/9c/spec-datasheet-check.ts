#!/usr/bin/env bun
/**
 * spec-datasheet-check — 기획서 기반 assertions(사람/에이전트가 기획서를 읽고 정리한
 * "이 시트의 이 행의 이 컬럼은 이 값이어야 한다" 목록)와 실제로 내보낸 밸런스 시트 CSV를
 * 대조한다. 자세한 설계 배경은 .claude/skills/spec-datasheet-check/SKILL.md,
 * tools/9c/lib/spec-datasheet-check.ts 참고.
 *
 * Usage:
 *   bun run tools/9c/spec-datasheet-check.ts --csv ./SkillSheet.csv --assertions ./assertions.json --key-column Id
 *   bun run tools/9c/spec-datasheet-check.ts --csv ./SkillSheet.csv --assertions ./assertions.json --sheet-name SkillSheet --json
 *
 * assertions.json 형식:
 *   [
 *     { "sheet": "SkillSheet", "id": "10113000", "column": "Cooldown", "expected": "3", "note": "궁수 스킬 쿨타임 5->3" }
 *   ]
 */
import { parseCsv } from "./lib/csv";
import {
  checkAssertions,
  overallLevel,
  type Assertion,
  type AssertionConflict,
  type AssertionResult,
} from "./lib/spec-datasheet-check";

interface Args {
  csvPath?: string;
  assertionsPath?: string;
  keyColumn: string;
  sheetName: string | null;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { keyColumn: "Id", sheetName: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--csv":
        args.csvPath = next();
        break;
      case "--assertions":
        args.assertionsPath = next();
        break;
      case "--key-column":
        args.keyColumn = next()!;
        break;
      case "--sheet-name":
        args.sheetName = next()!;
        break;
      case "--json":
        args.json = true;
        break;
      default:
        throw new Error(`알 수 없는 옵션: ${a}`);
    }
  }
  if (!args.csvPath) throw new Error("--csv <경로>가 필요합니다.");
  if (!args.assertionsPath) throw new Error("--assertions <경로.json>이 필요합니다.");
  return args;
}

async function readAssertions(path: string): Promise<Assertion[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`assertions 파일을 찾을 수 없습니다: ${path}`);
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch (e) {
    throw new Error(`assertions 파일이 올바른 JSON이 아닙니다: ${e instanceof Error ? e.message : e}`);
  }
  if (!Array.isArray(raw)) throw new Error("assertions 파일은 JSON 배열이어야 합니다.");
  raw.forEach((a, i) => {
    if (!a || typeof a !== "object" || typeof (a as Assertion).id !== "string" ||
        typeof (a as Assertion).column !== "string" || typeof (a as Assertion).expected !== "string") {
      throw new Error(`assertions[${i}]에 id/column/expected(전부 문자열)가 필요합니다.`);
    }
  });
  return raw as Assertion[];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const csvFile = Bun.file(args.csvPath!);
  if (!(await csvFile.exists())) throw new Error(`CSV 파일을 찾을 수 없습니다: ${args.csvPath}`);
  const csv = parseCsv(await csvFile.text());
  if (csv.headers.length === 0) throw new Error("CSV에서 헤더 행을 읽지 못했습니다.");

  const assertions = await readAssertions(args.assertionsPath!);
  const { results, skipped, conflicts } = checkAssertions(csv, args.keyColumn, assertions, args.sheetName);

  const baseLevel = results.length === 0 ? "OK" : overallLevel(results);
  const summary = {
    source: args.csvPath!,
    sheetName: args.sheetName,
    totalAssertions: assertions.length,
    applicable: results.length,
    skipped,
    // 입력 파일이 모순되면 어떤 시트 값으로도 만족시킬 수 없으므로 결과와 무관하게 FATAL.
    level: conflicts.length > 0 ? "FATAL" : baseLevel,
    conflicts,
    results,
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
  sheetName: string | null;
  totalAssertions: number;
  applicable: number;
  skipped: number;
  level: string;
  conflicts: AssertionConflict[];
  results: AssertionResult[];
}) {
  console.log(`전체 상태: ${summary.level}`);
  console.log(`소스: ${summary.source}${summary.sheetName ? ` (시트: ${summary.sheetName})` : ""}`);
  console.log(`assertion ${summary.totalAssertions}건 중 이 시트에 해당 ${summary.applicable}건, 건너뜀(다른 시트용) ${summary.skipped}건`);
  console.log("");
  if (summary.conflicts.length > 0) {
    console.log("## 입력 파일 자체의 모순 (시트를 어떻게 고쳐도 만족 불가)");
    for (const c of summary.conflicts) {
      console.log(`[FATAL] ${c.id}의 "${c.column}"에 서로 다른 기대값: ${c.expectedValues.map((v) => `"${v}"`).join(" vs ")}`);
    }
    console.log("");
  }
  for (const r of summary.results) {
    const mark = r.level === "OK" ? "OK   " : r.level === "WARN" ? "WARN " : "FATAL";
    console.log(`[${mark}] ${r.detail}`);
  }
  if (summary.applicable === 0) {
    console.log("(이 시트에 해당하는 assertion이 없습니다 — 기획서가 이 시트를 안 건드렸다는 뜻일 수 있음, 그 자체는 문제 아님)");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
