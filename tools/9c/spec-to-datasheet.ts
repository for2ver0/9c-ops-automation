#!/usr/bin/env bun
/**
 * spec-to-datasheet — 기획서에서 뽑은 계획 JSON을 현재 시트 CSV와 대조해, 시트에 입력할
 * 작업 지시서(현재값 → 제안값)를 만든다. 설계 배경은
 * .claude/skills/spec-to-datasheet/SKILL.md, tools/9c/lib/spec-to-datasheet.ts 참고.
 *
 * 계획 JSON은 spec-datasheet-check의 --assertions와 **같은 형식**이다 — 시트를 다 고친 뒤
 * 같은 파일을 그대로 spec-datasheet-check에 넘겨 "제대로 들어갔는지" 검증하면 된다.
 *
 * Usage:
 *   bun run tools/9c/spec-to-datasheet.ts --csv ./SkillSheet.csv --plan ./plan.json --sheet-name SkillSheet
 *   bun run tools/9c/spec-to-datasheet.ts --csv ./SkillSheet.csv --plan ./plan.json --json
 *
 * plan.json 형식 (spec-datasheet-check의 assertions와 동일):
 *   [
 *     { "sheet": "SkillSheet", "id": "10113000", "column": "Cooldown", "expected": "3", "note": "기획서 3.2절" }
 *   ]
 */
import { parseCsv } from "./lib/csv";
import { buildPlan, type PlanItem, type PlanSummary } from "./lib/spec-to-datasheet";

interface Args {
  csvPath?: string;
  planPath?: string;
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
      case "--plan":
        args.planPath = next();
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
  if (!args.planPath) throw new Error("--plan <경로.json>이 필요합니다.");
  return args;
}

async function readPlan(path: string): Promise<PlanItem[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`계획 파일을 찾을 수 없습니다: ${path}`);
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch (e) {
    throw new Error(`계획 파일이 올바른 JSON이 아닙니다: ${e instanceof Error ? e.message : e}`);
  }
  if (!Array.isArray(raw)) throw new Error("계획 파일은 JSON 배열이어야 합니다.");
  raw.forEach((a, i) => {
    if (!a || typeof a !== "object" || typeof (a as PlanItem).id !== "string" ||
        typeof (a as PlanItem).column !== "string" || typeof (a as PlanItem).expected !== "string") {
      throw new Error(`plan[${i}]에 id/column/expected(전부 문자열)가 필요합니다.`);
    }
  });
  return raw as PlanItem[];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const csvFile = Bun.file(args.csvPath!);
  if (!(await csvFile.exists())) throw new Error(`CSV 파일을 찾을 수 없습니다: ${args.csvPath}`);
  const csv = parseCsv(await csvFile.text());
  if (csv.headers.length === 0) throw new Error("CSV에서 헤더 행을 읽지 못했습니다.");

  const plan = await readPlan(args.planPath!);
  const summary = buildPlan(csv, args.keyColumn, plan, args.sheetName);

  if (args.json) {
    console.log(JSON.stringify({ source: args.csvPath, sheetName: args.sheetName, ...summary }, null, 2));
  } else {
    printHumanReadable(args, summary);
  }
  process.exit(summary.level === "FATAL" ? 1 : 0);
}

function printHumanReadable(args: Args, summary: PlanSummary) {
  console.log(`전체 상태: ${summary.level}`);
  console.log(`대상 시트: ${args.csvPath}${args.sheetName ? ` (${args.sheetName})` : ""}`);
  console.log(
    `계획 ${summary.workItems.length + summary.skipped}건 중 이 시트 ${summary.workItems.length}건 ` +
      `— 변경 ${summary.counts.CHANGE} / 새 행 ${summary.counts.NEW_ROW} / 이미 반영 ${summary.counts.NO_CHANGE} / 컬럼 없음 ${summary.counts.COLUMN_NOT_FOUND}` +
      (summary.skipped > 0 ? `, 건너뜀(다른 시트용) ${summary.skipped}` : ""),
  );
  console.log("");
  if (summary.conflicts.length > 0) {
    console.log("## 계획 파일 자체의 모순 (지시서가 성립하지 않음 — 먼저 고칠 것)");
    for (const c of summary.conflicts) {
      console.log(`[FATAL] ${c.id}의 "${c.column}"에 서로 다른 값이 요구됨: ${c.expectedValues.map((v) => `"${v}"`).join(" vs ")}`);
    }
    console.log("");
  }
  console.log("## 작업 지시서");
  for (const w of summary.workItems) {
    const mark =
      w.status === "COLUMN_NOT_FOUND" ? "FATAL" : w.level === "WARN" ? "WARN " : w.status === "NO_CHANGE" ? "SKIP " : "TODO ";
    console.log(`[${mark}] ${w.detail}${w.item.note ? `  (근거: ${w.item.note})` : ""}`);
  }
  const realGaps = summary.gaps.filter((g) => g.missingColumns.length > 0);
  if (realGaps.length > 0) {
    console.log("");
    console.log("## 새 행에 값이 안 정해진 컬럼 (사람이 채워야 함)");
    for (const g of realGaps) {
      console.log(`[WARN ] ${g.id}: ${g.missingColumns.join(", ")}`);
    }
  }
  console.log("");
  console.log("시트 입력을 마치면 같은 계획 파일을 spec-datasheet-check의 --assertions로 넘겨 검증하세요.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
