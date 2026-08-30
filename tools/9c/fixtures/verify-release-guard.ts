#!/usr/bin/env bun
/**
 * Live smoke test for release-guard's fetch* functions — confirms the four public endpoints
 * still respond and parse the way tools/9c/lib/release-guard.ts expects. Unlike the unit
 * tests (pure functions, fixed strings), this hits the real network, so only invariants that
 * should hold regardless of the current release are asserted (not exact version numbers,
 * which change every release).
 */
import {
  fetchGitbookHead,
  fetchManifestApv,
  fetchNoticeHead,
  fetchClientBuildInfo,
} from "../lib/release-guard";

let failed = 0;

function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`PASS  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const gitbookApv = await fetchGitbookHead();
check("gitbook head parses to a positive 6-digit-ish APV", gitbookApv > 200000, `got ${gitbookApv}`);

const [odin, heimdall, thor, general] = await Promise.all([
  fetchManifestApv("odin"),
  fetchManifestApv("heimdall"),
  fetchManifestApv("thor"),
  // general.yaml isn't a ManifestNetwork type, so fetch it directly the same way the lib does.
  fetch("https://raw.githubusercontent.com/planetarium/9c-infra/main/9c-main/network/general.yaml").then((r) => r.text()),
]);

check("odin.yaml has a parsed APV", odin.apv !== null, JSON.stringify(odin));
check("heimdall.yaml has a parsed APV", heimdall.apv !== null, JSON.stringify(heimdall));
check("odin and heimdall are on the same APV (7-of-8 release history pattern, not guaranteed forever)", odin.apv === heimdall.apv);
check("thor.yaml still has no appProtocolVersion bump since 2026-01-27 (200400) — informational, not asserting it never will", thor.apv !== null);
check("general.yaml genuinely has no appProtocolVersion key (design doc's claim)", !general.includes("appProtocolVersion"));

for (const file of ["TextNotice", "TextNotice_KR", "TextNotice_JP"] as const) {
  const head = await fetchNoticeHead(file);
  check(`${file}.json has a top entry with a v{APV} header`, head.apv !== null, JSON.stringify(head));
  check(`${file}.json top entry has non-empty Contents`, !!head.contents && head.contents.trim().length > 0);
}

const clientBuild = await fetchClientBuildInfo();
check("latest.json version field present", typeof clientBuild.version === "number" && clientBuild.version > 0);

console.log(failed ? `\n${failed} case(s) FAILED` : "\nall cases pass (live, as of run time)");
process.exit(failed ? 1 : 0);
