import { describe, expect, test } from "bun:test";
import {
  parseGitbookHead,
  parseManifestApv,
  parseNoticeHeaderApv,
  extractNoticeHead,
  checkNoticeHeaderFormat,
  checkNoticeEmptyContents,
  checkNoticeFilesAgree,
  checkGitbookVsNotice,
  checkGitbookVsManifest,
  checkThorInfo,
  findStaleSince,
  checkGitbookStaleness,
  overallLevel,
  type LogEntry,
  type NoticeHead,
} from "./release-guard";

describe("parseGitbookHead", () => {
  test("picks the first (= latest, doc-order) version heading", () => {
    const html = `<div><h2 id="id-200470" class="x">200470</h2><p>...</p><h2 id="id-200460">200460</h2></div>`;
    expect(parseGitbookHead(html)).toBe(200470);
  });

  test("returns null when no heading matches (page structure changed)", () => {
    expect(parseGitbookHead("<div>no headings here</div>")).toBeNull();
  });
});

describe("parseManifestApv", () => {
  test("extracts the leading APV digits before the first slash", () => {
    const yaml = `global:\n  appProtocolVersion: "200470/AB2da648.../sig.../b64..."\n  planet: Odin\n`;
    const result = parseManifestApv("odin", yaml);
    expect(result.apv).toBe(200470);
    expect(result.raw).toBe("200470");
  });

  test("returns apv:null (not an error) when the key is absent, e.g. general.yaml", () => {
    const yaml = `clusterName: 9c-main\nprovider: RKE2\n`;
    const result = parseManifestApv("odin", yaml);
    expect(result.apv).toBeNull();
    expect(result.raw).toBeNull();
  });
});

describe("parseNoticeHeaderApv", () => {
  test("accepts lowercase v + digits", () => {
    expect(parseNoticeHeaderApv("v200450")).toBe(200450);
  });

  test("rejects malformed headers (missing v, wrong case, trailing text)", () => {
    expect(parseNoticeHeaderApv("200450")).toBeNull();
    expect(parseNoticeHeaderApv("V200450")).toBeNull();
    expect(parseNoticeHeaderApv("v200450 ")).toBeNull();
    expect(parseNoticeHeaderApv("version 200450")).toBeNull();
  });
});

describe("extractNoticeHead", () => {
  test("reads the top entry", () => {
    const raw = { NoticeData: [{ Header: "v200450", Date: "25.06.2026", Contents: "hello" }] };
    const head = extractNoticeHead("TextNotice", raw);
    expect(head.header).toBe("v200450");
    expect(head.apv).toBe(200450);
    expect(head.contents).toBe("hello");
  });

  test("handles an empty NoticeData array without throwing", () => {
    const head = extractNoticeHead("TextNotice", { NoticeData: [] });
    expect(head.header).toBeNull();
    expect(head.apv).toBeNull();
  });
});

describe("checkNoticeHeaderFormat", () => {
  test("OK for well-formed header", () => {
    const head: NoticeHead = { file: "TextNotice", header: "v200470", apv: 200470, contents: "x", date: "d" };
    expect(checkNoticeHeaderFormat("TextNotice", head).level).toBe("OK");
  });

  test("FATAL when header doesn't match v{APV} (KeepLatestNotices sort risk)", () => {
    const head: NoticeHead = { file: "TextNotice", header: "200470", apv: null, contents: "x", date: "d" };
    const check = checkNoticeHeaderFormat("TextNotice", head);
    expect(check.level).toBe("FATAL");
    expect(check.ok).toBe(false);
  });

  test("FATAL when there is no notice entry at all", () => {
    const head: NoticeHead = { file: "TextNotice", header: null, apv: null, contents: null, date: null };
    expect(checkNoticeHeaderFormat("TextNotice", head).level).toBe("FATAL");
  });
});

describe("checkNoticeEmptyContents", () => {
  test("FATAL on empty/whitespace-only contents", () => {
    const head: NoticeHead = { file: "TextNotice_JP", header: "v200470", apv: 200470, contents: "   ", date: "d" };
    expect(checkNoticeEmptyContents("TextNotice_JP", head).level).toBe("FATAL");
  });

  test("OK when contents present", () => {
    const head: NoticeHead = { file: "TextNotice", header: "v200470", apv: 200470, contents: "## New Content", date: "d" };
    expect(checkNoticeEmptyContents("TextNotice", head).level).toBe("OK");
  });
});

describe("checkNoticeFilesAgree", () => {
  test("OK when all three languages match", () => {
    expect(checkNoticeFilesAgree({ en: 200450, kr: 200450, jp: 200450 }).level).toBe("OK");
  });

  test("WARN when languages diverge", () => {
    const c = checkNoticeFilesAgree({ en: 200450, kr: 200440, jp: 200450 });
    expect(c.level).toBe("WARN");
    expect(c.ok).toBe(false);
  });
});

describe("checkGitbookVsNotice", () => {
  test("OK when in sync", () => {
    expect(checkGitbookVsNotice(200470, 200470, "TextNotice").level).toBe("OK");
  });

  test("WARN when one release behind", () => {
    expect(checkGitbookVsNotice(200470, 200460, "TextNotice").level).toBe("WARN");
  });

  test("FATAL when two or more releases behind — the actual 07-21/08-25 miss pattern", () => {
    const c = checkGitbookVsNotice(200470, 200450, "TextNotice");
    expect(c.level).toBe("FATAL");
    expect(c.detail).toContain("2차수");
  });

  test("FATAL when notice is somehow ahead of gitbook (impossible ordering)", () => {
    expect(checkGitbookVsNotice(200460, 200470, "TextNotice").level).toBe("FATAL");
  });

  test("FATAL when notice header failed to parse", () => {
    expect(checkGitbookVsNotice(200470, null, "TextNotice").level).toBe("FATAL");
  });
});

describe("checkGitbookVsManifest", () => {
  test("OK when manifest matches gitbook", () => {
    const c = checkGitbookVsManifest(200470, { network: "odin", apv: 200470, raw: "200470" });
    expect(c.level).toBe("OK");
  });

  test("WARN when manifest is ahead (normal post-deploy delay)", () => {
    const c = checkGitbookVsManifest(200460, { network: "odin", apv: 200470, raw: "200470" });
    expect(c.level).toBe("WARN");
  });

  test("FATAL when manifest is behind gitbook — APV missing pattern (2026-06-25 v200450)", () => {
    const c = checkGitbookVsManifest(200470, { network: "odin", apv: 200440, raw: "200440" });
    expect(c.level).toBe("FATAL");
    expect(c.detail).toContain("APV 누락");
  });

  test("FATAL when the manifest has no appProtocolVersion at all", () => {
    const c = checkGitbookVsManifest(200470, { network: "odin", apv: null, raw: null });
    expect(c.level).toBe("FATAL");
  });
});

describe("checkThorInfo", () => {
  test("never escalates past WARN even when stale", () => {
    expect(checkThorInfo(200400).level).not.toBe("FATAL");
    expect(checkThorInfo(null).level).toBe("WARN");
  });
});

describe("findStaleSince / checkGitbookStaleness", () => {
  const entry = (observedAt: string, gitbookApv: number, odin: number): LogEntry => ({
    observedAt,
    gitbookApv,
    manifestApv: { odin, heimdall: odin, thor: 200400 },
    noticeApv: { en: gitbookApv, kr: gitbookApv, jp: gitbookApv },
  });

  test("no mismatch -> staleSince null, check OK", () => {
    const current = entry("2026-08-26T00:00:00Z", 200470, 200470);
    expect(findStaleSince([], current)).toBeNull();
    expect(checkGitbookStaleness(current, null, new Date("2026-08-26T00:00:00Z")).level).toBe("OK");
  });

  test("first observation of a mismatch -> WARN, not FATAL, even with no log history", () => {
    const current = entry("2026-08-25T03:00:00Z", 200460, 200470);
    const staleSince = findStaleSince([], current);
    expect(staleSince).toBeNull();
    const check = checkGitbookStaleness(current, staleSince, new Date("2026-08-25T03:00:00Z"));
    expect(check.level).toBe("WARN");
  });

  test("mismatch persisting under 24h -> WARN", () => {
    const log = [entry("2026-08-25T03:00:00Z", 200460, 200470)];
    const current = entry("2026-08-25T20:00:00Z", 200460, 200470);
    const staleSince = findStaleSince(log, current);
    expect(staleSince).toBe("2026-08-25T03:00:00Z");
    const check = checkGitbookStaleness(current, staleSince, new Date("2026-08-25T20:00:00Z"));
    expect(check.level).toBe("WARN");
  });

  test("mismatch persisting 24h+ -> FATAL", () => {
    const log = [entry("2026-08-25T03:00:00Z", 200460, 200470), entry("2026-08-25T20:00:00Z", 200460, 200470)];
    const current = entry("2026-08-26T04:00:00Z", 200460, 200470);
    const staleSince = findStaleSince(log, current);
    expect(staleSince).toBe("2026-08-25T03:00:00Z");
    const check = checkGitbookStaleness(current, staleSince, new Date("2026-08-26T04:00:00Z"));
    expect(check.level).toBe("FATAL");
  });

  test("gitbook catching up resets the streak (a later, unrelated mismatch doesn't inherit the old timestamp)", () => {
    const log = [
      entry("2026-08-25T03:00:00Z", 200460, 200470),
      entry("2026-08-26T05:00:00Z", 200470, 200470), // gitbook caught up
    ];
    const current = entry("2026-08-30T00:00:00Z", 200470, 200480); // brand-new mismatch
    const staleSince = findStaleSince(log, current);
    expect(staleSince).toBeNull();
  });
});

describe("overallLevel", () => {
  test("empty -> OK", () => {
    expect(overallLevel([])).toBe("OK");
  });

  test("any FATAL dominates", () => {
    expect(
      overallLevel([
        { id: "a", name: "a", ok: true, level: "OK", detail: "" },
        { id: "b", name: "b", ok: false, level: "WARN", detail: "" },
        { id: "c", name: "c", ok: false, level: "FATAL", detail: "" },
      ]),
    ).toBe("FATAL");
  });

  test("WARN without FATAL -> WARN", () => {
    expect(
      overallLevel([
        { id: "a", name: "a", ok: true, level: "OK", detail: "" },
        { id: "b", name: "b", ok: false, level: "WARN", detail: "" },
      ]),
    ).toBe("WARN");
  });
});
