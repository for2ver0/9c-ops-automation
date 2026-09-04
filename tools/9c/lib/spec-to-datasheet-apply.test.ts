import { describe, expect, test } from "bun:test";
import { parseCsv } from "./csv";
import { buildPlan, type PlanItem } from "./spec-to-datasheet";
import { buildRowValues, isSheetWriteLogEntry, selectWriteTargets } from "./spec-to-datasheet-apply";

const csv = parseCsv("Id,Name,Cooldown\n10113000,Longbow Shot,5\n10114000,Piercing Arrow,3\n");

describe("selectWriteTargets", () => {
  test("CHANGE (level OK) becomes a cellUpdate with the right row/column index", () => {
    const plan: PlanItem[] = [{ id: "10113000", column: "Cooldown", expected: "3" }];
    const summary = buildPlan(csv, "Id", plan, null);
    const targets = selectWriteTargets(csv, "Id", summary, "SkillSheet");
    expect(targets.cellUpdates).toEqual([
      { sheet: "SkillSheet", id: "10113000", column: "Cooldown", rowIndex0: 0, colIndex0: 2, before: "5", after: "3" },
    ]);
    expect(targets.rowInserts).toEqual([]);
    expect(targets.skipped).toEqual([]);
  });

  test("NEW_ROW with every column covered becomes a rowInsert", () => {
    const plan: PlanItem[] = [
      { id: "10115000", column: "Name", expected: "New Skill" },
      { id: "10115000", column: "Cooldown", expected: "4" },
    ];
    const summary = buildPlan(csv, "Id", plan, null);
    const targets = selectWriteTargets(csv, "Id", summary, "SkillSheet");
    expect(targets.cellUpdates).toEqual([]);
    expect(targets.rowInserts).toEqual([{ sheet: "SkillSheet", id: "10115000", values: ["10115000", "New Skill", "4"] }]);
    expect(targets.skipped).toEqual([]);
  });

  test("NEW_ROW missing a column is skipped, not auto-written -- would leave a blank cell", () => {
    const plan: PlanItem[] = [{ id: "10115000", column: "Cooldown", expected: "4" }];
    const summary = buildPlan(csv, "Id", plan, null);
    const targets = selectWriteTargets(csv, "Id", summary, "SkillSheet");
    expect(targets.rowInserts).toEqual([]);
    expect(targets.cellUpdates).toEqual([]);
    expect(targets.skipped).toHaveLength(1);
    expect(targets.skipped[0]!.status).toBe("NEW_ROW");
  });

  test("a duplicate-key (merge-type-suspect) row is never auto-written -- always skipped", () => {
    const dup = parseCsv("Id,Name,Cooldown\n10113000,A,5\n10113000,A dup,9\n");
    const plan: PlanItem[] = [{ id: "10113000", column: "Cooldown", expected: "7" }];
    const summary = buildPlan(dup, "Id", plan, null);
    const targets = selectWriteTargets(dup, "Id", summary, "SkillSheet");
    expect(targets.cellUpdates).toEqual([]);
    expect(targets.skipped).toHaveLength(1);
    expect(targets.skipped[0]!.level).toBe("WARN");
  });

  test("COLUMN_NOT_FOUND (FATAL) is always skipped", () => {
    const plan: PlanItem[] = [{ id: "10113000", column: "Damage", expected: "100" }];
    const summary = buildPlan(csv, "Id", plan, null);
    const targets = selectWriteTargets(csv, "Id", summary, "SkillSheet");
    expect(targets.cellUpdates).toEqual([]);
    expect(targets.rowInserts).toEqual([]);
    expect(targets.skipped).toHaveLength(1);
    expect(targets.skipped[0]!.level).toBe("FATAL");
  });

  test("NO_CHANGE (level OK) needs no write and is not reported as skipped", () => {
    const plan: PlanItem[] = [{ id: "10114000", column: "Cooldown", expected: "3" }];
    const summary = buildPlan(csv, "Id", plan, null);
    const targets = selectWriteTargets(csv, "Id", summary, "SkillSheet");
    expect(targets.cellUpdates).toEqual([]);
    expect(targets.rowInserts).toEqual([]);
    expect(targets.skipped).toEqual([]);
  });
});

describe("buildRowValues", () => {
  test("orders values by header and fills the key column with the id", () => {
    const values = buildRowValues(
      ["Id", "Name", "Cooldown"],
      "Id",
      "10115000",
      [
        { id: "10115000", column: "Cooldown", expected: "4" },
        { id: "10115000", column: "Name", expected: "New Skill" },
      ],
    );
    expect(values).toEqual(["10115000", "New Skill", "4"]);
  });

  test("a column the plan doesn't cover is left blank", () => {
    const values = buildRowValues(["Id", "Name", "Cooldown"], "Id", "1", [{ id: "1", column: "Name", expected: "X" }]);
    expect(values).toEqual(["1", "X", ""]);
  });
});

describe("isSheetWriteLogEntry", () => {
  const valid = {
    observedAt: "2026-09-04T00:00:00.000Z",
    sheet: "SkillSheet",
    id: "10113000",
    column: "Cooldown",
    before: "5",
    after: "3",
    range: "'SkillSheet'!C2",
    planFile: "./plan.json",
  };

  test("accepts a well-formed entry", () => {
    expect(isSheetWriteLogEntry(valid)).toBe(true);
  });

  test("accepts before: null (new-row inserts have no prior value)", () => {
    expect(isSheetWriteLogEntry({ ...valid, before: null })).toBe(true);
  });

  test("rejects garbage lines", () => {
    expect(isSheetWriteLogEntry({ unrelated: true })).toBe(false);
    expect(isSheetWriteLogEntry(null)).toBe(false);
    expect(isSheetWriteLogEntry("just a string")).toBe(false);
    expect(isSheetWriteLogEntry({ ...valid, column: 5 })).toBe(false);
    expect(isSheetWriteLogEntry({ ...valid, before: 5 })).toBe(false);
  });
});
