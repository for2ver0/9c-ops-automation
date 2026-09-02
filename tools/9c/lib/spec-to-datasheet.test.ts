import { describe, expect, test } from "bun:test";
import { parseCsv } from "./csv";
import {
  buildPlan,
  buildWorkItem,
  findNewRowGaps,
  overallLevel,
  type PlanItem,
  type WorkItem,
} from "./spec-to-datasheet";

const csv = parseCsv("Id,Name,Cooldown\n10113000,Longbow Shot,5\n10114000,Piercing Arrow,3\n");

describe("buildWorkItem", () => {
  test("CHANGE when the row exists and the value differs -- shows before -> after", () => {
    const item: PlanItem = { id: "10113000", column: "Cooldown", expected: "3", note: "기획서 3.2절" };
    const w = buildWorkItem(csv, "Id", item);
    expect(w.status).toBe("CHANGE");
    expect(w.currentValue).toBe("5");
    expect(w.detail).toContain('"5" → "3"');
  });

  test("NO_CHANGE when the sheet already holds the planned value -- no work needed", () => {
    const item: PlanItem = { id: "10114000", column: "Cooldown", expected: "3" };
    const w = buildWorkItem(csv, "Id", item);
    expect(w.status).toBe("NO_CHANGE");
    expect(w.level).toBe("OK");
  });

  test("NO_CHANGE treats numerically equal values as already applied (3 vs 3.0)", () => {
    const item: PlanItem = { id: "10114000", column: "Cooldown", expected: "3.0" };
    expect(buildWorkItem(csv, "Id", item).status).toBe("NO_CHANGE");
  });

  test("NEW_ROW (not FATAL) when the id is absent -- this runs BEFORE the sheet is edited", () => {
    // This is the key semantic difference from spec-datasheet-check, where a missing row is FATAL.
    const item: PlanItem = { id: "10115000", column: "Cooldown", expected: "4" };
    const w = buildWorkItem(csv, "Id", item);
    expect(w.status).toBe("NEW_ROW");
    expect(w.level).toBe("OK");
    expect(w.currentValue).toBeNull();
  });

  test("COLUMN_NOT_FOUND (FATAL) when the column name is not in the sheet", () => {
    const item: PlanItem = { id: "10113000", column: "Damage", expected: "100" };
    const w = buildWorkItem(csv, "Id", item);
    expect(w.status).toBe("COLUMN_NOT_FOUND");
    expect(w.level).toBe("FATAL");
  });

  test("COLUMN_NOT_FOUND (FATAL) when the key column itself is missing", () => {
    const item: PlanItem = { id: "10113000", column: "Cooldown", expected: "3" };
    expect(buildWorkItem(csv, "NoSuchKey", item).status).toBe("COLUMN_NOT_FOUND");
  });

  test("column lookups are case-insensitive", () => {
    const item: PlanItem = { id: "10113000", column: "cooldown", expected: "3" };
    expect(buildWorkItem(csv, "id", item).status).toBe("CHANGE");
  });
});

describe("findNewRowGaps", () => {
  test("lists sheet columns the plan gives no value for on a new row", () => {
    const items: PlanItem[] = [{ id: "10115000", column: "Cooldown", expected: "4" }];
    const work = items.map((i) => buildWorkItem(csv, "Id", i));
    const gaps = findNewRowGaps(csv, "Id", work);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.id).toBe("10115000");
    expect(gaps[0]!.missingColumns).toEqual(["Name"]); // Id is the key, Cooldown is covered
  });

  test("no gap when the plan covers every non-key column of the new row", () => {
    const items: PlanItem[] = [
      { id: "10115000", column: "Name", expected: "New Skill" },
      { id: "10115000", column: "Cooldown", expected: "4" },
    ];
    const work = items.map((i) => buildWorkItem(csv, "Id", i));
    expect(findNewRowGaps(csv, "Id", work)[0]!.missingColumns).toEqual([]);
  });

  test("existing rows produce no gaps (only NEW_ROW ids are considered)", () => {
    const items: PlanItem[] = [{ id: "10113000", column: "Cooldown", expected: "3" }];
    const work = items.map((i) => buildWorkItem(csv, "Id", i));
    expect(findNewRowGaps(csv, "Id", work)).toEqual([]);
  });
});

describe("overallLevel", () => {
  const ok: WorkItem = {
    item: { id: "1", column: "A", expected: "1" },
    status: "CHANGE",
    level: "OK",
    currentValue: "0",
    detail: "",
  };
  const fatal: WorkItem = { ...ok, status: "COLUMN_NOT_FOUND", level: "FATAL", currentValue: null };

  test("FATAL wins over everything", () => {
    expect(overallLevel([ok, fatal], [])).toBe("FATAL");
  });

  test("an unfilled column on a new row makes it WARN -- following the sheet leaves a blank cell", () => {
    expect(overallLevel([ok], [{ id: "1", missingColumns: ["Name"] }])).toBe("WARN");
  });

  test("OK when every change is specified and nothing is missing", () => {
    expect(overallLevel([ok], [{ id: "1", missingColumns: [] }])).toBe("OK");
  });
});

describe("buildPlan", () => {
  test("filters by sheet name and counts each status", () => {
    const plan: PlanItem[] = [
      { sheet: "SkillSheet", id: "10113000", column: "Cooldown", expected: "3" }, // CHANGE
      { sheet: "SkillSheet", id: "10114000", column: "Cooldown", expected: "3" }, // NO_CHANGE
      { sheet: "MonsterSheet", id: "500001", column: "HP", expected: "1200" }, // skipped
    ];
    const s = buildPlan(csv, "Id", plan, "SkillSheet");
    expect(s.workItems).toHaveLength(2);
    expect(s.skipped).toBe(1);
    expect(s.counts.CHANGE).toBe(1);
    expect(s.counts.NO_CHANGE).toBe(1);
    expect(s.level).toBe("OK");
  });

  test("an empty plan for this sheet is OK, not an error", () => {
    const s = buildPlan(csv, "Id", [{ sheet: "Other", id: "1", column: "A", expected: "1" }], "SkillSheet");
    expect(s.workItems).toHaveLength(0);
    expect(s.level).toBe("OK");
  });

  test("the plan format round-trips: the same items work as spec-datasheet-check assertions", () => {
    // PlanItem is a type alias of Assertion on purpose -- this test pins that contract so a
    // future edit to either shape breaks here instead of silently splitting the two files.
    const plan: PlanItem[] = [{ sheet: "SkillSheet", id: "10113000", column: "Cooldown", expected: "3" }];
    const asAssertions: Array<{ sheet?: string; id: string; column: string; expected: string }> = plan;
    expect(asAssertions[0]!.expected).toBe("3");
  });
});

// --- 2026-09-03 회귀: 직접 돌려보다 발견한 결함 2건 -------------------------------------
// 둘 다 "조용히 OK가 나오는" 종류라 테스트가 없으면 다시 들어와도 아무도 모른다.

describe("중복 키가 있는 시트 (첫 행만 보면 안 됨)", () => {
  // 같은 Id가 두 번 나오고 값이 서로 다른 시트. 첫 행만 보던 버전은 "이미 반영됨, 작업
  // 불필요"로 넘겨버렸고, 그러면 옛 값을 가진 두 번째 행이 그대로 업로드된다.
  const dup = parseCsv("Id,Name,Cooldown\n10113000,A,5\n10113000,A dup,9\n");

  test("일부 중복 행만 기대값과 같으면 CHANGE로 잡고 값들을 다 보여준다", () => {
    const w = buildWorkItem(dup, "Id", { id: "10113000", column: "Cooldown", expected: "5" });
    expect(w.status).toBe("CHANGE");
    expect(w.level).toBe("WARN");
    expect(w.detail).toContain('"5", "9"');
    expect(w.detail).toContain("행이 2개");
  });

  test("모든 중복 행이 기대값과 같아도 WARN — 어느 행이 정본인지 모호하다", () => {
    const same = parseCsv("Id,Name,Cooldown\n10113000,A,3\n10113000,A dup,3\n");
    const w = buildWorkItem(same, "Id", { id: "10113000", column: "Cooldown", expected: "3" });
    expect(w.status).toBe("NO_CHANGE");
    expect(w.level).toBe("WARN");
  });

  test("중복이 없으면 WARN을 붙이지 않는다(기존 동작 유지)", () => {
    expect(buildWorkItem(csv, "Id", { id: "10113000", column: "Cooldown", expected: "3" }).level).toBe("OK");
  });
});

describe("계획 파일 자체가 모순인 경우", () => {
  test("같은 id+column에 다른 expected가 있으면 FATAL — 시트를 어떻게 고쳐도 만족 불가", () => {
    const plan: PlanItem[] = [
      { id: "10113000", column: "Cooldown", expected: "3" },
      { id: "10113000", column: "Cooldown", expected: "7" },
    ];
    const s = buildPlan(csv, "Id", plan, null);
    expect(s.conflicts).toHaveLength(1);
    expect(s.conflicts[0]!.expectedValues).toEqual(["3", "7"]);
    expect(s.level).toBe("FATAL");
  });

  test("표기만 다르고 값이 같으면(3 vs 3.0) 모순이 아니다", () => {
    const plan: PlanItem[] = [
      { id: "10113000", column: "Cooldown", expected: "3" },
      { id: "10113000", column: "Cooldown", expected: "3.0" },
    ];
    expect(buildPlan(csv, "Id", plan, null).conflicts).toHaveLength(0);
  });

  test("컬럼명 대소문자만 다른 항목도 같은 대상으로 묶어 모순을 잡는다", () => {
    const plan: PlanItem[] = [
      { id: "10113000", column: "Cooldown", expected: "3" },
      { id: "10113000", column: "cooldown", expected: "7" },
    ];
    expect(buildPlan(csv, "Id", plan, null).conflicts).toHaveLength(1);
  });

  test("다른 시트의 같은 id+column은 모순이 아니다", () => {
    const plan: PlanItem[] = [
      { sheet: "A", id: "1", column: "X", expected: "3" },
      { sheet: "B", id: "1", column: "X", expected: "7" },
    ];
    expect(buildPlan(csv, "Id", plan, null).conflicts).toHaveLength(0);
  });
});
