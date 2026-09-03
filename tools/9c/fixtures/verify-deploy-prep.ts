#!/usr/bin/env bun
/**
 * Live smoke test for deploy-prep — confirms the reused release-guard fetch functions still
 * work from this module's import path, and that the rollback-snapshot round-trip (write then
 * read back a temp log file) behaves correctly against a real latest.json response.
 */
import { fetchGitbookHead, fetchManifestApv, fetchClientBuildInfo } from "../lib/release-guard";
import { readTextFileOrThrow } from "../lib/read-file";
import { parseJsonlLog } from "../lib/jsonl-log";
import { findRollbackTarget, planManageApvWorkflowInputs, buildDeployChecklist, isLatestJsonSnapshotEntry, type LatestJsonSnapshotEntry } from "../lib/deploy-prep";

let failed = 0;

function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`PASS  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const [gitbookApv, odin, heimdall, clientBuild] = await Promise.all([
  fetchGitbookHead(),
  fetchManifestApv("odin"),
  fetchManifestApv("heimdall"),
  fetchClientBuildInfo(),
]);

check("gitbook head parses", gitbookApv > 200000, `got ${gitbookApv}`);
check("odin.yaml APV parses", odin.apv !== null);
check("heimdall.yaml APV parses", heimdall.apv !== null);
check("latest.json version parses", typeof clientBuild.version === "number" && clientBuild.version > 0);

const inputs = planManageApvWorkflowInputs(gitbookApv, odin, heimdall);
check("planManageApvWorkflowInputs never throws and returns an array", Array.isArray(inputs), JSON.stringify(inputs));

// Regression guard for a real bug caught by running the CLI against live data
// (2026-09-01): odin/heimdall were actually AHEAD of gitbook (post-deploy, notes not
// written yet), but the checklist's "no Manage Apv inputs needed" branch unconditionally
// said "이미 깃북과 동기화돼 있습니다" — wrong when ahead, only correct when exactly equal.
// This asserts the wording distinguishes the two cases against whatever the live state
// actually is right now, so this class of bug can't silently regress.
const checklist = buildDeployChecklist({ gitbookApv, odin, heimdall, clientBuild, rollbackTarget: null, manageApvInputs: inputs });
check("checklist builds without throwing and returns non-empty lines", checklist.length > 0, JSON.stringify(checklist));
const odinAhead = odin.apv !== null && odin.apv > gitbookApv;
const heimdallAhead = heimdall.apv !== null && heimdall.apv > gitbookApv;
if (inputs.length === 0 && (odinAhead || heimdallAhead)) {
  check(
    "checklist does NOT claim '동기화돼 있습니다' when a manifest is actually ahead of gitbook",
    !checklist.some((l) => l.includes("동기화돼 있습니다")),
    JSON.stringify(checklist),
  );
  check(
    "checklist instead says a manifest is ahead ('앞선')",
    checklist.some((l) => l.includes("앞선")),
    JSON.stringify(checklist),
  );
}

// Rollback round-trip against a temp log file — writes two distinct versions, confirms the
// older one is found as the rollback target for the newer one.
const tmpPath = `./.deploy-prep-verify-${Date.now()}.jsonl`;
try {
  const older: LatestJsonSnapshotEntry = { observedAt: "2020-01-01T00:00:00Z", version: 1, clientTimestamp: "t1" };
  const newer: LatestJsonSnapshotEntry = { observedAt: "2020-01-02T00:00:00Z", version: 2, clientTimestamp: "t2" };
  await Bun.write(tmpPath, JSON.stringify(older) + "\n" + JSON.stringify(newer) + "\n");
  // 방금 쓴 파일이지만 헬퍼로 읽는다 — 쓰기가 실패했을 때 그냥 읽으면 거부가 전달되기 전에
  // 프로세스가 끝나 "전부 통과"처럼 보이는 무음 exit 0이 된다(lib/read-file.ts 참고).
  const text = await readTextFileOrThrow(tmpPath, "롤백 라운드트립 임시 로그");
  // 본체(deploy-prep.ts)와 같은 검증 경로로 읽는다 — 여기서만 무검증 캐스팅을 쓰면 검증기가
  // 실제 동작이 아닌 다른 경로를 시험하게 된다.
  const { entries: log, skippedLines } = parseJsonlLog(text, isLatestJsonSnapshotEntry);
  check("rollback round-trip log parses with no skipped lines", skippedLines.length === 0, `skipped: ${skippedLines.join(", ")}`);
  const target = findRollbackTarget(log, 2);
  check("rollback round-trip finds the older distinct version", target?.version === 1, JSON.stringify(target));
} finally {
  await Bun.file(tmpPath)
    .delete()
    .catch(() => {});
}

console.log(failed ? `\n${failed} case(s) FAILED` : "\nall cases pass (live, as of run time)");
process.exit(failed ? 1 : 0);
