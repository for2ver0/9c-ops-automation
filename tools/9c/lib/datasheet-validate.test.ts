import { describe, expect, test } from "bun:test";
import {
  parseCsv,
  checkDuplicateHeaders,
  checkRowColumnCounts,
  checkKeyColumnNonEmpty,
  checkRowCountAgainstBaseline,
  checkBaselineDiff,
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

describe("checkBaselineDiff", () => {
  test("OK (informational), skipped when there is no baseline CSV yet", () => {
    const csv = parseCsv("Id,Name\n1,Sword\n");
    const result = checkBaselineDiff(csv, null, "Id");
    expect(result.level).toBe("OK");
    expect(result.detail).toContain("건너뜁니다");
  });

  test("WARN (not blocking) when no key column is given, even with a baseline present", () => {
    const baseline = parseCsv("Id,Name\n1,Sword\n");
    const csv = parseCsv("Id,Name\n1,Sword\n2,Shield\n");
    const result = checkBaselineDiff(csv, baseline, null);
    expect(result.level).toBe("WARN");
  });

  test("OK and reports counts when rows/columns changed — never escalates to FATAL by itself", () => {
    const baseline = parseCsv("Id,Damage\n1,100\n2,50\n");
    const csv = parseCsv("Id,Damage\n1,120\n3,30\n");
    const result = checkBaselineDiff(csv, baseline, "Id");
    expect(result.level).toBe("OK");
    expect(result.detail).toContain("추가 1행");
    expect(result.detail).toContain("삭제 1행");
    expect(result.detail).toContain("변경 1행");
  });

  test("does not invent a 'too much changed' threshold — even a near-total rewrite stays OK", () => {
    const baseline = parseCsv("Id,Damage\n1,1\n2,1\n3,1\n4,1\n5,1\n");
    const csv = parseCsv("Id,Damage\n1,9\n2,9\n3,9\n4,9\n5,9\n");
    const result = checkBaselineDiff(csv, baseline, "Id");
    expect(result.level).toBe("OK");
    expect(result.detail).toContain("변경 5행");
  });

  test("flags duplicate keys in the note rather than silently trusting the diff", () => {
    const baseline = parseCsv("Id,Damage\n1,100\n1,200\n");
    const csv = parseCsv("Id,Damage\n1,100\n");
    const result = checkBaselineDiff(csv, baseline, "Id");
    expect(result.detail).toContain("중복 키");
  });

  test("degrades to WARN (not a crash) when the key column is missing from one file", () => {
    const baseline = parseCsv("Uid,Damage\n1,100\n");
    const csv = parseCsv("Id,Damage\n1,100\n");
    const result = checkBaselineDiff(csv, baseline, "Id");
    expect(result.level).toBe("WARN");
    expect(result.ok).toBe(false);
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

  test("baselineCsv alone (no --baseline-rows) is enough to catch a row-count drop", () => {
    const baseline = parseCsv("Id,Name\n1,A\n2,B\n3,C\n");
    const csv = parseCsv("Id,Name\n1,A\n");
    const checks = runStructuralChecks(csv, { keyColumn: "Id", baselineRows: null, baselineCsv: baseline });
    expect(overallLevel(checks)).toBe("FATAL");
    expect(checks.find((c) => c.id === "row-count-vs-baseline")?.detail).toContain("직전 3행");
  });

  test("explicit baselineRows takes precedence over baselineCsv's row count when both given", () => {
    const baseline = parseCsv("Id,Name\n1,A\n2,B\n3,C\n"); // 3 rows
    const csv = parseCsv("Id,Name\n1,A\n2,B\n");
    const checks = runStructuralChecks(csv, { keyColumn: "Id", baselineRows: 1, baselineCsv: baseline });
    // baselineRows=1 explicitly wins, so 2 rows now vs baseline 1 should be a non-drop (OK)
    expect(checks.find((c) => c.id === "row-count-vs-baseline")?.level).toBe("OK");
  });

  test("baselineCsv also feeds the row/column diff check", () => {
    const baseline = parseCsv("Id,Name\n1,A\n2,B\n");
    const csv = parseCsv("Id,Name\n1,A\n2,B\n3,C\n");
    const checks = runStructuralChecks(csv, { keyColumn: "Id", baselineRows: null, baselineCsv: baseline });
    const diffCheck = checks.find((c) => c.id === "baseline-diff");
    expect(diffCheck?.detail).toContain("추가 1행");
  });
});
