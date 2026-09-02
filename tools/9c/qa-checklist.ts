#!/usr/bin/env bun
/**
 * qa-checklist — CURRENTLY A PARTIAL BUILD covering only the schema-agnostic "시트 diff"
 * half of the design doc's qa-checklist scope. See tools/9c/lib/qa-checklist.ts module doc
 * and .claude/skills/qa-checklist/SKILL.md for the full story.
 *
 * Usage:
 *   bun run tools/9c/qa-checklist.ts \
 *     --sheet-name MaterialItemSheet \
 *     --before ./MaterialItemSheet.old.csv \
 *     --after ./MaterialItemSheet.new.csv \
 *     --key-column Id
 *
 *   bun run tools/9c/qa-checklist.ts --sheet-name MaterialItemSheet --before old.csv --after new.csv --key-column Id --json
 */
import { parseCsv, diffSheet, buildQaChecklist } from "./lib/qa-checklist";

interface Args {
  sheetName?: string;
  before?: string;
  after?: string;
  keyColumn?: string;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--sheet-name":
        args.sheetName = next();
        break;
      case "--before":
        args.before = next();
        break;
      case "--after":
        args.after = next();
        break;
      case "--key-column":
        args.keyColumn = next();
        break;
      case "--json":
        args.json = true;
        break;
      default:
        throw new Error(`알 수 없는 옵션: ${a}`);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const missing: string[] = [];
  if (!args.sheetName) missing.push("--sheet-name");
  if (!args.before) missing.push("--before");
  if (!args.after) missing.push("--after");
  if (!args.keyColumn) missing.push("--key-column");
  if (missing.length > 0) {
    throw new Error(`다음 값을 명시적으로 입력해야 합니다: ${missing.join(", ")}`);
  }

  const beforeFile = Bun.file(args.before!);
  if (!(await beforeFile.exists())) throw new Error(`--before 파일을 찾을 수 없습니다: ${args.before}`);
  const afterFile = Bun.file(args.after!);
  if (!(await afterFile.exists())) throw new Error(`--after 파일을 찾을 수 없습니다: ${args.after}`);

  const before = parseCsv(await beforeFile.text());
  const after = parseCsv(await afterFile.text());

  const diff = diffSheet(before, after, args.keyColumn!);
  const checklist = buildQaChecklist(args.sheetName!, diff);

  if (args.json) {
    console.log(JSON.stringify({ sheetName: args.sheetName, diff, checklist }, null, 2));
  } else {
    console.log(`=== ${args.sheetName} QA 체크리스트 (키 컬럼: ${args.keyColumn}) ===\n`);
    for (const item of checklist) {
      console.log(item);
    }
    console.log(
      `\n요약: 추가 ${diff.added.length}행 / 삭제 ${diff.removed.length}행 / 변경 ${diff.changed.length}행 / 컬럼 추가 ${diff.columnChanges.added.length}개 / 컬럼 삭제 ${diff.columnChanges.removed.length}개`,
    );
    console.log(
      "\n주의: 이 체크리스트는 '무엇이 바뀌었는지'까지만 알려줍니다. '그래서 무엇을 테스트해야 하는지'는 QA 담당자가 판단해서 채워야 합니다(시트별 기능 매핑은 이 스킬의 범위 밖).",
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
