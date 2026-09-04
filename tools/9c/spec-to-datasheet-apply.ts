#!/usr/bin/env bun
/**
 * spec-to-datasheet-apply — spec-to-datasheet가 만든 작업 지시서 중, 사람이 대화형으로 명시적
 * 승인한 뒤 --apply 플래그까지 준 경우에만 실제로 구글 시트에 값을 쓴다. 이중 게이트:
 *
 *   (a) 이 커맨드를 실행하기 전에 사람이 지시서를 보고 명시적으로 확인해야 한다 — 이건 대화
 *       레이어의 몫이라 이 CLI가 강제할 수 없다. `.claude/skills/spec-to-datasheet/SKILL.md`가
 *       에이전트에게 반드시 먼저 확인받으라고 지시한다.
 *   (b) `--apply` 없이 실행하면 dry-run이다 — API를 전혀 호출하지 않고 무엇을 쓸지만 보여준다.
 *
 * WARN·FATAL로 판정된 항목(병합형 시트로 의심되는 중복 키, 컬럼이 안 채워진 새 행, 컬럼
 * 없음·계획 모순)은 이 경로로도 절대 자동 반영되지 않는다 — `spec-to-datasheet.ts`와 같은 이유
 * (`lib/spec-to-datasheet-apply.ts`의 `selectWriteTargets` 참고).
 *
 * `--apply` 시엔 로컬 `--csv`를 쓰지 않는다. gviz 기반 CSV export는 값을 조용히 다르게 보여줄
 * 수 있어(따옴표·타입 추론·행 유실, datasheet-validate 실측) 쓰기 판정의 근거로 못 쓴다 —
 * 대신 Sheets API로 **그 순간의** 원본 값을 새로 읽어 재계산한다.
 *
 * 설계 배경: docs/sheet-write-automation-design.md, .claude/skills/spec-to-datasheet/SKILL.md §5.
 *
 * Usage:
 *   # dry-run (기본) — API 호출 없음, 사람이 승인할 지시서를 보여줌
 *   bun run tools/9c/spec-to-datasheet-apply.ts --csv ./SkillSheet.csv --plan ./plan.json --sheet-name SkillSheet
 *
 *   # 실제 반영 — 사람의 대화형 승인을 받은 뒤에만 실행
 *   GOOGLE_SHEETS_SA_KEY_PATH=./sa-key.json \
 *   bun run tools/9c/spec-to-datasheet-apply.ts --plan ./plan.json --sheet-name SkillSheet \
 *     --spreadsheet-id 1Di903g... --apply --log-file ./sheet-writes.jsonl
 */
import { cellA1, quoteSheetName } from "./lib/a1-notation";
import { parseCsv } from "./lib/csv";
import { fetchAccessToken, loadServiceAccountKeyFile, signServiceAccountJwt } from "./lib/google-sheets-auth";
import { sheetValuesToParsedCsv } from "./lib/google-sheets-values";
import { buildPlan, type PlanItem, type PlanSummary } from "./lib/spec-to-datasheet";
import {
  NEW_ROW_COLUMN_SENTINEL,
  selectWriteTargets,
  type CellUpdate,
  type RowInsert,
  type SheetWriteLogEntry,
  type WriteTargets,
} from "./lib/spec-to-datasheet-apply";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

interface Args {
  planPath?: string;
  csvPath?: string;
  spreadsheetId?: string;
  sheetName?: string;
  keyColumn: string;
  apply: boolean;
  logFile?: string;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { keyColumn: "Id", apply: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--plan":
        args.planPath = next();
        break;
      case "--csv":
        args.csvPath = next();
        break;
      case "--spreadsheet-id":
        args.spreadsheetId = next();
        break;
      case "--sheet-name":
        args.sheetName = next();
        break;
      case "--key-column":
        args.keyColumn = next()!;
        break;
      case "--apply":
        args.apply = true;
        break;
      case "--log-file":
        args.logFile = next();
        break;
      case "--json":
        args.json = true;
        break;
      default:
        throw new Error(`알 수 없는 옵션: ${a}`);
    }
  }
  if (!args.planPath) throw new Error("--plan <경로.json>이 필요합니다.");
  if (!args.sheetName) throw new Error("--sheet-name <탭명>이 필요합니다.");
  if (!args.apply && !args.csvPath) throw new Error("dry-run(--apply 없이 실행)에는 --csv <경로>가 필요합니다.");
  if (args.apply && !args.spreadsheetId) throw new Error("--apply에는 --spreadsheet-id <시트ID>가 필요합니다.");
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
  return raw as PlanItem[];
}

async function appendLog(path: string | undefined, entry: SheetWriteLogEntry): Promise<void> {
  if (!path) return;
  const existing = (await Bun.file(path).exists()) ? await Bun.file(path).text() : "";
  const sep = existing && !existing.endsWith("\n") ? "\n" : "";
  await Bun.write(path, existing + sep + JSON.stringify(entry) + "\n");
}

async function getAccessToken(): Promise<string> {
  const keyPath = process.env.GOOGLE_SHEETS_SA_KEY_PATH;
  if (!keyPath) {
    throw new Error(
      "GOOGLE_SHEETS_SA_KEY_PATH 환경변수가 필요합니다 — 서비스 계정 키 파일 경로를 실행 시점에 주입하세요.",
    );
  }
  const sa = await loadServiceAccountKeyFile(keyPath);
  const jwt = signServiceAccountJwt(sa, SHEETS_SCOPE, new Date());
  const token = await fetchAccessToken(jwt);
  return token.accessToken;
}

async function readSheetValues(spreadsheetId: string, sheetName: string, accessToken: string): Promise<string[][]> {
  const url = `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(quoteSheetName(sheetName))}?valueRenderOption=UNFORMATTED_VALUE`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`시트 값을 읽지 못했습니다: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { values?: unknown[][] };
  return (body.values ?? []).map((row) => row.map((cell) => (cell === undefined || cell === null ? "" : String(cell))));
}

async function writeCell(
  spreadsheetId: string,
  update: CellUpdate,
  accessToken: string,
): Promise<{ range: string }> {
  const range = cellA1(update.sheet, update.colIndex0, update.rowIndex0 + 2);
  const url = `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ range, values: [[update.after]] }),
  });
  if (!res.ok) throw new Error(`셀 쓰기 실패(${range}): ${res.status} ${await res.text()}`);
  return { range };
}

async function appendRow(
  spreadsheetId: string,
  insert: RowInsert,
  accessToken: string,
): Promise<{ range: string }> {
  const range = quoteSheetName(insert.sheet);
  const url = `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ range, values: [insert.values] }),
  });
  if (!res.ok) throw new Error(`행 추가 실패(${insert.id}): ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { updates?: { updatedRange?: string } };
  // 실제로 쓰인 위치는 API 응답을 신뢰한다(추정하지 않음) — 승인~실행 사이 다른 사람이 동시에
  // 행을 추가했을 수 있어 "마지막 행 다음"이라고 계산하면 틀릴 수 있다.
  return { range: body.updates?.updatedRange ?? range };
}

function printDryRun(targets: WriteTargets, sheetName: string) {
  console.log(`전체 상태: dry-run (--apply 없이 실행 — API 호출 없음)`);
  console.log(`대상 시트: ${sheetName}`);
  console.log("");
  console.log(`## 이 지시서를 승인하면 쓰일 항목 (${targets.cellUpdates.length + targets.rowInserts.length}건)`);
  for (const u of targets.cellUpdates) {
    console.log(`[쓰기] ${u.id}의 "${u.column}": "${u.before}" → "${u.after}"`);
  }
  for (const r of targets.rowInserts) {
    console.log(`[새 행] ${r.id}: ${r.values.join(", ")}`);
  }
  if (targets.skipped.length > 0) {
    console.log("");
    console.log(`## 자동으로 쓰지 않는 항목 — 사람이 직접 처리 (${targets.skipped.length}건)`);
    for (const w of targets.skipped) {
      console.log(`[${w.level}] ${w.detail}`);
    }
  }
  console.log("");
  console.log(
    "행 번호는 여기 표시하지 않습니다 — 실제 반영 시점(--apply)에 시트를 다시 읽어 계산하므로, " +
      "지금 본 행 번호를 승인 근거로 삼지 마세요.",
  );
}

async function runDryRun(args: Args) {
  const csvFile = Bun.file(args.csvPath!);
  if (!(await csvFile.exists())) throw new Error(`CSV 파일을 찾을 수 없습니다: ${args.csvPath}`);
  const csv = parseCsv(await csvFile.text());
  const plan = await readPlan(args.planPath!);
  const summary = buildPlan(csv, args.keyColumn, plan, args.sheetName!);
  const targets = selectWriteTargets(csv, args.keyColumn, summary, args.sheetName!);

  if (args.json) {
    // rowIndex0/colIndex0는 dry-run에 쓴 로컬(gviz) CSV 기준이라 실제 시트 행 번호로 신뢰할 수
    // 없다(모듈 상단 설명 참고) -- 텍스트 출력이 행 번호를 안 보여주는 것과 같은 이유로 --json
    // 출력에서도 지운다. --apply 시점에 시트를 다시 읽어 새로 계산한다.
    const sanitizedCellUpdates = targets.cellUpdates.map(({ sheet, id, column, before, after }) => ({
      sheet,
      id,
      column,
      before,
      after,
    }));
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          sheetName: args.sheetName,
          level: summary.level,
          targets: { ...targets, cellUpdates: sanitizedCellUpdates },
        },
        null,
        2,
      ),
    );
  } else {
    printDryRun(targets, args.sheetName!);
  }
  process.exit(summary.level === "FATAL" ? 1 : 0);
}

async function runApply(args: Args) {
  const plan = await readPlan(args.planPath!);
  if (args.csvPath) {
    console.error("[WARN] --apply 모드에서는 --csv를 무시하고 시트를 새로 읽습니다.");
  }

  const accessToken = await getAccessToken();
  const rawValues = await readSheetValues(args.spreadsheetId!, args.sheetName!, accessToken);
  const csv = sheetValuesToParsedCsv(rawValues);
  if (csv.headers.length === 0) throw new Error("시트에서 헤더 행을 읽지 못했습니다.");

  const summary: PlanSummary = buildPlan(csv, args.keyColumn, plan, args.sheetName!);
  if (summary.level === "FATAL") {
    console.error("[FATAL] 재조회 결과 컬럼 없음/계획 모순이 있어 아무것도 쓰지 않았습니다.");
    for (const c of summary.conflicts) {
      console.error(`  - ${c.id}의 "${c.column}"에 서로 다른 값이 요구됨: ${c.expectedValues.join(" vs ")}`);
    }
    for (const w of summary.workItems.filter((w) => w.level === "FATAL")) {
      console.error(`  - ${w.detail}`);
    }
    process.exit(1);
  }

  const targets = selectWriteTargets(csv, args.keyColumn, summary, args.sheetName!);
  const observedAt = new Date().toISOString();
  let writtenCells = 0;
  let insertedRows = 0;
  let failed = 0;

  for (const u of targets.cellUpdates) {
    try {
      const { range } = await writeCell(args.spreadsheetId!, u, accessToken);
      await appendLog(args.logFile, {
        observedAt,
        sheet: u.sheet,
        id: u.id,
        column: u.column,
        before: u.before,
        after: u.after,
        range,
        planFile: args.planPath!,
      });
      writtenCells++;
    } catch (e) {
      console.error(`[ERROR] ${u.id}의 "${u.column}" 쓰기 실패: ${e instanceof Error ? e.message : e}`);
      failed++;
    }
  }

  for (const r of targets.rowInserts) {
    try {
      const { range } = await appendRow(args.spreadsheetId!, r, accessToken);
      await appendLog(args.logFile, {
        observedAt,
        sheet: r.sheet,
        id: r.id,
        column: NEW_ROW_COLUMN_SENTINEL,
        before: null,
        after: r.values.join(", "),
        range,
        planFile: args.planPath!,
      });
      insertedRows++;
    } catch (e) {
      console.error(`[ERROR] ${r.id} 행 추가 실패: ${e instanceof Error ? e.message : e}`);
      failed++;
    }
  }

  const summaryOut = { writtenCells, insertedRows, skipped: targets.skipped.length, failed };
  if (args.json) {
    console.log(JSON.stringify(summaryOut, null, 2));
  } else {
    console.log(`셀 ${writtenCells}건 반영, 새 행 ${insertedRows}건 추가, WARN 건너뜀 ${targets.skipped.length}건, 실패 ${failed}건`);
    if (targets.skipped.length > 0) {
      console.log("건너뛴 항목은 사람이 원본을 보고 직접 처리해야 합니다:");
      for (const w of targets.skipped) console.log(`[${w.level}] ${w.detail}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.apply) {
    await runApply(args);
  } else {
    await runDryRun(args);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
