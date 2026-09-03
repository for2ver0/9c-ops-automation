import { describe, expect, test } from "bun:test";
import {
  isLatestJsonSnapshotEntry,
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

  test("does not claim sync when a manifest APV failed to fetch (apv: null)", () => {
    const items = buildDeployChecklist({
      gitbookApv: 200470,
      odin: apv("odin", null),
      heimdall: apv("heimdall", 200470),
      clientBuild: null,
      rollbackTarget: null,
      manageApvInputs: [],
    });
    expect(items.some((i) => i.includes("동기화돼 있습니다"))).toBe(false);
    expect(items.some((i) => i.includes("읽지 못했습니다"))).toBe(true);
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

// --- 2026-09-03 "조용한 OK" 점검 회귀 --------------------------------------------------
// 로그를 `JSON.parse(l) as LatestJsonSnapshotEntry`로 캐스팅만 하던 탓에, `{"unrelated":true}`
// 한 줄이 스냅샷으로 둔갑해 체크리스트가 "[x] 롤백 대상 확보됨 … version=undefined로 되돌릴
// 수 있습니다"를 출력했다(실측). 롤백은 사고 대응 경로라 "있다고 했는데 없음"이 가장 위험하다.

describe("isLatestJsonSnapshotEntry", () => {
  test("정상 항목은 통과", () => {
    expect(isLatestJsonSnapshotEntry({ observedAt: "2020-01-01T00:00:00Z", version: 1, clientTimestamp: "t" })).toBe(true);
  });

  test("모양이 다른 객체는 거부 — 이게 롤백 대상으로 둔갑하던 자리", () => {
    expect(isLatestJsonSnapshotEntry({ unrelated: true })).toBe(false);
  });

  test("null·문자열·숫자 거부", () => {
    expect(isLatestJsonSnapshotEntry(null)).toBe(false);
    expect(isLatestJsonSnapshotEntry("just a string")).toBe(false);
    expect(isLatestJsonSnapshotEntry(42)).toBe(false);
  });

  test("version이 숫자가 아니거나 NaN이면 거부", () => {
    expect(isLatestJsonSnapshotEntry({ observedAt: "t", version: "1", clientTimestamp: "t" })).toBe(false);
    expect(isLatestJsonSnapshotEntry({ observedAt: "t", version: NaN, clientTimestamp: "t" })).toBe(false);
  });
});
