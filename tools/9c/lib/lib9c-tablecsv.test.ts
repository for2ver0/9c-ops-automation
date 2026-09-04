import { describe, expect, test } from "bun:test";
import { lib9cTableCsvUrl } from "./lib9c-tablecsv";

describe("lib9cTableCsvUrl", () => {
  test("builds the raw.githubusercontent.com URL for a sheet at a ref", () => {
    expect(lib9cTableCsvUrl("SkillSheet", "development")).toBe(
      "https://raw.githubusercontent.com/planetarium/lib9c/development/Lib9c/TableCSV/SkillSheet.csv",
    );
  });

  test("URL-encodes an unusual ref (e.g. a branch name with a slash)", () => {
    expect(lib9cTableCsvUrl("SkillSheet", "update/tablecsv-20260904-0001")).toBe(
      "https://raw.githubusercontent.com/planetarium/lib9c/update%2Ftablecsv-20260904-0001/Lib9c/TableCSV/SkillSheet.csv",
    );
  });
});
