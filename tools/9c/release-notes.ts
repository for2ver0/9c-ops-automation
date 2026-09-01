#!/usr/bin/env bun
/**
 * release-notes — CURRENTLY A STRUCTURE-ONLY DRAFT TOOL. See tools/9c/lib/release-notes.ts
 * module doc and .claude/skills/release-notes/SKILL.md for the full story; short version:
 * this organizes sections/items a human supplies into a version-headed Markdown draft. It
 * does not write any copy of its own, and does not touch GitBook — a human pastes the
 * result into the GitBook editor themselves (D4 principle: automation never writes to a
 * live system).
 *
 * Usage:
 *   bun run tools/9c/release-notes.ts --apv 200480 --input ./release-note-sections.json
 *
 * --input 파일 형식 (JSON 배열):
 *   [
 *     { "category": "신규 콘텐츠", "items": ["신규 스테이지 471-500 추가", "..."] },
 *     { "category": "밸런스 조정", "items": ["..."] }
 *   ]
 */
import { fetchGitbookHead, runChecks, overallLevel, buildReleaseNoteDraft, type ReleaseNoteSection, type Check } from "./lib/release-notes";

interface Args {
  apv?: number;
  inputPath?: string;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--apv": {
        const v = Number(next());
        if (!Number.isFinite(v) || v <= 0) throw new Error("--apv는 양의 정수여야 합니다.");
        args.apv = v;
        break;
      }
      case "--input":
        args.inputPath = next();
        break;
      case "--json":
        args.json = true;
        break;
      default:
        throw new Error(`알 수 없는 옵션: ${a}`);
    }
  }
  if (args.apv === undefined) throw new Error("--apv <숫자>가 필요합니다.");
  if (!args.inputPath) throw new Error("--input <JSON 파일 경로>가 필요합니다.");
  return args;
}

async function readSections(path: string): Promise<ReleaseNoteSection[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`--input 파일을 찾을 수 없습니다: ${path}`);
  const raw = JSON.parse(await file.text());
  if (!Array.isArray(raw)) throw new Error("--input 파일은 JSON 배열이어야 합니다.");
  return raw.map((s: unknown, i: number) => {
    if (typeof s !== "object" || s === null || !("category" in s) || !("items" in s)) {
      throw new Error(`--input 파일의 ${i}번째 항목이 { category, items } 형식이 아닙니다.`);
    }
    const obj = s as { category: unknown; items: unknown };
    if (typeof obj.category !== "string" || !Array.isArray(obj.items)) {
      throw new Error(`--input 파일의 ${i}번째 항목 형식이 잘못됐습니다 (category: string, items: string[]).`);
    }
    return { category: obj.category, items: obj.items.map(String) };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sections = await readSections(args.inputPath!);
  const input = { apv: args.apv!, sections };

  const currentGitbookApv = await fetchGitbookHead();
  const checks = runChecks(input, currentGitbookApv);
  const level = overallLevel(checks);
  const draft = buildReleaseNoteDraft(input);

  if (args.json) {
    console.log(JSON.stringify({ level, currentGitbookApv, draft, checks }, null, 2));
  } else {
    console.log(`대사 결과: ${level} (현재 깃북 최신 v${currentGitbookApv})\n`);
    for (const c of checks as readonly Check[]) {
      const mark = c.ok ? "OK   " : c.level === "FATAL" ? "FATAL" : "WARN ";
      console.log(`[${mark}] ${c.name} — ${c.detail}`);
    }
    if (level === "FATAL") {
      console.log("\n치명(FATAL) 항목이 있어 초안을 표시하지 않습니다 — 위 내용을 확인한 뒤 다시 실행하세요.");
    } else {
      console.log("\n=== 릴리즈 노트 초안 ===\n");
      console.log(draft);
    }
  }

  process.exit(level === "FATAL" ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
