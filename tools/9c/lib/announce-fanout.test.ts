import { describe, expect, test } from "bun:test";
import { checkLanguageLengthParity, buildAnnouncementDraft, overallLevel, type LanguageNotice } from "./announce-fanout";
import type { NoticeHead } from "./release-guard";

function head(file: NoticeHead["file"], apv: number | null, contents: string | null): NoticeHead {
  return { file, header: apv !== null ? `v${apv}` : null, apv, contents, date: "25.06.2026" };
}

describe("checkLanguageLengthParity", () => {
  test("OK when lengths are comparable", () => {
    const notices: LanguageNotice[] = [
      { lang: "EN", head: head("TextNotice", 1, "a".repeat(100)) },
      { lang: "KR", head: head("TextNotice_KR", 1, "가".repeat(90)) },
      { lang: "JP", head: head("TextNotice_JP", 1, "あ".repeat(110)) },
    ];
    expect(checkLanguageLengthParity(notices).level).toBe("OK");
  });

  test("WARN when one language is drastically shorter (translation likely missing)", () => {
    const notices: LanguageNotice[] = [
      { lang: "EN", head: head("TextNotice", 1, "a".repeat(200)) },
      { lang: "KR", head: head("TextNotice_KR", 1, "가".repeat(190)) },
      { lang: "JP", head: head("TextNotice_JP", 1, "x") },
    ];
    const c = checkLanguageLengthParity(notices);
    expect(c.level).toBe("WARN");
    expect(c.detail).toContain("JP");
  });

  test("does not crash and returns OK when fewer than 2 non-empty bodies exist", () => {
    const notices: LanguageNotice[] = [
      { lang: "EN", head: head("TextNotice", 1, "a".repeat(50)) },
      { lang: "KR", head: head("TextNotice_KR", 1, null) },
      { lang: "JP", head: head("TextNotice_JP", 1, "") },
    ];
    expect(checkLanguageLengthParity(notices).level).toBe("OK");
  });
});

describe("buildAnnouncementDraft", () => {
  test("includes all three languages' actual content, not invented copy", () => {
    const en = head("TextNotice", 200470, "Patch notes EN");
    const kr = head("TextNotice_KR", 200470, "패치노트 KR");
    const jp = head("TextNotice_JP", 200470, "パッチノート JP");
    const draft = buildAnnouncementDraft(en, kr, jp);
    expect(draft.body).toContain("Patch notes EN");
    expect(draft.body).toContain("패치노트 KR");
    expect(draft.body).toContain("パッチノート JP");
    expect(draft.body).toContain("v200470");
  });

  test("flags empty content instead of silently posting a blank section", () => {
    const en = head("TextNotice", 200470, "Patch notes EN");
    const kr = head("TextNotice_KR", 200470, "");
    const jp = head("TextNotice_JP", 200470, "パッチノート JP");
    const draft = buildAnnouncementDraft(en, kr, jp);
    expect(draft.checks.some((c) => c.id.includes("empty-contents") && !c.ok)).toBe(true);
    expect(draft.body).toContain("(본문 없음 — 채우세요)");
  });

  test("flags version mismatch across languages", () => {
    const en = head("TextNotice", 200470, "EN");
    const kr = head("TextNotice_KR", 200460, "KR");
    const jp = head("TextNotice_JP", 200470, "JP");
    const draft = buildAnnouncementDraft(en, kr, jp);
    expect(draft.checks.some((c) => c.id === "notice-files-agree" && !c.ok)).toBe(true);
  });

  test("always includes the not-a-verified-template disclaimer", () => {
    const draft = buildAnnouncementDraft(head("TextNotice", 1, "x"), head("TextNotice_KR", 1, "y"), head("TextNotice_JP", 1, "z"));
    expect(draft.body).toContain("검증된 고정 템플릿이 아닙니다");
  });
});

describe("overallLevel", () => {
  test("FATAL beats WARN beats OK", () => {
    expect(overallLevel([{ id: "a", name: "a", ok: true, level: "OK", detail: "" }])).toBe("OK");
    expect(overallLevel([{ id: "a", name: "a", ok: false, level: "WARN", detail: "" }])).toBe("WARN");
    expect(
      overallLevel([
        { id: "a", name: "a", ok: false, level: "WARN", detail: "" },
        { id: "b", name: "b", ok: false, level: "FATAL", detail: "" },
      ]),
    ).toBe("FATAL");
  });
});
