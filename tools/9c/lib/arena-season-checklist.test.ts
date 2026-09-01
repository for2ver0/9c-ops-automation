import { describe, expect, test } from "bun:test";
import { normalizeInvariantsJson, normalizeSettlementJson, summarizeChecklist, type SeasonCacheHealth } from "./arena-season-checklist";

describe("normalizeInvariantsJson", () => {
  test("reads `invariants` key (arena-reward-table / arena-season-preview shape)", () => {
    const raw = { invariants: [{ id: "a", name: "A", ok: true, level: "OK", detail: "fine" }] };
    const section = normalizeInvariantsJson("arena-reward-table", raw);
    expect(section.skill).toBe("arena-reward-table");
    expect(section.partial).toBe(false);
    expect(section.checks).toEqual(raw.invariants as never);
  });

  test("reads `checks` key (arena-announce shape)", () => {
    const raw = { checks: [{ id: "b", name: "B", ok: false, level: "WARN", detail: "hm" }] };
    const section = normalizeInvariantsJson("arena-announce", raw);
    expect(section.checks?.[0].id).toBe("b");
  });

  test("throws with a clear message if neither key is present", () => {
    expect(() => normalizeInvariantsJson("arena-reward-table", { somethingElse: 1 })).toThrow(/invariants\/checks/);
  });

  test("recognizes --verify-season backtest shape (no invariants/checks key) and normalizes to a single check", () => {
    const raw = {
      anchorBlock: 19260824,
      targetBlock: 19412023,
      predicted: "2026-08-22T07:12:27.915Z",
      marginMinutes: 5.57,
      actual: "2026-08-22T07:13:56.376Z",
      residualMinutes: -1.47,
      withinMargin: true,
    };
    const section = normalizeInvariantsJson("arena-season-preview", raw);
    expect(section.partial).toBe(false);
    expect(section.checks?.length).toBe(1);
    expect(section.checks?.[0].level).toBe("OK");
    expect(section.checks?.[0].ok).toBe(true);
  });

  test("--verify-season backtest shape outside margin normalizes to WARN", () => {
    const raw = {
      anchorBlock: 1,
      targetBlock: 2,
      predicted: "2026-01-01T00:00:00.000Z",
      marginMinutes: 1,
      actual: "2026-01-01T01:00:00.000Z",
      residualMinutes: -60,
      withinMargin: false,
    };
    const section = normalizeInvariantsJson("arena-season-preview", raw);
    expect(section.checks?.[0].level).toBe("WARN");
    expect(section.checks?.[0].ok).toBe(false);
  });
});

describe("normalizeSettlementJson", () => {
  test("maps SUCCESS -> OK, FAILURE/INVALID -> FATAL, STAGING/INCLUDED -> WARN, error -> WARN", () => {
    const raw = [
      { network: "odin", txId: "t1", status: "SUCCESS", signer: "0xa", blockIndex: 1 },
      { network: "odin", txId: "t2", status: "FAILURE", signer: "0xb", blockIndex: 2 },
      { network: "odin", txId: "t3", status: "STAGING", signer: null, blockIndex: null },
      { txId: "t4", error: "not found" },
    ];
    const section = normalizeSettlementJson(raw);
    expect(section.partial).toBe(true);
    expect(section.checks.map((c) => c.level)).toEqual(["OK", "FATAL", "WARN", "WARN"]);
  });

  test("throws if given a non-array", () => {
    expect(() => normalizeSettlementJson({ not: "an array" })).toThrow(/배열/);
  });
});

describe("summarizeChecklist", () => {
  const ok = (id: string): SkillSectionCheck => ({ id, name: id, ok: true, level: "OK", detail: "" });
  const warn = (id: string): SkillSectionCheck => ({ id, name: id, ok: false, level: "WARN", detail: "" });
  const fatal = (id: string): SkillSectionCheck => ({ id, name: id, ok: false, level: "FATAL", detail: "" });
  type SkillSectionCheck = { id: string; name: string; ok: boolean; level: "OK" | "WARN" | "FATAL"; detail: string };

  const emptyCache: Record<string, SeasonCacheHealth> = {
    odin: { ok: true, level: "OK", detail: "" },
    heimdall: { ok: true, level: "OK", detail: "" },
  };

  test("all OK -> overall OK", () => {
    const summary = summarizeChecklist([{ skill: "a", checks: [ok("x")], partial: false }], emptyCache);
    expect(summary.overallLevel).toBe("OK");
  });

  test("any WARN (no FATAL) -> overall WARN", () => {
    const summary = summarizeChecklist([{ skill: "a", checks: [ok("x"), warn("y")], partial: false }], emptyCache);
    expect(summary.overallLevel).toBe("WARN");
  });

  test("any FATAL -> overall FATAL, even alongside WARN/OK", () => {
    const summary = summarizeChecklist(
      [{ skill: "a", checks: [ok("x"), warn("y"), fatal("z")], partial: false }],
      emptyCache,
    );
    expect(summary.overallLevel).toBe("FATAL");
  });

  test("a FATAL season-cache health check also drives overall FATAL", () => {
    const summary = summarizeChecklist(
      [{ skill: "a", checks: [ok("x")], partial: false }],
      { odin: { ok: false, level: "FATAL", detail: "503" }, heimdall: { ok: true, level: "OK", detail: "" } },
    );
    expect(summary.overallLevel).toBe("FATAL");
  });

  test("a section with checks:null (skill not run) doesn't count toward overall level", () => {
    const summary = summarizeChecklist(
      [
        { skill: "a", checks: [ok("x")], partial: false },
        { skill: "b", checks: null, partial: false },
      ],
      emptyCache,
    );
    expect(summary.overallLevel).toBe("OK");
  });
});
