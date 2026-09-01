import { describe, expect, test } from "bun:test";
import { parseCsv, diffHeaders, diffSheet, buildQaChecklist } from "./qa-checklist";

describe("diffHeaders", () => {
  test("finds added and removed columns, ignores order and unchanged columns", () => {
    const result = diffHeaders(["Id", "Damage", "Old"], ["Id", "Damage", "New"]);
    expect(result.added).toEqual(["New"]);
    expect(result.removed).toEqual(["Old"]);
  });

  test("empty when identical (order-independent)", () => {
    expect(diffHeaders(["Id", "Damage"], ["Damage", "Id"])).toEqual({ added: [], removed: [] });
  });
});

describe("diffSheet", () => {
  test("classifies added/removed/changed rows by key column", () => {
    const before = parseCsv("Id,Damage,Name\n1,100,Sword\n2,50,Shield\n");
    const after = parseCsv("Id,Damage,Name\n1,120,Sword\n3,30,Bow\n");
    const diff = diffSheet(before, after, "Id");
    expect(diff.added).toEqual(["3"]);
    expect(diff.removed).toEqual(["2"]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].key).toBe("1");
    expect(diff.changed[0].fields).toEqual([{ column: "Damage", before: "100", after: "120" }]);
  });

  test("only compares columns common to both files", () => {
    const before = parseCsv("Id,Damage\n1,100\n");
    const after = parseCsv("Id,Damage,Extra\n1,100,x\n");
    const diff = diffSheet(before, after, "Id");
    expect(diff.changed).toEqual([]);
    expect(diff.columnChanges.added).toEqual(["Extra"]);
  });

  test("does not report unchanged rows", () => {
    const before = parseCsv("Id,Damage\n1,100\n");
    const after = parseCsv("Id,Damage\n1,100\n");
    const diff = diffSheet(before, after, "Id");
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  test("throws when the key column is missing from either file", () => {
    const before = parseCsv("Id,Damage\n1,100\n");
    const after = parseCsv("Uid,Damage\n1,100\n");
    expect(() => diffSheet(before, after, "Id")).toThrow(/이후\(after\) 쪽/);
  });

  test("case-insensitive key column match, mirroring datasheet-validate", () => {
    const before = parseCsv("id,Damage\n1,100\n");
    const after = parseCsv("ID,Damage\n1,120\n");
    const diff = diffSheet(before, after, "Id");
    expect(diff.changed[0]?.key).toBe("1");
  });

  test("flags duplicate keys within a single file instead of silently picking one", () => {
    const before = parseCsv("Id,Damage\n1,100\n1,200\n");
    const after = parseCsv("Id,Damage\n1,100\n");
    const diff = diffSheet(before, after, "Id");
    expect(diff.duplicateKeysBefore).toEqual(["1"]);
  });

  test("skips rows with an empty key rather than treating them as key ''", () => {
    const before = parseCsv("Id,Damage\n,100\n1,50\n");
    const after = parseCsv("Id,Damage\n1,50\n");
    const diff = diffSheet(before, after, "Id");
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });
});

describe("buildQaChecklist", () => {
  test("emits one line per added/removed/changed row plus a summary-worthy set", () => {
    const before = parseCsv("Id,Damage\n1,100\n2,50\n");
    const after = parseCsv("Id,Damage\n1,120\n3,30\n");
    const diff = diffSheet(before, after, "Id");
    const items = buildQaChecklist("TestSheet", diff);
    expect(items.some((i) => i.includes("신규 행 1건"))).toBe(true);
    expect(items.some((i) => i.includes("행 1건 삭제"))).toBe(true);
    expect(items.some((i) => i.includes("Id=1") && i.includes("Damage"))).toBe(true);
  });

  test("says 'no change' explicitly rather than an empty list when nothing differs", () => {
    const before = parseCsv("Id,Damage\n1,100\n");
    const after = parseCsv("Id,Damage\n1,100\n");
    const diff = diffSheet(before, after, "Id");
    const items = buildQaChecklist("TestSheet", diff);
    expect(items).toEqual(["[x] TestSheet: 변경 없음."]);
  });

  test("truncates large change sets with a count instead of dumping everything", () => {
    const rows = Array.from({ length: 30 }, (_, i) => `${i},0`).join("\n");
    const rowsChanged = Array.from({ length: 30 }, (_, i) => `${i},1`).join("\n");
    const before = parseCsv(`Id,Damage\n${rows}\n`);
    const after = parseCsv(`Id,Damage\n${rowsChanged}\n`);
    const diff = diffSheet(before, after, "Id");
    const items = buildQaChecklist("TestSheet", diff);
    expect(items.some((i) => i.includes("그 외") && i.includes("건의 변경 행"))).toBe(true);
  });

  test("surfaces duplicate-key warnings as their own lines", () => {
    const before = parseCsv("Id,Damage\n1,100\n1,200\n");
    const after = parseCsv("Id,Damage\n1,100\n");
    const diff = diffSheet(before, after, "Id");
    const items = buildQaChecklist("TestSheet", diff);
    expect(items.some((i) => i.startsWith("[!]") && i.includes("중복된 Id"))).toBe(true);
  });
});
