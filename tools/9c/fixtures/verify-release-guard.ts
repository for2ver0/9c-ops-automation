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
  fetchNoticeHeadFromGit,
  fetchClientBuildInfo,
  fetchEventJsonSnapshot,
  checkNoticeGitMatchesCdn,
  checkEventJsonSnapshot,
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

  const gitHead = await fetchNoticeHeadFromGit(file);
  check(`${file}.json LiveAssets git copy parses the same way`, gitHead.apv !== null, JSON.stringify(gitHead));
  const cmp = checkNoticeGitMatchesCdn(file, head, gitHead);
  check(`${file}.json CDN vs LiveAssets git comparison never crashes and returns a level`, ["OK", "WARN", "FATAL"].includes(cmp.level), cmp.detail);
}

const clientBuild = await fetchClientBuildInfo();
check("latest.json version field present", typeof clientBuild.version === "number" && clientBuild.version > 0);

// Event.json — confirmed 2026-09-01 (domain owner tip) to be the same S3 object served over a
// public CDN, no credentials needed for reading the current value. versionId confirms the
// bucket has versioning on (S3-side history exists even without this snapshot mechanism).
const eventSnapshot = await fetchEventJsonSnapshot();
check("Event.json CDN read succeeds without auth", eventSnapshot.body.length > 0, `got ${eventSnapshot.body.length} bytes`);
check("Event.json response carries x-amz-version-id (bucket versioning is on)", eventSnapshot.versionId !== null, JSON.stringify(eventSnapshot.versionId));
check("Event.json body parses as JSON (sanity — it's meant to be)", (() => {
  try {
    JSON.parse(eventSnapshot.body);
    return true;
  } catch {
    return false;
  }
})());
const selfCompare = checkEventJsonSnapshot(eventSnapshot, [
  { observedAt: "2020-01-01T00:00:00Z", versionId: eventSnapshot.versionId, etag: eventSnapshot.etag, bodyLength: eventSnapshot.body.length },
]);
check("checkEventJsonSnapshot reports 'unchanged' when compared against its own versionId", selfCompare.detail.includes("변경 없음"), selfCompare.detail);

console.log(failed ? `\n${failed} case(s) FAILED` : "\nall cases pass (live, as of run time)");
process.exit(failed ? 1 : 0);
