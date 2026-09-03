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

// 2026-09-04: 이 도구는 5ba2f61이 "실행 도구가 있는 스킬 14개 전부 점검 완료"를 선언한 뒤
// 5cafb47로 추가돼, 그 "조용한 OK" 점검을 받지 않은 유일한 도구였다. 뒤늦게 찔러보니 같은
// 유형이 나왔다 — 담당자가 친 날짜와 **다른 날짜**가 @everyone 공지 초안에 조용히 실렸다.
describe("checkAnnouncement — 달력에 없는 날짜/비정상 APV를 막는다", () => {
  const base = { apv: 200480, summary: "x" };
  const today: CalendarDate = { year: 2026, month: 1, day: 1 };
  const level = (d: CalendarDate, apv = base.apv) =>
    overallLevel(checkAnnouncement({ ...base, apv, releaseDate: d }, today));

  test("Date.UTC가 조용히 굴려버리던 날짜들을 FATAL로 잡는다", () => {
    expect(level({ year: 2026, month: 2, day: 30 })).toBe("FATAL"); // → March 2, 2026 이었다
    expect(level({ year: 2026, month: 9, day: 31 })).toBe("FATAL"); // → October 1, 2026 이었다
    expect(level({ year: 2026, month: 13, day: 1 })).toBe("FATAL"); // → January 1, 2027 (해까지 바뀜)
    expect(level({ year: 2026, month: 0, day: 1 })).toBe("FATAL");
    expect(level({ year: 2026, month: 9, day: 0 })).toBe("FATAL");
  });

  test("윤년은 실제 달력대로 판정한다", () => {
    expect(level({ year: 2028, month: 2, day: 29 })).not.toBe("FATAL"); // 윤년 — 유효
    expect(level({ year: 2027, month: 2, day: 29 })).toBe("FATAL"); // 평년 — 없는 날짜
  });

  test("APV가 양의 정수가 아니면 FATAL", () => {
    const ok: CalendarDate = { year: 2026, month: 9, day: 22 };
    expect(level(ok, -5)).toBe("FATAL"); // 공지에 "v-5"로 찍히던 값
    expect(level(ok, 0)).toBe("FATAL");
    expect(level(ok, 1.5)).toBe("FATAL");
    expect(level(ok, 200480)).not.toBe("FATAL");
  });
});
