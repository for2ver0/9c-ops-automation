#!/usr/bin/env bun
/**
 * announce-fanout — CURRENTLY A PARTIAL BUILD. See tools/9c/lib/announce-fanout.ts module
 * doc and .claude/skills/announce-fanout/SKILL.md for the full story; short version:
 *
 * 정규 업데이트 인게임 공지(TextNotice{,_KR,_JP}.json, release-guard가 이미 공개 읽기로
 * 검증한 것과 동일 소스)를 디스코드 초안으로 재포장하고, 언어별 불일치를 잡는다. §3 11단계
 * (휴장/이벤트 공지)는 읽기 권한 문제가 아니라(2026-09-01 정정) Event.json에 초안화할
 * 문구 자체가 없어 미착수 — 상세는 SKILL.md §4 참고.
 *
 * Usage:
 *   bun run tools/9c/announce-fanout.ts [--json]
 */
import { fetchNoticeHead } from "./lib/release-guard";
import { buildAnnouncementDraft, overallLevel, type AnnounceCheck } from "./lib/announce-fanout";

interface Args {
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false };
  for (const a of argv) {
    if (a === "--json") args.json = true;
    else throw new Error(`알 수 없는 옵션: ${a}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const [en, kr, jp] = await Promise.all([
    fetchNoticeHead("TextNotice"),
    fetchNoticeHead("TextNotice_KR"),
    fetchNoticeHead("TextNotice_JP"),
  ]);

  const draft = buildAnnouncementDraft(en, kr, jp);
  const level = overallLevel(draft.checks);

  if (args.json) {
    console.log(JSON.stringify({ level, draft: draft.body, checks: draft.checks }, null, 2));
  } else {
    console.log(`대사 결과: ${level}\n`);
    for (const c of draft.checks as readonly AnnounceCheck[]) {
      const mark = c.ok ? "OK   " : c.level === "FATAL" ? "FATAL" : "WARN ";
      console.log(`[${mark}] ${c.name} — ${c.detail}`);
    }
    console.log("\n=== 디스코드 공지 초안 ===\n");
    console.log(draft.body);
  }

  process.exit(level === "FATAL" ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
