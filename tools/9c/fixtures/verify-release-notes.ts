#!/usr/bin/env bun
/**
 * Live smoke test for release-notes — confirms fetchGitbookHead (reused from release-guard)
 * still works from this module's import path, and that a draft built against the real
 * current gitbook head behaves sensibly (next-in-sequence passes, reusing the current head
 * itself is FATAL).
 */
import { fetchGitbookHead, runChecks, overallLevel, buildReleaseNoteDraft, type ReleaseNoteInput } from "../lib/release-notes";

let failed = 0;

function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`PASS  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const currentGitbookApv = await fetchGitbookHead();
check("gitbook head parses", currentGitbookApv > 200000, `got ${currentGitbookApv}`);

const nextInput: ReleaseNoteInput = {
  apv: currentGitbookApv + 10,
  sections: [{ category: "신규 콘텐츠", items: ["예시 항목"] }],
};
const nextChecks = runChecks(nextInput, currentGitbookApv);
check("next-in-sequence APV against real live head is not FATAL", overallLevel(nextChecks) !== "FATAL", JSON.stringify(nextChecks));

const staleInput: ReleaseNoteInput = {
  apv: currentGitbookApv,
  sections: [{ category: "신규 콘텐츠", items: ["예시 항목"] }],
};
const staleChecks = runChecks(staleInput, currentGitbookApv);
check("reusing the real current head is FATAL (already published)", overallLevel(staleChecks) === "FATAL", JSON.stringify(staleChecks));

const draft = buildReleaseNoteDraft(nextInput);
check("draft heading matches gitbook's real heading format (bare number, no 'v')", draft.startsWith(`## ${currentGitbookApv + 10}`), draft.slice(0, 40));

console.log(failed ? `\n${failed} case(s) FAILED` : "\nall cases pass (live, as of run time)");
process.exit(failed ? 1 : 0);
