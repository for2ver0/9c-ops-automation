#!/usr/bin/env bun
/**
 * Live smoke test for announce-fanout — confirms the reused release-guard fetchNoticeHead
 * calls still work and that buildAnnouncementDraft never crashes on real live content.
 */
import { fetchNoticeHead } from "../lib/release-guard";
import { buildAnnouncementDraft, overallLevel } from "../lib/announce-fanout";

let failed = 0;

function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`PASS  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const [en, kr, jp] = await Promise.all([
  fetchNoticeHead("TextNotice"),
  fetchNoticeHead("TextNotice_KR"),
  fetchNoticeHead("TextNotice_JP"),
]);

check("EN notice head fetched", en.apv !== null, JSON.stringify(en));
check("KR notice head fetched", kr.apv !== null, JSON.stringify(kr));
check("JP notice head fetched", jp.apv !== null, JSON.stringify(jp));

const draft = buildAnnouncementDraft(en, kr, jp);
check("draft body is non-empty", draft.body.length > 0);
check("draft body echoes the actual EN content verbatim (no invented copy)", en.contents ? draft.body.includes(en.contents) : true);
check("overallLevel never throws and returns a valid level", ["OK", "WARN", "FATAL"].includes(overallLevel(draft.checks)));

console.log(failed ? `\n${failed} case(s) FAILED` : "\nall cases pass (live, as of run time)");
process.exit(failed ? 1 : 0);
