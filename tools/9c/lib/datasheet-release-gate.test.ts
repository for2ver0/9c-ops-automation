import { describe, expect, test } from "bun:test";
import {
  buildGate,
  evaluateSheet,
  normalizeSpecCheckJson,
  normalizeStructuralJson,
  type NormalizedCheck,
  type SheetSection,
} from "./datasheet-release-gate";

const okCheck: NormalizedCheck = { id: "a", name: "A", ok: true, level: "OK", detail: "fine" };
const fatalCheck: NormalizedCheck = { id: "b", name: "B", ok: false, level: "FATAL", detail: "broken" };
const warnCheck: NormalizedCheck = { id: "c", name: "C", ok: false, level: "WARN", detail: "hmm" };

describe("normalizeStructuralJson", () => {
  test("extracts the checks array from datasheet-validate's --json shape", () => {
    const raw = { source: "x.csv", headerCount: 3, rowCount: 10, level: "OK", checks: [okCheck] };
    expect(normalizeStructuralJson(raw)).toEqual([okCheck]);
  });

  test("throws when the checks array is missing (shape drifted)", () => {
    expect(() => normalizeStructuralJson({ level: "OK" })).toThrow();
  });
});

describe("normalizeSpecCheckJson", () => {
  test("maps spec-datasheet-check's results (assertion/status shape) into NormalizedCheck", () => {
    const raw = {
      source: "x.csv",
      results: [
        {
          assertion: { id: "10113000", column: "Cooldown", expected: "3" },
          status: "MISMATCH",
          level: "FATAL",
          detail: "기대값 3 / 실제값 5",
        },
      ],
    };
    const normalized = normalizeSpecCheckJson(raw);
    expect(normalized).toHaveLength(1);
    expect(normalized[0]!.ok).toBe(false);
    expect(normalized[0]!.level).toBe("FATAL");
    expect(normalized[0]!.name).toContain("Cooldown");
    expect(normalized[0]!.name).toContain("10113000");
  });

  test("maps an OK result correctly", () => {
    const raw = {
      results: [{ assertion: { id: "1", column: "A" }, status: "OK", level: "OK", detail: "match" }],
    };
    expect(normalizeSpecCheckJson(raw)[0]!.ok).toBe(true);
  });

  test("throws when the results array is missing (shape drifted)", () => {
    expect(() => normalizeSpecCheckJson({ level: "OK" })).toThrow();
  });
});

describe("evaluateSheet", () => {
  test("level is the worst of structural + specCheck checks combined", () => {
    const section: SheetSection = { sheet: "SkillSheet", structural: [okCheck], specCheck: [fatalCheck] };
    const result = evaluateSheet(section);
    expect(result.level).toBe("FATAL");
    expect(result.checks).toHaveLength(2);
  });

  test("missingStructural/missingSpecCheck flags are set when a section is null (not run), not just empty", () => {
    const section: SheetSection = { sheet: "SkillSheet", structural: null, specCheck: [] };
    const result = evaluateSheet(section);
    expect(result.missingStructural).toBe(true);
    expect(result.missingSpecCheck).toBe(false); // [] means "ran, nothing applicable" -- not missing
    expect(result.level).toBe("OK");
  });

  test("an empty specCheck (0 applicable assertions) does not count as FATAL/WARN", () => {
    const section: SheetSection = { sheet: "MonsterSheet", structural: [okCheck], specCheck: [] };
    expect(evaluateSheet(section).level).toBe("OK");
  });

  test("WARN check contributes WARN, not FATAL, when nothing else is FATAL", () => {
    const section: SheetSection = { sheet: "SkillSheet", structural: [okCheck, warnCheck], specCheck: null };
    expect(evaluateSheet(section).level).toBe("WARN");
  });
});

describe("buildGate", () => {
  test("overall level is the worst across all sheets", () => {
    const gate = buildGate([
      { sheet: "SkillSheet", structural: [okCheck], specCheck: [okCheck] },
      { sheet: "MonsterSheet", structural: [okCheck], specCheck: [fatalCheck] },
    ]);
    expect(gate.overallLevel).toBe("FATAL");
    expect(gate.sheets).toHaveLength(2);
  });

  test("all-OK sheets produce an OK overall level", () => {
    const gate = buildGate([{ sheet: "SkillSheet", structural: [okCheck], specCheck: [okCheck] }]);
    expect(gate.overallLevel).toBe("OK");
  });

  test("a sheet with everything missing (both null) is OK, not FATAL -- missing is not the same claim as failing", () => {
    const gate = buildGate([{ sheet: "UntouchedSheet", structural: null, specCheck: null }]);
    expect(gate.overallLevel).toBe("OK");
    expect(gate.sheets[0]!.missingStructural).toBe(true);
    expect(gate.sheets[0]!.missingSpecCheck).toBe(true);
  });
});
