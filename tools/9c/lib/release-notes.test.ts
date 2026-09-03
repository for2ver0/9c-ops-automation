import { describe, expect, test } from "bun:test";
import {
  checkApvNotAlreadyPublished,
  checkApvFollowsObservedIncrement,
  checkSectionsPresent,
  checkNoEmptySections,
  checkNoDuplicateCategories,
  runChecks,
  overallLevel,
  buildReleaseNoteDraft,
  type ReleaseNoteInput,
} from "./release-notes";

describe("checkApvNotAlreadyPublished", () => {
  test("OK when the new APV is greater than what's already on gitbook", () => {
    expect(checkApvNotAlreadyPublished(200480, 200470).level).toBe("OK");
  });

  test("FATAL when the new APV is equal to the current head (already published)", () => {
    expect(checkApvNotAlreadyPublished(200470, 200470).level).toBe("FATAL");
  });

  test("FATAL when the new APV is less than the current head (stale value)", () => {
    expect(checkApvNotAlreadyPublished(200450, 200470).level).toBe("FATAL");
  });
});

describe("checkApvFollowsObservedIncrement", () => {
  test("OK when it matches the observed +10 pattern", () => {
    expect(checkApvFollowsObservedIncrement(200480, 200470).level).toBe("OK");
  });

  test("WARN (not FATAL) when it deviates from +10 — a real gap could be intentional", () => {
    const c = checkApvFollowsObservedIncrement(200500, 200470);
    expect(c.level).toBe("WARN");
    expect(c.ok).toBe(false);
  });
});

describe("checkSectionsPresent", () => {
  test("FATAL when there are no sections at all", () => {
    expect(checkSectionsPresent([]).level).toBe("FATAL");
  });

  test("OK when at least one section exists", () => {
    expect(checkSectionsPresent([{ category: "a", items: ["x"] }]).level).toBe("OK");
  });
});

describe("checkNoEmptySections", () => {
  test("WARN when a section has zero items", () => {
    const c = checkNoEmptySections([{ category: "빈 섹션", items: [] }]);
    expect(c.level).toBe("WARN");
    expect(c.detail).toContain("빈 섹션");
  });

  test("OK when every section has at least one item", () => {
    expect(checkNoEmptySections([{ category: "a", items: ["x"] }]).level).toBe("OK");
  });
});

describe("checkNoDuplicateCategories", () => {
  test("WARN when the same category name appears twice", () => {
    const c = checkNoDuplicateCategories([
      { category: "신규 콘텐츠", items: ["a"] },
      { category: "신규 콘텐츠", items: ["b"] },
    ]);
    expect(c.level).toBe("WARN");
  });

  test("OK when categories are all distinct", () => {
    const c = checkNoDuplicateCategories([
      { category: "a", items: ["x"] },
      { category: "b", items: ["y"] },
    ]);
    expect(c.level).toBe("OK");
  });
});

describe("runChecks + overallLevel end-to-end", () => {
  test("a clean, next-in-sequence input passes everything", () => {
    const input: ReleaseNoteInput = {
      apv: 200480,
      sections: [{ category: "신규 콘텐츠", items: ["신규 스테이지 추가"] }],
    };
    expect(overallLevel(runChecks(input, 200470))).toBe("OK");
  });

  test("reusing an already-published APV is FATAL end-to-end", () => {
    const input: ReleaseNoteInput = {
      apv: 200470,
      sections: [{ category: "신규 콘텐츠", items: ["x"] }],
    };
    expect(overallLevel(runChecks(input, 200470))).toBe("FATAL");
  });
});

describe("buildReleaseNoteDraft", () => {
  test("uses the bare version number as heading, matching gitbook's observed <h2 id=\"id-{APV}\">{APV}</h2> pattern", () => {
    const draft = buildReleaseNoteDraft({ apv: 200480, sections: [{ category: "신규 콘텐츠", items: ["a"] }] });
    expect(draft).toContain("## 200480");
    expect(draft).not.toContain("v200480");
  });

  test("echoes section categories and items verbatim — never invents copy", () => {
    const draft = buildReleaseNoteDraft({
      apv: 200480,
      sections: [{ category: "밸런스 조정", items: ["스킬 A 데미지 10% 감소", "아이템 B 드랍률 상향"] }],
    });
    expect(draft).toContain("### 밸런스 조정");
    expect(draft).toContain("- 스킬 A 데미지 10% 감소");
    expect(draft).toContain("- 아이템 B 드랍률 상향");
  });

  test("includes the not-verified-format disclaimer", () => {
    const draft = buildReleaseNoteDraft({ apv: 200480, sections: [{ category: "a", items: ["b"] }] });
    expect(draft).toContain("검증되지 않았습니다");
  });

  test("multiple sections are all rendered, in the given order", () => {
    const draft = buildReleaseNoteDraft({
      apv: 200480,
      sections: [
        { category: "신규 콘텐츠", items: ["a"] },
        { category: "버그 수정", items: ["b"] },
      ],
    });
    const idxA = draft.indexOf("### 신규 콘텐츠");
    const idxB = draft.indexOf("### 버그 수정");
    expect(idxA).toBeGreaterThan(-1);
    expect(idxB).toBeGreaterThan(idxA);
  });
});

// --- 2026-09-03 "조용한 OK" 점검 회귀 --------------------------------------------------
// `items.length === 0`만 보던 탓에 `items: ["", "  "]`인 섹션이 "빈 섹션 없음 — 모든 섹션에
// 항목이 있습니다"로 통과했고, 초안엔 `- ` / `-   ` 빈 불릿이 그대로 찍힌 채 전체 판정이
// OK였다(실측).
describe("checkNoEmptySections — 공백 항목 (2026-09-03)", () => {
  test("항목이 전부 공백이면 빈 섹션으로 본다", () => {
    const c = checkNoEmptySections([{ category: "버그 수정", items: ["", "  "] }]);
    expect(c.level).toBe("WARN");
    expect(c.detail).toContain("전부 공백");
  });

  test("빈 항목이 섞여 있으면 별도로 알린다", () => {
    const c = checkNoEmptySections([{ category: "버그 수정", items: ["실제 항목", "  "] }]);
    expect(c.level).toBe("WARN");
    expect(c.detail).toContain("빈 항목이 섞인");
  });

  test("정상 항목만 있으면 OK", () => {
    expect(checkNoEmptySections([{ category: "버그 수정", items: ["실제 항목"] }]).level).toBe("OK");
  });

  test("items가 빈 배열인 기존 케이스도 그대로 WARN", () => {
    expect(checkNoEmptySections([{ category: "버그 수정", items: [] }]).level).toBe("WARN");
  });
});
