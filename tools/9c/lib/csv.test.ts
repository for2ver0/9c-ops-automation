import { describe, expect, test } from "bun:test";
import { parseCsv, serializeCsv } from "./csv";

describe("serializeCsv", () => {
  test("plain values need no quoting -- matches lib9c's unquoted convention", () => {
    const csv = { headers: ["Id", "Name", "Cooldown"], rows: [["10113000", "Longbow Shot", "5"]] };
    expect(serializeCsv(csv)).toBe("Id,Name,Cooldown\n10113000,Longbow Shot,5");
  });

  test("quotes only a field that contains a comma", () => {
    const csv = { headers: ["Id", "Note"], rows: [["1", "a, b"]] };
    expect(serializeCsv(csv)).toBe('Id,Note\n1,"a, b"');
  });

  test("quotes a field with an embedded quote and doubles it", () => {
    const csv = { headers: ["Id", "Note"], rows: [["1", 'say "hi"']] };
    expect(serializeCsv(csv)).toBe('Id,Note\n1,"say ""hi"""');
  });

  test("quotes a field containing a newline and normalizes it to LF", () => {
    const csv = { headers: ["Id", "Note"], rows: [["1", "line1\r\nline2"]] };
    expect(serializeCsv(csv)).toBe('Id,Note\n1,"line1\nline2"');
  });

  test("no trailing newline -- matches lib9c TableCSV files (confirmed against the live SkillSheet.csv)", () => {
    const csv = { headers: ["Id"], rows: [] };
    expect(serializeCsv(csv)).toBe("Id");
    expect(serializeCsv(csv).endsWith("\n")).toBe(false);
  });

  test("round-trips through parseCsv for plain data", () => {
    const original = parseCsv("Id,Name,Cooldown\n10113000,Longbow Shot,5\n10114000,Piercing Arrow,3\n");
    const reparsed = parseCsv(serializeCsv(original));
    expect(reparsed).toEqual(original);
  });

  test("round-trips a value that needs quoting", () => {
    const original = parseCsv('Id,Note\n1,"a, b"\n2,"say ""hi"""\n');
    const reparsed = parseCsv(serializeCsv(original));
    expect(reparsed).toEqual(original);
  });
});
