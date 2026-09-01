import { describe, expect, test } from "bun:test";
import {
  parseCsv,
  checkDuplicateHeaders,
  checkRowColumnCounts,
  checkKeyColumnNonEmpty,
  checkRowCountAgainstBaseline,
  overallLevel,
  runStructuralChecks,
} from "./datasheet-validate";

describe("parseCsv", () => {
  test("splits a simple CSV into headers and rows", () => {
    const csv = parseCsv("Id,Name,Value\n1,Sword,10\n2,Shield,20\n");
    expect(csv.headers).toEqual(["Id", "Name", "Value"]);
    expect(csv.rows).toEqual([
      ["1", "Sword", "10"],
      ["2", "Shield", "20"],
    ]);
  });

  test("treats commas inside quoted fields as part of the value, not a delimiter", () => {
    // Backoffice's ValidateBasicCsvFormat did lines[i].Split(',') and false-flagged rows like
    // this as a column-count mismatch (부록 A-1, WorldBossActionPatternSheet.csv-like case).
    const csv = parseCsv('Id,Pattern,Note\n1,"1,2,3","boss, phase 1"\n');
    expect(csv.headers).toEqual(["Id", "Pattern", "Note"]);
    expect(csv.rows).toEqual([["1", "1,2,3", "boss, phase 1"]]);
  });

  test("unescapes doubled quotes inside a quoted field", () => {
    const csv = parseCsv('Id,Note\n1,"say ""hi"""\n');
    expect(csv.rows).toEqual([["1", 'say "hi"']]);
  });

  test("preserves embedded newlines inside quoted fields", () => {
    const csv = parseCsv('Id,Note\n1,"line1\nline2"\n2,plain\n');
    expect(csv.rows).toEqual([
      ["1", "line1\nline2"],
      ["2", "plain"],
    ]);
  });

  test("does not silently drop blank lines before parsing (no line-number drift)", () => {
    // Backoffice's ParseCsv used RemoveEmptyEntries on the raw lines first, which shifted
    // every subsequent error's reported line number away from the real file (부록 A-1).
    // A trailing newline alone should not manufacture a phantom row.
    const csv = parseCsv("Id,Name\n1,A\n2,B\n");
    expect(csv.rows).toHaveLength(2);
  });

  test("returns empty headers/rows for empty input", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
  });
});

describe("checkDuplicateHeaders", () => {
  test("OK when all headers are unique", () => {
    expect(checkDuplicateHeaders(["Id", "Name", "Value"]).level).toBe("OK");
  });

  test("FATAL when a header repeats (worldboss_info.csv Vietnam-duplicate pattern)", () => {
    const result = checkDuplicateHeaders(["Key", "Korean", "Vietnam", "Japanese", "Vietnam"]);
    expect(result.level).toBe("FATAL");
    expect(result.detail).toContain("Vietnam");
  });
});

describe("checkRowColumnCounts", () => {
  const headers = ["Id", "Name", "Value"];

  test("OK when every row matches the header width", () => {
    const rows = [
      ["1", "A", "10"],
      ["2", "B", "20"],
    ];
    expect(checkRowColumnCounts(headers, rows).level).toBe("OK");
  });

  test("FATAL when a row has fewer or more columns than the header", () => {
    const rows = [
      ["1", "A", "10"],
      ["2", "B"], // missing a column
      ["3", "C", "30", "extra"], // extra column
    ];
    const result = checkRowColumnCounts(headers, rows);
    expect(result.level).toBe("FATAL");
    expect(result.detail).toContain("3행");
    expect(result.detail).toContain("4행");
  });
});

describe("checkKeyColumnNonEmpty", () => {
  const headers = ["Id", "Name"];

  test("OK when the key column is filled for every row", () => {
    const rows = [
      ["1", "A"],
      ["2", "B"],
    ];
    expect(checkKeyColumnNonEmpty(headers, rows, "Id").level).toBe("OK");
  });

  test("FATAL when the key column is blank on some rows (ArgumentException precursor, v200450)", () => {
    const rows = [
      ["1", "A"],
      ["", "B"],
      ["  ", "C"],
    ];
    const result = checkKeyColumnNonEmpty(headers, rows, "Id");
    expect(result.level).toBe("FATAL");
    expect(result.detail).toContain("3, 4행");
  });

  test("WARN (not FATAL) when the key column name isn't in the header at all", () => {
    const result = checkKeyColumnNonEmpty(headers, [["1", "A"]], "SkuId");
    expect(result.level).toBe("WARN");
  });

  test("WARN (not FATAL) when no key column is specified", () => {
    const result = checkKeyColumnNonEmpty(headers, [["1", "A"]], null);
    expect(result.level).toBe("WARN");
  });

  test("is case-insensitive when matching the key column name", () => {
    expect(checkKeyColumnNonEmpty(["id", "Name"], [["1", "A"]], "Id").level).toBe("OK");
  });
});

describe("checkRowCountAgainstBaseline", () => {
  test("OK (informational) when there is no baseline yet", () => {
    const result = checkRowCountAgainstBaseline(23, null);
    expect(result.level).toBe("OK");
  });

  test("OK when row count holds steady or grows", () => {
    expect(checkRowCountAgainstBaseline(23, 23).level).toBe("OK");
    expect(checkRowCountAgainstBaseline(25, 23).level).toBe("OK");
  });

  test("FATAL when row count drops (SkillBuffSheet 188-row-loss pattern, v200450)", () => {
    const result = checkRowCountAgainstBaseline(0, 188);
    expect(result.level).toBe("FATAL");
    expect(result.detail).toContain("188");
  });
});

describe("overallLevel", () => {
  test("FATAL wins over WARN and OK", () => {
    expect(overallLevel([{ id: "a", name: "a", ok: true, level: "OK", detail: "" }, { id: "b", name: "b", ok: false, level: "FATAL", detail: "" }])).toBe(
      "FATAL",
    );
  });

  test("WARN wins over OK when there's no FATAL", () => {
    expect(overallLevel([{ id: "a", name: "a", ok: true, level: "OK", detail: "" }, { id: "b", name: "b", ok: false, level: "WARN", detail: "" }])).toBe(
      "WARN",
    );
  });

  test("OK when everything passes", () => {
    expect(overallLevel([{ id: "a", name: "a", ok: true, level: "OK", detail: "" }])).toBe("OK");
  });
});

describe("runStructuralChecks — v200450 regression scenarios end-to-end", () => {
  test("clean sheet passes all four checks", () => {
    const csv = parseCsv("Id,Name,Value\n1,Sword,10\n2,Shield,20\n");
    const checks = runStructuralChecks(csv, { keyColumn: "Id", baselineRows: 2 });
    expect(overallLevel(checks)).toBe("OK");
  });

  test("corrupted header row (duplicate header) is caught", () => {
    const csv = parseCsv("Id,Value,Value\n1,10,11\n");
    const checks = runStructuralChecks(csv, { keyColumn: "Id", baselineRows: null });
    expect(overallLevel(checks)).toBe("FATAL");
  });

  test("emptied key column is caught", () => {
    const csv = parseCsv("Id,Name\n,Sword\n2,Shield\n");
    const checks = runStructuralChecks(csv, { keyColumn: "Id", baselineRows: null });
    expect(overallLevel(checks)).toBe("FATAL");
  });

  test("dropped rows vs. baseline are caught even though the CSV itself is well-formed", () => {
    const csv = parseCsv("Id,Name\n1,Sword\n");
    const checks = runStructuralChecks(csv, { keyColumn: "Id", baselineRows: 188 });
    expect(overallLevel(checks)).toBe("FATAL");
  });
});
