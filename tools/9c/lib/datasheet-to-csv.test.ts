import { describe, expect, test } from "bun:test";
import { parseCsv } from "./csv";
import { assessReadiness, buildDraftCommitMessage, buildSuggestedGitCommands, runReadinessChecks, serializeMatchingStyle } from "./datasheet-to-csv";

describe("runReadinessChecks / assessReadiness", () => {
  test("OK for a clean sheet", () => {
    const csv = parseCsv("Id,Name,Cooldown\n10113000,Longbow Shot,5\n10114000,Piercing Arrow,3\n");
    expect(assessReadiness(runReadinessChecks(csv, "Id"))).toBe("OK");
  });

  test("FATAL when the key column is empty on a data row (v200450-style failure)", () => {
    const csv = parseCsv("Id,Name,Cooldown\n,Longbow Shot,5\n10114000,Piercing Arrow,3\n");
    expect(assessReadiness(runReadinessChecks(csv, "Id"))).toBe("FATAL");
  });

  test("WARN (not FATAL) for duplicate key values -- merge-type lib9c sheets can be legitimate", () => {
    const csv = parseCsv("Id,Round,Score\n1,1,100\n1,2,200\n");
    expect(assessReadiness(runReadinessChecks(csv, "Id"))).toBe("WARN");
  });

  test("FATAL for a ragged row (column count mismatch)", () => {
    const csv = parseCsv("Id,Name,Cooldown\n10113000,Longbow Shot\n");
    expect(assessReadiness(runReadinessChecks(csv, "Id"))).toBe("FATAL");
  });

  test("a lib9c-style annotation row (leading _) does not trigger key-column-empty", () => {
    const csv = parseCsv('Id,Name,Cooldown\n_comment,"explains the column",\n10113000,Longbow Shot,5\n');
    expect(assessReadiness(runReadinessChecks(csv, "Id"))).toBe("OK");
  });
});

describe("buildDraftCommitMessage", () => {
  test("matches the observed lib9c convention exactly", () => {
    expect(buildDraftCommitMessage("SkillSheet")).toBe("Update SkillSheet.csv from Google Sheets");
  });
});

describe("serializeMatchingStyle", () => {
  const csv = { headers: ["Id", "Name"], rows: [["1", "Slime"]] };

  test("defaults to LF, no trailing newline when there's no reference (new sheet)", () => {
    expect(serializeMatchingStyle(csv, null)).toBe("Id,Name\n1,Slime");
  });

  test("matches an LF, no-trailing-newline reference (e.g. real SkillSheet.csv style)", () => {
    expect(serializeMatchingStyle(csv, "id,_name\n10113000,Longbow Shot")).toBe("Id,Name\n1,Slime");
  });

  test("matches a CRLF, trailing-newline reference (e.g. real CollectionSheet.csv style)", () => {
    expect(serializeMatchingStyle(csv, "id,name\r\n1,x\r\n")).toBe("Id,Name\r\n1,Slime\r\n");
  });

  test("matches an LF reference that does have a trailing newline (e.g. real EventScheduleSheet.csv style)", () => {
    expect(serializeMatchingStyle(csv, "id,name\n1,x\n")).toBe("Id,Name\n1,Slime\n");
  });
});

describe("buildSuggestedGitCommands", () => {
  test("produces copy-pasteable, non-executed command text", () => {
    const cmds = buildSuggestedGitCommands("SkillSheet", "./out/SkillSheet.csv", "update/tablecsv-20260904-01", "Update SkillSheet.csv from Google Sheets");
    expect(cmds).toEqual([
      "git checkout -b update/tablecsv-20260904-01",
      "cp ./out/SkillSheet.csv Lib9c/TableCSV/SkillSheet.csv",
      "git add Lib9c/TableCSV/SkillSheet.csv",
      'git commit -m "Update SkillSheet.csv from Google Sheets"',
      "git push -u <fork-remote> update/tablecsv-20260904-01",
    ]);
  });
});
