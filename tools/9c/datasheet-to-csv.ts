#!/usr/bin/env bun
/**
 * datasheet-to-csv — 구글 시트를 읽어 `planetarium/lib9c`의 `Lib9c/TableCSV/<시트명>.csv`에
 * 커밋해도 되는 CSV로 만들고, 현재 lib9c 값과 대조한 변경 목록·커밋 메시지 초안을 보여준다.
 *
 * **완전히 읽기 전용 초안 생성기다** — lib9c에는 아무것도 쓰지 않는다. 실제 fork push와
 * upstream PR 생성은 항상 사람이 한다(announce-fanout·release-notes와 같은 패턴). 이 CLI는
 * git 명령을 텍스트로 제안만 하고 절대 실행하지 않는다.
 *
 * gviz가 아니라 Sheets API로 읽는다 — gviz는 컬럼 타입을 추론해서 그 타입에 안 맞는 값을
 * 조용히 비운다(datasheet-validate가 이미 실측으로 확인: `headers=1` 누락 시 CollectionSheet
 * 895→13행 유실 등). 과거 lib9c TableCSV에서 실제로 손상 재수출 사고가 2건 있었다
 * (`re-export 10/11 corrupted table sheets from Google Sheets`) — 정확한 원인까지는
 * 확인 못 했지만 같은 부류의 실패 모드로 보인다. `SkillSheet.csv`의 "숫자 컬럼에 텍스트가
 * 섞인 셀"(`_100002` 등 lib9c가 건너뛰는 주석 행 7개, "미구현" 스킬)도 실제로 확인했는데
 * — **이 셀들 자체는 스킵 행이라 gviz로 깨져도 로드엔 영향 없다.** 다만 이런 형태의 값이
 * 이 시트에 실재한다는 건, 같은 컬럼의 다른(스킵 아닌) 행에도 비슷한 값이 있을 수 있다는
 * 신호다 — gviz의 타입 추론을 믿을 수 없다는 원칙을 재확인해줄 뿐, 이 셀 자체가 위험하다는
 * 뜻은 아니다. 그래서 `spec-to-datasheet-apply`와 같은 원칙으로 Sheets API
 * (`UNFORMATTED_VALUE`)만 쓴다 — 다만 여기선 읽기만 하므로 읽기 전용 스코프를 쓴다.
 *
 * 설계 배경: 계획 문서(이번 세션), `.claude/skills/spec-to-datasheet/SKILL.md`.
 *
 * Usage:
 *   GOOGLE_SHEETS_SA_KEY_PATH=./sa-key.json \
 *   bun run tools/9c/datasheet-to-csv.ts --sheet-name SkillSheet --spreadsheet-id 1Di903g... --out ./SkillSheet.csv
 */
import { fetchAccessToken, loadServiceAccountKeyFile, signServiceAccountJwt } from "./lib/google-sheets-auth";
import { sheetValuesToParsedCsv } from "./lib/google-sheets-values";
import { assessReadiness, buildDraftCommitMessage, buildSuggestedGitCommands, runReadinessChecks, serializeMatchingStyle } from "./lib/datasheet-to-csv";
import { fetchLib9cCsv } from "./lib/lib9c-tablecsv";
import { diffSheet, buildQaChecklist } from "./lib/qa-checklist";
import type { ParsedCsv } from "./lib/csv";

const SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

interface Args {
  sheetName?: string;
  spreadsheetId?: string;
  keyColumn: string;
  lib9cRef: string;
  out?: string;
  logFile?: string;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { keyColumn: "Id", lib9cRef: "development", json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--sheet-name":
        args.sheetName = next();
        break;
      case "--spreadsheet-id":
        args.spreadsheetId = next();
        break;
      case "--key-column":
        args.keyColumn = next()!;
        break;
      case "--lib9c-ref":
        args.lib9cRef = next()!;
        break;
      case "--out":
        args.out = next();
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
  if (!args.sheetName) throw new Error("--sheet-name <탭명>이 필요합니다.");
  if (!args.spreadsheetId) throw new Error("--spreadsheet-id <시트ID>가 필요합니다.");
  if (!args.out) throw new Error("--out <경로>가 필요합니다.");
  return args;
}

async function getAccessToken(): Promise<string> {
  const keyPath = process.env.GOOGLE_SHEETS_SA_KEY_PATH;
  if (!keyPath) {
    throw new Error(
      "GOOGLE_SHEETS_SA_KEY_PATH 환경변수가 필요합니다 — 서비스 계정 키 파일 경로를 실행 시점에 주입하세요.",
    );
  }
  const sa = await loadServiceAccountKeyFile(keyPath);
  const jwt = signServiceAccountJwt(sa, SHEETS_READONLY_SCOPE, new Date());
  const token = await fetchAccessToken(jwt);
  return token.accessToken;
}

async function readSheetValues(spreadsheetId: string, sheetName: string, accessToken: string): Promise<string[][]> {
  const url = `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(`'${sheetName.replace(/'/g, "''")}'`)}?valueRenderOption=UNFORMATTED_VALUE`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`시트 값을 읽지 못했습니다: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { values?: unknown[][] };
  return (body.values ?? []).map((row) => row.map((cell) => (cell === undefined || cell === null ? "" : String(cell))));
}

async function appendLog(path: string | undefined, entry: Record<string, unknown>): Promise<void> {
  if (!path) return;
  const existing = (await Bun.file(path).exists()) ? await Bun.file(path).text() : "";
  const sep = existing && !existing.endsWith("\n") ? "\n" : "";
  await Bun.write(path, existing + sep + JSON.stringify(entry) + "\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const accessToken = await getAccessToken();
  const rawValues = await readSheetValues(args.spreadsheetId!, args.sheetName!, accessToken);
  const after: ParsedCsv = sheetValuesToParsedCsv(rawValues);
  if (after.headers.length === 0) throw new Error("시트에서 헤더 행을 읽지 못했습니다.");

  const checks = runReadinessChecks(after, args.keyColumn);
  const readiness = assessReadiness(checks);
  const observedAt = new Date().toISOString();

  if (readiness === "FATAL") {
    console.error(`[FATAL] 구조 검증 실패 — ${args.out}을 쓰지 않았습니다. 시트 원본을 먼저 고치세요.`);
    for (const c of checks.filter((c) => c.level === "FATAL")) console.error(`  - ${c.detail}`);
    await appendLog(args.logFile, { observedAt, sheet: args.sheetName, readiness, wrote: false });
    process.exit(1);
  }

  const { csv: before, rawText: beforeRawText } = await fetchLib9cCsv(args.sheetName!, args.lib9cRef);
  const diff = before
    ? diffSheet(before, after, args.keyColumn)
    : diffSheet({ headers: after.headers, rows: [] }, after, args.keyColumn);

  await Bun.write(args.out!, serializeMatchingStyle(after, beforeRawText));

  const commitMessage = buildDraftCommitMessage(args.sheetName!);
  // 실제 관찰된 lib9c 브랜치(update/tablecsv-20260630-0807, -20260624-1238)의 뒷자리는 시각
  // (08:07, 12:38)으로 보인다 — 정확히 같은 규칙인지는 확인 못 했지만, 날짜만 쓰면 하루에
  // 두 번 실행할 때 브랜치명이 겹치므로 최소한 시:분을 붙인다. 사람이 자기 환경에서 그대로
  // 쓰거나 바꿔도 되는 제안일 뿐이다.
  const branchName = `update/tablecsv-${observedAt.slice(0, 10).replace(/-/g, "")}-${observedAt.slice(11, 16).replace(":", "")}`;
  const gitCommands = buildSuggestedGitCommands(args.sheetName!, args.out!, branchName, commitMessage);
  const checklist = buildQaChecklist(args.sheetName!, diff);

  await appendLog(args.logFile, {
    observedAt,
    sheet: args.sheetName,
    lib9cRef: args.lib9cRef,
    isNewToLib9c: before === null,
    readiness,
    added: diff.added.length,
    removed: diff.removed.length,
    changed: diff.changed.length,
    wrote: true,
    out: args.out,
  });

  if (args.json) {
    console.log(JSON.stringify({ readiness, checks, isNewToLib9c: before === null, diff, commitMessage, branchName, gitCommands, out: args.out }, null, 2));
  } else {
    console.log(`전체 상태: ${readiness}`);
    console.log(`대상 시트: ${args.sheetName} (lib9c ${args.lib9cRef} 기준 대조${before === null ? " — lib9c에 아직 없는 신규 시트" : ""})`);
    console.log(`CSV 저장: ${args.out}`);
    console.log("");
    if (readiness === "WARN") {
      console.log("## 구조 검증 경고 — 사람이 원본을 확인하세요");
      for (const c of checks.filter((c) => c.level === "WARN")) console.log(`[WARN] ${c.detail}`);
      console.log("");
    }
    console.log("## lib9c 대비 변경 사항");
    for (const line of checklist) console.log(line);
    console.log("");
    console.log("## 커밋 메시지 초안");
    console.log(commitMessage);
    console.log("");
    console.log("## 다음 명령은 실행되지 않았습니다 — 사람이 lib9c 클론에서 직접 실행하세요");
    for (const cmd of gitCommands) console.log(`  ${cmd}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
