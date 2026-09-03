#!/usr/bin/env bun
/**
 * regular-update-announce — draft the Discord release-announcement text for a regular
 * (monthly) 9c update, from a fixed template reverse-engineered from 2 real past
 * announcements. See tools/9c/lib/regular-update-announce-template.ts module doc and
 * .claude/skills/announce-fanout/references/regular-update-announcement-samples.md for
 * what's confirmed vs. still just "observed twice".
 *
 * Every input is explicit, same principle as arena-announce: no guessing the APV or
 * release date from live state — those aren't decided by anything this tool can read
 * (the release hasn't happened yet when this draft is written).
 *
 * Usage:
 *   bun run tools/9c/regular-update-announce.ts \
 *     --apv 200480 --release-date 2026-09-22 \
 *     --summary "This update includes new arena rewards and bug fixes."
 *
 *   # override the observed-twice default release time if this release differs
 *   bun run tools/9c/regular-update-announce.ts --apv 200480 --release-date 2026-09-22 \
 *     --release-time "3:00 PM" --summary "..."
 */
import { buildAnnouncementDraft, type CalendarDate } from "./lib/regular-update-announce-template";

interface Args {
  apv?: number;
  releaseDate?: CalendarDate;
  releaseTimeKst?: string;
  summary?: string;
  json: boolean;
}

function parseCalendarDate(s: string): CalendarDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`--release-date는 YYYY-MM-DD 형식이어야 합니다: "${s}"`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--apv":
        args.apv = Number(next());
        break;
      case "--release-date":
        args.releaseDate = parseCalendarDate(next());
        break;
      case "--release-time":
        args.releaseTimeKst = next();
        break;
      case "--summary":
        args.summary = next();
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

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const missing: string[] = [];
  if (args.apv === undefined || Number.isNaN(args.apv)) missing.push("--apv");
  if (!args.releaseDate) missing.push("--release-date");
  if (args.summary === undefined) missing.push("--summary");
  if (missing.length > 0) {
    throw new Error(`다음 값을 명시적으로 입력해야 합니다: ${missing.join(", ")}`);
  }

  const draft = buildAnnouncementDraft({
    apv: args.apv!,
    releaseDate: args.releaseDate!,
    releaseTimeKst: args.releaseTimeKst,
    summary: args.summary!,
  });

  const fatal = draft.checks.filter((c) => c.level === "FATAL" && !c.ok);

  if (args.json) {
    console.log(JSON.stringify({ draft: draft.body, checks: draft.checks }, null, 2));
  } else {
    if (fatal.length === 0) {
      console.log("=== 공지 초안 ===");
      console.log(draft.body);
      console.log("");
    } else {
      console.log("치명(FATAL) 항목이 있어 초안을 표시하지 않습니다 — 아래 확인 후 재실행하세요.\n");
    }
    console.log("대사 결과:");
    for (const c of draft.checks) {
      const mark = c.ok ? "OK   " : c.level === "FATAL" ? "FATAL" : "WARN ";
      console.log(`  [${mark}] ${c.name} — ${c.detail}`);
    }
  }

  if (fatal.length > 0) {
    console.error(`\n${fatal.length}개 치명(FATAL) 항목 — 게시 전에 반드시 확인이 필요합니다.`);
    process.exit(1);
  }
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
