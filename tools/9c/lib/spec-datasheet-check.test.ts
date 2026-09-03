import { describe, expect, test } from "bun:test";
import { parseCsv } from "./csv";
import {
  checkAssertion,
  checkAssertions,
  filterAssertionsForSheet,
  findConflictingAssertions,
  overallLevel,
  type Assertion,
} from "./spec-datasheet-check";

const csv = parseCsv("Id,Name,Cooldown\n10113000,Longbow Shot,5\n10114000,Piercing Arrow,3\n");

describe("checkAssertion", () => {
  test("OK when the sheet value matches the spec exactly", () => {
    const a: Assertion = { id: "10113000", column: "Cooldown", expected: "5" };
    const r = checkAssertion(csv, "Id", a);
    expect(r.status).toBe("OK");
    expect(r.level).toBe("OK");
  });

  test("OK when values match numerically despite different formatting (3 vs 3.0)", () => {
    const a: Assertion = { id: "10114000", column: "Cooldown", expected: "3.0" };
    const r = checkAssertion(csv, "Id", a);
    expect(r.status).toBe("OK");
  });

  test("MISMATCH (FATAL) when the sheet value differs from the spec", () => {
    // Spec says cooldown should now be 3, but the sheet still has 5 -- exactly the case this
    // tool exists to catch before internal deploy.
    const a: Assertion = { id: "10113000", column: "Cooldown", expected: "3", note: "쿨타임 5->3" };
    const r = checkAssertion(csv, "Id", a);
    expect(r.status).toBe("MISMATCH");
    expect(r.level).toBe("FATAL");
    expect(r.detail).toContain("5->3");
  });

  test("ROW_NOT_FOUND (FATAL) when the id doesn't exist in the sheet", () => {
    const a: Assertion = { id: "99999999", column: "Cooldown", expected: "3" };
    const r = checkAssertion(csv, "Id", a);
    expect(r.status).toBe("ROW_NOT_FOUND");
    expect(r.level).toBe("FATAL");
  });

  test("COLUMN_NOT_FOUND (FATAL) when the column doesn't exist in the sheet", () => {
    const a: Assertion = { id: "10113000", column: "Damage", expected: "100" };
    const r = checkAssertion(csv, "Id", a);
    expect(r.status).toBe("COLUMN_NOT_FOUND");
    expect(r.level).toBe("FATAL");
  });

  test("COLUMN_NOT_FOUND (FATAL) when the key column itself doesn't exist", () => {
    const a: Assertion = { id: "10113000", column: "Cooldown", expected: "5" };
    const r = checkAssertion(csv, "NoSuchKey", a);
    expect(r.status).toBe("COLUMN_NOT_FOUND");
  });

  test("column and key-column lookups are case-insensitive", () => {
    const a: Assertion = { id: "10113000", column: "cooldown", expected: "5" };
    const r = checkAssertion(csv, "id", a);
    expect(r.status).toBe("OK");
  });
});

describe("filterAssertionsForSheet", () => {
  const assertions: Assertion[] = [
    { sheet: "SkillSheet", id: "1", column: "A", expected: "1" },
    { sheet: "MonsterSheet", id: "2", column: "B", expected: "2" },
    { id: "3", column: "C", expected: "3" }, // no sheet -- always applies
  ];

  test("with sheetName=null, every assertion applies (single-sheet scenario)", () => {
    expect(filterAssertionsForSheet(assertions, null)).toHaveLength(3);
  });

  test("with a sheetName, only matching + sheet-less assertions apply", () => {
    const filtered = filterAssertionsForSheet(assertions, "SkillSheet");
    expect(filtered.map((a) => a.id)).toEqual(["1", "3"]);
  });
});

describe("checkAssertions", () => {
  test("reports skipped count for assertions belonging to other sheets", () => {
    const assertions: Assertion[] = [
      { sheet: "SkillSheet", id: "10113000", column: "Cooldown", expected: "5" },
      { sheet: "MonsterSheet", id: "500001", column: "HP", expected: "1200" },
    ];
    const { results, skipped } = checkAssertions(csv, "Id", assertions, "SkillSheet");
    expect(results).toHaveLength(1);
    expect(skipped).toBe(1);
    expect(results[0]!.status).toBe("OK");
  });

  test("zero applicable assertions is not an error -- empty results, OK by convention of the caller", () => {
    const assertions: Assertion[] = [{ sheet: "OtherSheet", id: "1", column: "A", expected: "1" }];
    const { results, skipped } = checkAssertions(csv, "Id", assertions, "SkillSheet");
    expect(results).toHaveLength(0);
    expect(skipped).toBe(1);
  });
});

describe("overallLevel", () => {
  test("FATAL if any result is FATAL", () => {
    const a: Assertion = { id: "10113000", column: "Cooldown", expected: "999" };
    const r = checkAssertion(csv, "Id", a);
    expect(overallLevel([r])).toBe("FATAL");
  });

  test("OK if all results are OK", () => {
    const a: Assertion = { id: "10113000", column: "Cooldown", expected: "5" };
    const r = checkAssertion(csv, "Id", a);
    expect(overallLevel([r])).toBe("OK");
  });

  test("OK for an empty result list", () => {
    expect(overallLevel([])).toBe("OK");
  });
});

// --- 2026-09-03 회귀: spec-to-datasheet를 만들다 이 스킬에서도 발견한 결함 2건 -----------

describe("중복 키가 있는 시트", () => {
  // 첫 행만 보던 버전은 뒤쪽 중복 행이 옛 값을 갖고 있어도 "일치"로 통과시켰다 —
  // 검증 스킬이 놓치면 그대로 인터널/메인넷까지 간다.
  const dup = parseCsv("Id,Name,Cooldown\n10113000,A,3\n10113000,A dup,9\n");

  // 2026-09-03 정정: 처음엔 "중복 행 중 하나라도 다르면 FATAL"로 만들었는데, lib9c에는 같은
  // id의 여러 행을 한 항목으로 합치는 병합형 시트가 25종 있어(ArenaSheet의 라운드,
  // EventDungeonStageWaveSheet의 웨이브 등) 그 시트들을 통째로 오탐했다. 이제 "아무 행도
  // 기대값을 안 가짐"만 FATAL이고, 일부만 가지면 WARN(모호)이다.
  test("일부 행이 기대값을 가지면 WARN — 병합형 시트에서 정상일 수 있어 FATAL로 안 친다", () => {
    const r = checkAssertion(dup, "Id", { id: "10113000", column: "Cooldown", expected: "3" });
    expect(r.status).toBe("OK");
    expect(r.level).toBe("WARN");
    expect(r.detail).toContain("병합형");
  });

  test("아무 행도 기대값을 갖고 있지 않으면 MISMATCH(FATAL) — 진짜 반영 누락", () => {
    const r = checkAssertion(dup, "Id", { id: "10113000", column: "Cooldown", expected: "77" });
    expect(r.status).toBe("MISMATCH");
    expect(r.level).toBe("FATAL");
    expect(r.detail).toContain('"3", "9"');
    expect(r.detail).toContain("하나도 없음");
  });

  test("중복 행이 전부 기대값과 같으면 WARN — 통과시키되 원본 확인을 요구한다", () => {
    const same = parseCsv("Id,Name,Cooldown\n10113000,A,3\n10113000,A dup,3\n");
    const r = checkAssertion(same, "Id", { id: "10113000", column: "Cooldown", expected: "3" });
    expect(r.status).toBe("OK");
    expect(r.level).toBe("WARN");
  });
});

describe("findConflictingAssertions", () => {
  test("같은 id+column에 다른 expected가 있으면 모순으로 잡는다", () => {
    const conflicts = findConflictingAssertions([
      { id: "1", column: "A", expected: "3" },
      { id: "1", column: "A", expected: "7" },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.expectedValues).toEqual(["3", "7"]);
  });

  test("표기만 다른 같은 값(3 vs 3.0)은 모순이 아니다", () => {
    expect(
      findConflictingAssertions([
        { id: "1", column: "A", expected: "3" },
        { id: "1", column: "A", expected: "3.0" },
      ]),
    ).toHaveLength(0);
  });

  test("모순이 있으면 checkAssertions 결과에 실려 나온다", () => {
    const { conflicts } = checkAssertions(
      csv,
      "Id",
      [
        { id: "10113000", column: "Cooldown", expected: "3" },
        { id: "10113000", column: "Cooldown", expected: "7" },
      ],
      null,
    );
    expect(conflicts).toHaveLength(1);
  });
});

describe("findConflictingAssertions 키 구성 (2026-09-03 NUL 제거 시 동작 보존)", () => {
  // 복합 키를 NUL 구분자에서 JSON 배열로 바꿀 때 `?? ""`를 `?? null`로 잘못 바꾸면
  // "sheet 필드가 없는 항목"과 "sheet가 빈 문자열인 항목"이 서로 다른 그룹이 된다.
  // 기존 동작(같은 그룹)을 유지한다는 계약을 여기서 못박는다.
  test("sheet 없는 항목과 sheet=\"\" 항목은 같은 그룹으로 묶인다", () => {
    const conflicts = findConflictingAssertions([
      { id: "1", column: "A", expected: "3" },
      { sheet: "", id: "1", column: "A", expected: "7" },
    ]);
    expect(conflicts).toHaveLength(1);
  });

  test("구분자 문자가 값에 들어가도 그룹이 섞이지 않는다", () => {
    // "a","b|c" 와 "a|b","c" 처럼 구분자를 이어붙이면 충돌하던 조합.
    const conflicts = findConflictingAssertions([
      { sheet: "a", id: "b|c", column: "X", expected: "1" },
      { sheet: "a|b", id: "c", column: "X", expected: "2" },
    ]);
    expect(conflicts).toHaveLength(0);
  });
});
