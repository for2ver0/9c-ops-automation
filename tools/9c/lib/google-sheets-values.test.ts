import { describe, expect, test } from "bun:test";
import { sheetValuesToParsedCsv } from "./google-sheets-values";

describe("sheetValuesToParsedCsv", () => {
  test("empty input produces an empty sheet", () => {
    expect(sheetValuesToParsedCsv([])).toEqual({ headers: [], rows: [] });
  });

  test("header-only input produces zero rows", () => {
    expect(sheetValuesToParsedCsv([["Id", "Name", "Cooldown"]])).toEqual({
      headers: ["Id", "Name", "Cooldown"],
      rows: [],
    });
  });

  test("pads a short row out to the header width -- Sheets API omits trailing empty cells", () => {
    const result = sheetValuesToParsedCsv([
      ["Id", "Name", "Cooldown"],
      ["10113000"],
      ["10114000", "Piercing Arrow"],
    ]);
    expect(result.rows).toEqual([
      ["10113000", "", ""],
      ["10114000", "Piercing Arrow", ""],
    ]);
  });

  test("a fully populated row passes through unchanged", () => {
    const result = sheetValuesToParsedCsv([
      ["Id", "Name", "Cooldown"],
      ["10113000", "Longbow Shot", "5"],
    ]);
    expect(result.rows).toEqual([["10113000", "Longbow Shot", "5"]]);
  });
});
