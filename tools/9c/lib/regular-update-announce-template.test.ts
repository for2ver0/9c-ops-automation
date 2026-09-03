import { describe, expect, test } from "bun:test";
import { buildAnnouncementDraft, checkAnnouncement, overallLevel, todayKst, type CalendarDate } from "./regular-update-announce-template";

// Both real samples predate this test's "today" — pin an early `today` so the
// release-date-not-past check doesn't fire on golden-text reproductions.
const BEFORE_BOTH_SAMPLES: CalendarDate = { year: 2026, month: 1, day: 1 };

describe("buildAnnouncementDraft — golden text", () => {
  test("reproduces sample 1 verbatim (v200470, 2026-08-25)", () => {
    const draft = buildAnnouncementDraft(
      {
        apv: 200470,
        releaseDate: { year: 2026, month: 8, day: 25 },
        summary: "This update includes ncu menu develope and new adventureboss reward",
      },
      BEFORE_BOTH_SAMPLES,
    );
    expect(draft.body).toBe(
      [
        "Hi @everyone 👋",
        "We will be releasing v200470 on August 25, 2026 at 11:00 AM (KST).",
        "This update includes ncu menu develope and new adventureboss reward",
        "You can check the full details here:",
        "🔗 https://docs.nine-chronicles.com/introduction/intro/roadmap-and-completed/release-notes#v200470",
      ].join("\n"),
    );
  });

  test("reproduces sample 2 verbatim (v200460, 2026-07-21)", () => {
    const draft = buildAnnouncementDraft(
      {
        apv: 200460,
        releaseDate: { year: 2026, month: 7, day: 21 },
        summary: "This update includes new event stages and new collections.",
      },
      BEFORE_BOTH_SAMPLES,
    );
    expect(draft.body).toBe(
      [
        "Hi @everyone 👋",
        "We will be releasing v200460 on July 21, 2026 at 11:00 AM (KST).",
        "This update includes new event stages and new collections.",
        "You can check the full details here:",
        "🔗 https://docs.nine-chronicles.com/introduction/intro/roadmap-and-completed/release-notes#v200460",
      ].join("\n"),
    );
  });
});

describe("checkAnnouncement", () => {
  const today: CalendarDate = { year: 2026, month: 9, day: 3 };

  test("FATAL when summary is empty", () => {
    const checks = checkAnnouncement({ apv: 1, releaseDate: { year: 2026, month: 9, day: 10 }, summary: "   " }, today);
    expect(overallLevel(checks)).toBe("FATAL");
    expect(checks.find((c) => c.id === "summary-non-empty")?.ok).toBe(false);
  });

  test("WARN when release date is before today (KST)", () => {
    const checks = checkAnnouncement({ apv: 1, releaseDate: { year: 2026, month: 9, day: 1 }, summary: "x" }, today);
    const c = checks.find((c) => c.id === "release-date-not-past");
    expect(c?.ok).toBe(false);
    expect(c?.level).toBe("WARN");
  });

  test("OK when release date is today or later", () => {
    const checks = checkAnnouncement({ apv: 1, releaseDate: { year: 2026, month: 9, day: 3 }, summary: "x" }, today);
    expect(checks.find((c) => c.id === "release-date-not-past")?.ok).toBe(true);
  });

  test("no time-deviation check when releaseTimeKst is omitted (uses observed default)", () => {
    const checks = checkAnnouncement({ apv: 1, releaseDate: { year: 2026, month: 9, day: 10 }, summary: "x" }, today);
    expect(checks.some((c) => c.id === "release-time-deviates-from-observed")).toBe(false);
  });

  test("WARN (not FATAL) when releaseTimeKst differs from the 2 observed samples", () => {
    const checks = checkAnnouncement(
      { apv: 1, releaseDate: { year: 2026, month: 9, day: 10 }, summary: "x", releaseTimeKst: "3:00 PM" },
      today,
    );
    const c = checks.find((c) => c.id === "release-time-deviates-from-observed");
    expect(c?.level).toBe("WARN");
    expect(c?.ok).toBe(true); // flagged for confirmation, not treated as wrong
  });

  test("all OK for a well-formed future announcement", () => {
    const checks = checkAnnouncement({ apv: 1, releaseDate: { year: 2026, month: 9, day: 10 }, summary: "x" }, today);
    expect(overallLevel(checks)).toBe("OK");
  });
});

describe("todayKst", () => {
  test("returns a plausible calendar date", () => {
    const d = todayKst(new Date("2026-09-03T01:00:00Z"));
    // 2026-09-03T01:00:00Z is 2026-09-03T10:00:00 KST — same calendar day, easy case.
    expect(d).toEqual({ year: 2026, month: 9, day: 3 });
  });

  test("rolls to the next day near UTC midnight (KST is UTC+9)", () => {
    const d = todayKst(new Date("2026-09-02T16:00:00Z"));
    // 2026-09-02T16:00:00Z is 2026-09-03T01:00:00 KST.
    expect(d).toEqual({ year: 2026, month: 9, day: 3 });
  });
});
