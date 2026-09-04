import { describe, expect, test } from "bun:test";
import { cellA1, columnIndexToLetter, quoteSheetName } from "./a1-notation";

describe("columnIndexToLetter", () => {
  test.each([
    [0, "A"],
    [1, "B"],
    [25, "Z"],
    [26, "AA"],
    [27, "AB"],
    [51, "AZ"],
    [701, "ZZ"],
    [702, "AAA"],
  ])("index %i -> %s", (index0, expected) => {
    expect(columnIndexToLetter(index0)).toBe(expected);
  });

  test("rejects negative or non-integer indexes", () => {
    expect(() => columnIndexToLetter(-1)).toThrow();
    expect(() => columnIndexToLetter(1.5)).toThrow();
  });
});

describe("quoteSheetName", () => {
  test("wraps the name in single quotes", () => {
    expect(quoteSheetName("SkillSheet")).toBe("'SkillSheet'");
  });

  test("doubles an embedded single quote (sheet name escaping rule)", () => {
    expect(quoteSheetName("O'Brien Sheet")).toBe("'O''Brien Sheet'");
  });

  test("handles spaces in the sheet name", () => {
    expect(quoteSheetName("Skill Sheet 2")).toBe("'Skill Sheet 2'");
  });
});

describe("cellA1", () => {
  test("builds a quoted-sheet single-cell range", () => {
    expect(cellA1("SkillSheet", 2, 7)).toBe("'SkillSheet'!C7");
  });

  test("handles a sheet name with a space and a multi-letter column", () => {
    expect(cellA1("Skill Sheet", 26, 100)).toBe("'Skill Sheet'!AA100");
  });

  test("rejects a row number below 1", () => {
    expect(() => cellA1("SkillSheet", 0, 0)).toThrow();
  });
});
