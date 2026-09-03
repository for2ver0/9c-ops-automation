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

// --- 2026-09-03 "조용한 OK" 점검 회귀 --------------------------------------------------
// 칸 수가 어긋난 CSV를 넣으면 diff 자체는 정직하게 밀린 값을 보여주지만(`Name "slime"→"100"`),
// 그게 데이터 변경인지 파일이 깨진 건지는 구분해주지 않아 QA 담당자가 의도된 변경으로 오해할
// 수 있었다. 구조 검증을 여기서 다시 하지 않고 "칸 수가 다른 행이 있다"는 신호만 준다.
describe("칸 수가 어긋난 행 신호 (2026-09-03)", () => {
  test("after에 칸 수가 다른 행이 있으면 세어서 알린다", () => {
    const before = parseCsv("Id,Name,HP\n1,slime,100\n");
    const after = parseCsv("Id,Name,HP\n1,100\n");
    const diff = diffSheet(before, after, "Id");
    expect(diff.raggedRowsAfter).toBe(1);
    expect(diff.raggedRowsBefore).toBe(0);
    const items = buildQaChecklist("S", diff);
    expect(items.some((i) => i.includes("칸 수가 다른 행"))).toBe(true);
    expect(items.some((i) => i.includes("datasheet-validate"))).toBe(true);
  });

  test("정상 파일에는 이 신호가 뜨지 않는다", () => {
    const before = parseCsv("Id,V\n1,a\n2,b\n");
    const after = parseCsv("Id,V\n1,x\n2,b\n");
    const diff = diffSheet(before, after, "Id");
    expect(diff.raggedRowsBefore).toBe(0);
    expect(diff.raggedRowsAfter).toBe(0);
    expect(buildQaChecklist("S", diff).some((i) => i.includes("칸 수가 다른 행"))).toBe(false);
  });

  test("before 쪽이 깨진 경우도 잡는다", () => {
    const before = parseCsv("Id,V,W\n1,a\n");
    const after = parseCsv("Id,V,W\n1,a,b\n");
    expect(diffSheet(before, after, "Id").raggedRowsBefore).toBe(1);
  });

  test("파일 중간 빈 줄도 칸 수 불일치로 세되, 문구가 '위 값 변경'을 전제하지 않는다", () => {
    // 2026-09-03: 처음 문구가 "위 값 변경이 실제 변경이 아니라 셀이 밀린 결과일 수 있습니다"
    // 였는데, 빈 줄만 있는 경우엔 값 변경이 0건이라 가리킬 대상이 없었다.
    const before = parseCsv("Id,V\n1,a\n2,b\n");
    const after = parseCsv("Id,V\n1,a\n\n2,b\n");
    const diff = diffSheet(before, after, "Id");
    expect(diff.raggedRowsAfter).toBe(1);
    expect(diff.changed).toHaveLength(0);
    const line = buildQaChecklist("S", diff).find((i) => i.includes("칸 수가 다른 행"))!;
    expect(line).toContain("빈 줄이거나");
    expect(line).not.toContain("위 값 변경이 실제 변경이 아니라");
  });
});
