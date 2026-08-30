/**
 * Golden-text regression against the 3 real announcements the domain owner supplied
 * (2026-08-30) — see references/announcement-samples.md in the skill directory for the
 * verbatim originals.
 */
import { describe, expect, test } from "bun:test";
import {
  buildAnnouncementDraft,
  checkAnnouncementPair,
  checkSequentialSeasonNumber,
  linkLine,
  MEDAL_NOTE_REFERENCE_TEXT,
  type SeasonForAnnouncement,
} from "./arena-announce-template";

function season(
  network: "odin" | "heimdall",
  seasonGroupId: number,
  arenaType: "SEASON" | "CHAMPIONSHIP",
  requiredMedalCount: number,
  startBlock = 0,
): SeasonForAnnouncement {
  return { network, seasonGroupId, arenaType, requiredMedalCount, startBlock };
}

describe("golden text — sample 3 (Odin Season 38 / Heimdall Season 22, no medal note)", () => {
  const odin = season("odin", 38, "SEASON", 0);
  const heimdall = season("heimdall", 22, "SEASON", 0);
  const draft = buildAnnouncementDraft(odin, heimdall);

  test("body matches the real announcement byte-for-byte", () => {
    expect(draft.body).toBe(
      [
        "Dear @everyone",
        "",
        "New Seasons of Arena are just around the corner.",
        "Check out the rewards from the links below.",
        "Don't miss out on the Arena bonus rewards that come with the Season Pass!",
        "",
        "⁠[Odin] Arena Season 38",
        "⁠[Heimdall] Arena Season 22",
      ].join("\n"),
    );
  });

  test("no medal note reference — neither season is a Championship", () => {
    expect(draft.medalNoteReference).toBeNull();
  });

  test("no FATAL/WARN checks", () => {
    expect(draft.checks.every((c) => c.ok)).toBe(true);
  });
});

describe("golden text — sample 1 (Odin Season 39 / Heimdall Championship 9, medal note case)", () => {
  const odin = season("odin", 39, "SEASON", 0);
  const heimdall = season("heimdall", 9, "CHAMPIONSHIP", 0); // real requiredMedalCount, confirmed live

  test("link lines match the real announcement", () => {
    expect(linkLine(odin)).toBe("⁠[Odin] Arena Season 39");
    expect(linkLine(heimdall)).toBe("⁠[Heimdall] Arena Championship 9");
  });

  test("flags the medal-note condition (Championship with requiredMedalCount==0) but does NOT auto-insert the paragraph", () => {
    const draft = buildAnnouncementDraft(odin, heimdall);
    expect(draft.medalNoteReference).toBe(MEDAL_NOTE_REFERENCE_TEXT);
    expect(draft.body).not.toContain("Ragnarok Breaker");
    expect(draft.body).not.toContain("medals required");
  });

  test("checkAnnouncementPair reports it as WARN, not FATAL — the DRAFT is still usable, a human decides", () => {
    const checks = checkAnnouncementPair(odin, heimdall);
    const medalCheck = checks.find((c) => c.id === "championship-medal-note-heimdall")!;
    expect(medalCheck.level).toBe("WARN");
    expect(medalCheck.ok).toBe(false);
  });
});

describe("golden text — sample 2 (Odin Championship 17 / Heimdall Season 23)", () => {
  test("link lines match the real announcement", () => {
    const odin = season("odin", 17, "CHAMPIONSHIP", 0);
    const heimdall = season("heimdall", 23, "SEASON", 0);
    expect(linkLine(odin)).toBe("⁠[Odin] Arena Championship 17");
    expect(linkLine(heimdall)).toBe("⁠[Heimdall] Arena Season 23");
  });
});

describe("a Championship with a real (nonzero) medal requirement needs no note and no WARN — it's the routine case", () => {
  test("e.g. odin g16=60 (pre-Ragnarok-Breaker baseline, domain owner's DB check)", () => {
    const odin = season("odin", 16, "CHAMPIONSHIP", 60);
    const heimdall = season("heimdall", 8, "CHAMPIONSHIP", 50);
    const draft = buildAnnouncementDraft(odin, heimdall);
    expect(draft.medalNoteReference).toBeNull();
    // Every check OK — flagging every ordinary Championship as WARN would just be noise
    // (reverted from an earlier version that did exactly that; see the module's comment).
    expect(draft.checks.every((c) => c.ok)).toBe(true);
  });
});

describe("seasonGroupId == 0 is caught as FATAL (real bug found 2026-08-30: heimdall sid=42)", () => {
  test("a SEASON/CHAMPIONSHIP with seasonGroupId 0 must never silently produce 'Season 0'", () => {
    const odin = season("odin", 24, "SEASON", 0);
    const heimdall = season("heimdall", 0, "SEASON", 0); // the real bug's shape
    const checks = checkAnnouncementPair(odin, heimdall);
    const bad = checks.find((c) => c.id === "season-group-id-nonzero-heimdall")!;
    expect(bad.level).toBe("FATAL");
    expect(bad.ok).toBe(false);

    // buildAnnouncementDraft still produces text (so a caller can see what's wrong) but
    // the CLI layer is responsible for treating any FATAL check as a hard stop before
    // showing this as a "ready to post" draft.
    const draft = buildAnnouncementDraft(odin, heimdall);
    expect(draft.body).toContain("Season 0");
    expect(draft.checks.some((c) => c.level === "FATAL")).toBe(true);
  });
});

describe("checkSequentialSeasonNumber", () => {
  test("previous+1 -> OK (the real Odin S39 case: previous SEASON was g38-ish territory)", () => {
    const s = season("odin", 24, "SEASON", 0);
    const result = checkSequentialSeasonNumber(s, 23);
    expect(result.ok).toBe(true);
    expect(result.level).toBe("OK");
  });

  test("a skipped number -> WARN (broader than the ==0 check: catches 25 after 23, not just 0)", () => {
    const s = season("heimdall", 25, "SEASON", 0);
    const result = checkSequentialSeasonNumber(s, 23);
    expect(result.ok).toBe(false);
    expect(result.level).toBe("WARN");
    expect(result.detail).toContain("24");
  });

  test("no previous same-type season known -> OK, doesn't block (e.g. this type's first season)", () => {
    const s = season("odin", 1, "CHAMPIONSHIP", 0);
    const result = checkSequentialSeasonNumber(s, null);
    expect(result.ok).toBe(true);
    expect(result.level).toBe("OK");
  });

  test("the real heimdall sid=42 bug (seasonGroupId=0) is ALSO caught here as a sequential-number WARN, independent of the ==0 check", () => {
    const s = season("heimdall", 0, "SEASON", 0);
    const result = checkSequentialSeasonNumber(s, 23); // previous SEASON was g23
    expect(result.ok).toBe(false);
    expect(result.level).toBe("WARN");
  });
});
