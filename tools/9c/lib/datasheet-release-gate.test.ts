import { describe, expect, test } from "bun:test";
import {
  checkSheetIdentity,
  readIdentity,
  buildGate,
  evaluateSheet,
  normalizeSpecCheckJson,
  normalizeStructuralJson,
  type NormalizedCheck,
  type SheetSection,
} from "./datasheet-release-gate";

const okCheck: NormalizedCheck = { id: "a", name: "A", ok: true, level: "OK", detail: "fine" };
const fatalCheck: NormalizedCheck = { id: "b", name: "B", ok: false, level: "FATAL", detail: "broken" };
const warnCheck: NormalizedCheck = { id: "c", name: "C", ok: false, level: "WARN", detail: "hmm" };

describe("normalizeStructuralJson", () => {
  test("extracts the checks array from datasheet-validate's --json shape", () => {
    const raw = { source: "x.csv", headerCount: 3, rowCount: 10, level: "OK", checks: [okCheck] };
    expect(normalizeStructuralJson(raw)).toEqual([okCheck]);
  });

  test("throws when the checks array is missing (shape drifted)", () => {
    expect(() => normalizeStructuralJson({ level: "OK" })).toThrow();
  });
});

describe("normalizeSpecCheckJson", () => {
  test("maps spec-datasheet-check's results (assertion/status shape) into NormalizedCheck", () => {
    const raw = {
      source: "x.csv",
      results: [
        {
          assertion: { id: "10113000", column: "Cooldown", expected: "3" },
          status: "MISMATCH",
          level: "FATAL",
          detail: "기대값 3 / 실제값 5",
        },
      ],
    };
    const normalized = normalizeSpecCheckJson(raw);
    expect(normalized).toHaveLength(1);
    expect(normalized[0]!.ok).toBe(false);
    expect(normalized[0]!.level).toBe("FATAL");
    expect(normalized[0]!.name).toContain("Cooldown");
    expect(normalized[0]!.name).toContain("10113000");
  });

  test("maps an OK result correctly", () => {
    const raw = {
      results: [{ assertion: { id: "1", column: "A" }, status: "OK", level: "OK", detail: "match" }],
    };
    expect(normalizeSpecCheckJson(raw)[0]!.ok).toBe(true);
  });

  test("throws when the results array is missing (shape drifted)", () => {
    expect(() => normalizeSpecCheckJson({ level: "OK" })).toThrow();
  });
});

/** 시트 대조가 통과하도록 정체를 갖춘 섹션을 만든다. 이 헬퍼를 안 쓰면
 *  checkSheetIdentity가 "대조 못 함" WARN을 내므로, 다른 것을 재는 테스트가 그 WARN에
 *  오염된다(2026-09-03 시트 대조 도입 시 실제로 4건이 그렇게 깨졌다). */
function identified(sheet: string): Pick<SheetSection, "structuralIdentity" | "specCheckIdentity"> {
  return {
    structuralIdentity: { sheetName: sheet, source: `./${sheet}.csv` },
    specCheckIdentity: { sheetName: sheet, source: `./${sheet}.csv` },
  };
}

describe("evaluateSheet", () => {
  test("level is the worst of structural + specCheck checks combined", () => {
    const section: SheetSection = { sheet: "SkillSheet", structural: [okCheck], specCheck: [fatalCheck], ...identified("SkillSheet") };
    const result = evaluateSheet(section);
    expect(result.level).toBe("FATAL");
    expect(result.checks).toHaveLength(3); // 시트 대조 1 + 구조 1 + 대사 1
  });

  test("missingStructural/missingSpecCheck flags are set when a section is null (not run), not just empty", () => {
    const section: SheetSection = { sheet: "SkillSheet", structural: null, specCheck: [], ...identified("SkillSheet") };
    const result = evaluateSheet(section);
    expect(result.missingStructural).toBe(true);
    expect(result.missingSpecCheck).toBe(false); // [] means "ran, nothing applicable" -- not missing
    expect(result.level).toBe("OK");
  });

  test("an empty specCheck (0 applicable assertions) does not count as FATAL/WARN", () => {
    const section: SheetSection = { sheet: "MonsterSheet", structural: [okCheck], specCheck: [], ...identified("MonsterSheet") };
    expect(evaluateSheet(section).level).toBe("OK");
  });

  test("WARN check contributes WARN, not FATAL, when nothing else is FATAL", () => {
    const section: SheetSection = { sheet: "SkillSheet", structural: [okCheck, warnCheck], specCheck: null };
    expect(evaluateSheet(section).level).toBe("WARN");
  });
});

describe("buildGate", () => {
  test("overall level is the worst across all sheets", () => {
    const gate = buildGate([
      { sheet: "SkillSheet", structural: [okCheck], specCheck: [okCheck] },
      { sheet: "MonsterSheet", structural: [okCheck], specCheck: [fatalCheck] },
    ]);
    expect(gate.overallLevel).toBe("FATAL");
    expect(gate.sheets).toHaveLength(2);
  });

  test("all-OK sheets produce an OK overall level", () => {
    const gate = buildGate([{ sheet: "SkillSheet", structural: [okCheck], specCheck: [okCheck], ...identified("SkillSheet") }]);
    expect(gate.overallLevel).toBe("OK");
  });

  test("a sheet with everything missing (both null) is OK, not FATAL -- missing is not the same claim as failing", () => {
    const gate = buildGate([{ sheet: "UntouchedSheet", structural: null, specCheck: null }]);
    expect(gate.overallLevel).toBe("OK");
    expect(gate.sheets[0]!.missingStructural).toBe(true);
    expect(gate.sheets[0]!.missingSpecCheck).toBe(true);
  });
});

// --- 2026-09-03 회귀: "조용한 OK" 점검에서 나온 결함 ④ -----------------------------------

describe("checkSheetIdentity (manifest ↔ JSON 시트 대조)", () => {
  test("JSON이 다른 시트를 봤으면 FATAL — 파일을 잘못 물린 사고", () => {
    // 실제로 저지른 실수: manifest엔 MonsterSheet라 적고 SkillSheet의 검증 결과를 물려줬는데
    // 예전엔 "MonsterSheet — OK"로 보고했다.
    const c = checkSheetIdentity(
      "MonsterSheet",
      { sheetName: "SkillSheet", source: "./SkillSheet.csv" },
      null,
    );
    expect(c.level).toBe("FATAL");
    expect(c.detail).toContain("SkillSheet");
  });

  test("두 검증이 서로 다른 소스를 봤으면 FATAL", () => {
    const c = checkSheetIdentity(
      "SkillSheet",
      { sheetName: null, source: "./SkillSheet.csv" },
      { sheetName: null, source: "./MonsterSheet.csv" },
    );
    expect(c.level).toBe("FATAL");
  });

  test("시트 이름 정보가 아예 없으면 WARN — '확인 안 함'을 OK로 두지 않는다", () => {
    const c = checkSheetIdentity("SkillSheet", { sheetName: null, source: null }, null);
    expect(c.level).toBe("WARN");
  });

  test("일치하면 OK", () => {
    const c = checkSheetIdentity(
      "SkillSheet",
      { sheetName: "SkillSheet", source: "./a.csv" },
      { sheetName: "SkillSheet", source: "./a.csv" },
    );
    expect(c.level).toBe("OK");
  });

  test("둘 다 미실행인 시트엔 대조 검사를 붙이지 않는다(미실행 경고와 중복 방지)", () => {
    const r = evaluateSheet({ sheet: "Untouched", structural: null, specCheck: null });
    expect(r.checks).toHaveLength(0);
    expect(r.level).toBe("OK");
  });
});

describe("readIdentity", () => {
  test("sheetName/source를 읽고, 없으면 null", () => {
    expect(readIdentity({ sheetName: "S", source: "./s.csv" })).toEqual({ sheetName: "S", source: "./s.csv" });
    expect(readIdentity({ level: "OK" })).toEqual({ sheetName: null, source: null });
  });
});
