import { describe, expect, test } from "bun:test";
import {
  findRollbackTarget,
  checkRollbackSnapshotAvailable,
  planManageApvWorkflowInputs,
  buildDeployChecklist,
  overallLevel,
  type LatestJsonSnapshotEntry,
} from "./deploy-prep";
import type { ManifestApv } from "./release-guard";

function apv(network: "odin" | "heimdall", v: number | null): ManifestApv {
  return { network, apv: v, raw: v === null ? null : String(v) };
}

describe("findRollbackTarget", () => {
  test("finds the most recent entry whose version differs from current", () => {
    const log: LatestJsonSnapshotEntry[] = [
      { observedAt: "2026-07-01T00:00:00Z", version: 46000000009, clientTimestamp: "t1" },
      { observedAt: "2026-08-01T00:00:00Z", version: 47000000010, clientTimestamp: "t2" },
      { observedAt: "2026-08-25T00:00:00Z", version: 47000000011, clientTimestamp: "t3" },
    ];
    const target = findRollbackTarget(log, 47000000011);
    expect(target?.version).toBe(47000000010);
  });

  test("returns null when every logged entry already matches current (no change yet)", () => {
    const log: LatestJsonSnapshotEntry[] = [{ observedAt: "2026-08-25T00:00:00Z", version: 47000000011, clientTimestamp: "t3" }];
    expect(findRollbackTarget(log, 47000000011)).toBeNull();
  });

  test("returns null on an empty log", () => {
    expect(findRollbackTarget([], 1)).toBeNull();
  });

  test("is not fooled by out-of-order log entries", () => {
    const log: LatestJsonSnapshotEntry[] = [
      { observedAt: "2026-08-25T00:00:00Z", version: 47000000011, clientTimestamp: "t3" },
      { observedAt: "2026-07-01T00:00:00Z", version: 46000000009, clientTimestamp: "t1" },
      { observedAt: "2026-08-01T00:00:00Z", version: 47000000010, clientTimestamp: "t2" },
    ];
    expect(findRollbackTarget(log, 47000000011)?.version).toBe(47000000010);
  });
});

describe("checkRollbackSnapshotAvailable", () => {
  test("OK when a rollback target exists", () => {
    const c = checkRollbackSnapshotAvailable({ observedAt: "x", version: 1, clientTimestamp: "t" }, true);
    expect(c.level).toBe("OK");
  });

  test("WARN when the log is empty (nothing recorded yet)", () => {
    const c = checkRollbackSnapshotAvailable(null, false);
    expect(c.level).toBe("WARN");
  });

  test("OK (not WARN) when the log has entries but none differ — genuinely no rollback needed yet", () => {
    const c = checkRollbackSnapshotAvailable(null, true);
    expect(c.level).toBe("OK");
  });
});

describe("planManageApvWorkflowInputs", () => {
  test("plans inputs only for networks behind gitbook", () => {
    const inputs = planManageApvWorkflowInputs(200470, apv("odin", 200460), apv("heimdall", 200470));
    expect(inputs).toEqual([{ dirName: "9c-main", fileName: "odin", targetApv: 200470 }]);
  });

  test("empty when both networks already match gitbook", () => {
    expect(planManageApvWorkflowInputs(200470, apv("odin", 200470), apv("heimdall", 200470))).toEqual([]);
  });

  test("skips a network with apv:null (e.g. fetch failure) rather than crashing", () => {
    expect(planManageApvWorkflowInputs(200470, apv("odin", null), apv("heimdall", 200470))).toEqual([]);
  });

  test("does not plan for a network ahead of gitbook (normal deploy-then-notes-lag order)", () => {
    expect(planManageApvWorkflowInputs(200460, apv("odin", 200470), apv("heimdall", 200460))).toEqual([]);
  });
});

describe("buildDeployChecklist", () => {
  test("lists a Manage Apv line per behind-network input", () => {
    const items = buildDeployChecklist({
      gitbookApv: 200470,
      odin: apv("odin", 200460),
      heimdall: apv("heimdall", 200470),
      clientBuild: { version: 47000000011, timestamp: "2026-08-25T02:22:00Z" },
      rollbackTarget: { observedAt: "2026-08-01T00:00:00Z", version: 47000000010, clientTimestamp: "t" },
      manageApvInputs: [{ dirName: "9c-main", fileName: "odin", targetApv: 200470 }],
    });
    expect(items.some((i) => i.includes("Manage Apv") && i.includes("odin") && i.includes("200470"))).toBe(true);
    expect(items.some((i) => i.includes("롤백 대상 확보됨"))).toBe(true);
  });

  test("says no Manage Apv run needed when nothing is behind", () => {
    const items = buildDeployChecklist({
      gitbookApv: 200470,
      odin: apv("odin", 200470),
      heimdall: apv("heimdall", 200470),
      clientBuild: null,
      rollbackTarget: null,
      manageApvInputs: [],
    });
    expect(items.some((i) => i.includes("동기화돼 있습니다"))).toBe(true);
    expect(items.some((i) => i.includes("latest.json 조회 실패"))).toBe(true);
  });

  test("distinguishes 'ahead of gitbook' from 'synced' — does not claim sync when manifests are actually ahead", () => {
    const items = buildDeployChecklist({
      gitbookApv: 200470,
      odin: apv("odin", 200480),
      heimdall: apv("heimdall", 200480),
      clientBuild: null,
      rollbackTarget: null,
      manageApvInputs: [],
    });
    expect(items.some((i) => i.includes("동기화돼 있습니다"))).toBe(false);
    expect(items.some((i) => i.includes("앞선 버전을 배포 중"))).toBe(true);
  });

  test("flags missing rollback target as a to-do, not silently skipped", () => {
    const items = buildDeployChecklist({
      gitbookApv: 200470,
      odin: apv("odin", 200470),
      heimdall: apv("heimdall", 200470),
      clientBuild: { version: 1, timestamp: "t" },
      rollbackTarget: null,
      manageApvInputs: [],
    });
    expect(items.some((i) => i.includes("롤백 대상 없음"))).toBe(true);
  });
});

describe("overallLevel", () => {
  test("FATAL beats WARN beats OK", () => {
    expect(overallLevel([{ id: "a", name: "a", ok: true, level: "OK", detail: "" }])).toBe("OK");
    expect(overallLevel([{ id: "a", name: "a", ok: false, level: "WARN", detail: "" }])).toBe("WARN");
    expect(
      overallLevel([
        { id: "a", name: "a", ok: false, level: "WARN", detail: "" },
        { id: "b", name: "b", ok: false, level: "FATAL", detail: "" },
      ]),
    ).toBe("FATAL");
  });
});
