import { describe, expect, test } from "bun:test";
import { parseCsv } from "./csv";
import {
  checkAssertion,
  checkAssertions,
  filterAssertionsForSheet,
  overallLevel,
  type Assertion,
} from "./spec-datasheet-check";

const csv = parseCsv("Id,Name,Cooldown\n10113000,Longbow Shot,5\n10114000,Piercing Arrow,3\n");

describe("checkAssertion", () => {
  test("OK when the sheet value matches the spec exactly", () => {
    const a: Assertion = { id: "10113000", column: "Cooldown", expected: "5" };
    const r = checkAssertion(csv, "Id", a);
    expect(r.status).toBe("OK");
    expect(r.level).toBe("OK");
  });

  test("OK when values match numerically despite different formatting (3 vs 3.0)", () => {
    const a: Assertion = { id: "10114000", column: "Cooldown", expected: "3.0" };
    const r = checkAssertion(csv, "Id", a);
    expect(r.status).toBe("OK");
  });

  test("MISMATCH (FATAL) when the sheet value differs from the spec", () => {
    // Spec says cooldown should now be 3, but the sheet still has 5 -- exactly the case this
    // tool exists to catch before internal deploy.
    const a: Assertion = { id: "10113000", column: "Cooldown", expected: "3", note: "쿨타임 5->3" };
    const r = checkAssertion(csv, "Id", a);
    expect(r.status).toBe("MISMATCH");
    expect(r.level).toBe("FATAL");
    expect(r.detail).toContain("5->3");
  });

  test("ROW_NOT_FOUND (FATAL) when the id doesn't exist in the sheet", () => {
    const a: Assertion = { id: "99999999", column: "Cooldown", expected: "3" };
    const r = checkAssertion(csv, "Id", a);
    expect(r.status).toBe("ROW_NOT_FOUND");
    expect(r.level).toBe("FATAL");
  });

  test("COLUMN_NOT_FOUND (FATAL) when the column doesn't exist in the sheet", () => {
    const a: Assertion = { id: "10113000", column: "Damage", expected: "100" };
    const r = checkAssertion(csv, "Id", a);
    expect(r.status).toBe("COLUMN_NOT_FOUND");
    expect(r.level).toBe("FATAL");
  });

  test("COLUMN_NOT_FOUND (FATAL) when the key column itself doesn't exist", () => {
    const a: Assertion = { id: "10113000", column: "Cooldown", expected: "5" };
    const r = checkAssertion(csv, "NoSuchKey", a);
    expect(r.status).toBe("COLUMN_NOT_FOUND");
  });

  test("column and key-column lookups are case-insensitive", () => {
    const a: Assertion = { id: "10113000", column: "cooldown", expected: "5" };
    const r = checkAssertion(csv, "id", a);
    expect(r.status).toBe("OK");
  });
});

describe("filterAssertionsForSheet", () => {
  const assertions: Assertion[] = [
    { sheet: "SkillSheet", id: "1", column: "A", expected: "1" },
    { sheet: "MonsterSheet", id: "2", column: "B", expected: "2" },
    { id: "3", column: "C", expected: "3" }, // no sheet -- always applies
  ];

  test("with sheetName=null, every assertion applies (single-sheet scenario)", () => {
    expect(filterAssertionsForSheet(assertions, null)).toHaveLength(3);
  });

  test("with a sheetName, only matching + sheet-less assertions apply", () => {
    const filtered = filterAssertionsForSheet(assertions, "SkillSheet");
    expect(filtered.map((a) => a.id)).toEqual(["1", "3"]);
  });
});

describe("checkAssertions", () => {
  test("reports skipped count for assertions belonging to other sheets", () => {
    const assertions: Assertion[] = [
      { sheet: "SkillSheet", id: "10113000", column: "Cooldown", expected: "5" },
      { sheet: "MonsterSheet", id: "500001", column: "HP", expected: "1200" },
    ];
    const { results, skipped } = checkAssertions(csv, "Id", assertions, "SkillSheet");
    expect(results).toHaveLength(1);
    expect(skipped).toBe(1);
    expect(results[0]!.status).toBe("OK");
  });

  test("zero applicable assertions is not an error -- empty results, OK by convention of the caller", () => {
    const assertions: Assertion[] = [{ sheet: "OtherSheet", id: "1", column: "A", expected: "1" }];
    const { results, skipped } = checkAssertions(csv, "Id", assertions, "SkillSheet");
    expect(results).toHaveLength(0);
    expect(skipped).toBe(1);
  });
});

describe("overallLevel", () => {
  test("FATAL if any result is FATAL", () => {
    const a: Assertion = { id: "10113000", column: "Cooldown", expected: "999" };
    const r = checkAssertion(csv, "Id", a);
    expect(overallLevel([r])).toBe("FATAL");
  });

  test("OK if all results are OK", () => {
    const a: Assertion = { id: "10113000", column: "Cooldown", expected: "5" };
    const r = checkAssertion(csv, "Id", a);
    expect(overallLevel([r])).toBe("OK");
  });

  test("OK for an empty result list", () => {
    expect(overallLevel([])).toBe("OK");
  });
});
