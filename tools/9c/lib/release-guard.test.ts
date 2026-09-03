import { describe, expect, test } from "bun:test";
import {
  isLogEntry,
  isEventJsonSnapshotLike,
  parseGitbookHead,
  parseManifestApv,
  parseNoticeHeaderApv,
  extractNoticeHead,
  checkNoticeHeaderFormat,
  checkNoticeEmptyContents,
  checkNoticeFilesAgree,
  checkNoticeGitMatchesCdn,
  checkGitbookVsNotice,
  checkGitbookVsManifest,
  checkThorInfo,
  findStaleSince,
  checkGitbookStaleness,
  checkEventJsonSnapshot,
  overallLevel,
  type LogEntry,
  type NoticeHead,
  type EventJsonSnapshot,
  type EventJsonLogEntry,
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

describe("checkNoticeGitMatchesCdn", () => {
  const head = (header: string, contents: string): NoticeHead => ({
    file: "TextNotice",
    header,
    apv: header === null ? null : Number(header.slice(1)),
    contents,
    date: "d",
  });

  test("OK when CDN and git are byte-identical", () => {
    const cdn = head("v200450", "hello");
    const git = head("v200450", "hello");
    expect(checkNoticeGitMatchesCdn("TextNotice", cdn, git).level).toBe("OK");
  });

  test("WARN when git is ahead of CDN (normal propagation delay after merge)", () => {
    const cdn = head("v200450", "old");
    const git = head("v200460", "new");
    const c = checkNoticeGitMatchesCdn("TextNotice", cdn, git);
    expect(c.level).toBe("WARN");
    expect(c.detail).toContain("전파 지연");
  });

  test("FATAL when CDN is ahead of git — bypassed the PR process", () => {
    const cdn = head("v200460", "new");
    const git = head("v200450", "old");
    const c = checkNoticeGitMatchesCdn("TextNotice", cdn, git);
    expect(c.level).toBe("FATAL");
    expect(c.detail).toContain("PR 절차");
  });

  test("WARN when headers match but contents differ (cache artifact)", () => {
    const cdn = head("v200450", "content A");
    const git = head("v200450", "content B");
    const c = checkNoticeGitMatchesCdn("TextNotice", cdn, git);
    expect(c.level).toBe("WARN");
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

function eventSnapshot(versionId: string | null, body = "{}"): EventJsonSnapshot {
  return { observedAt: "2026-09-01T00:00:00Z", versionId, etag: null, lastModified: null, body };
}

function eventLogEntry(observedAt: string, versionId: string | null): EventJsonLogEntry {
  return { observedAt, versionId, etag: null, bodyLength: 2 };
}

describe("checkEventJsonSnapshot", () => {
  test("OK and says 'first snapshot' when the log is empty (not a warning — nothing to compare yet)", () => {
    const c = checkEventJsonSnapshot(eventSnapshot("v1"), []);
    expect(c.level).toBe("OK");
    expect(c.detail).toContain("첫 스냅샷");
  });

  test("OK and says 'unchanged' when versionId matches the most recent logged entry", () => {
    const c = checkEventJsonSnapshot(eventSnapshot("v1"), [eventLogEntry("2026-08-01T00:00:00Z", "v1")]);
    expect(c.level).toBe("OK");
    expect(c.detail).toContain("변경 없음");
  });

  test("OK (not FATAL/WARN) and says 'changed' when versionId differs — a change is normal, not an error", () => {
    const c = checkEventJsonSnapshot(eventSnapshot("v2"), [eventLogEntry("2026-08-01T00:00:00Z", "v1")]);
    expect(c.level).toBe("OK");
    expect(c.detail).toContain("변경 감지됨");
    expect(c.detail).toContain("v1");
    expect(c.detail).toContain("v2");
  });

  test("compares against the most recent entry even when the log is out of order", () => {
    const log = [eventLogEntry("2026-08-25T00:00:00Z", "v3"), eventLogEntry("2026-08-01T00:00:00Z", "v1")];
    const c = checkEventJsonSnapshot(eventSnapshot("v3"), log);
    expect(c.detail).toContain("변경 없음");
  });

  test("never crashes when versionId is null (e.g. bucket versioning off, or header missing)", () => {
    const c = checkEventJsonSnapshot(eventSnapshot(null), [eventLogEntry("2026-08-01T00:00:00Z", null)]);
    expect(c.level).toBe("OK");
  });
});

// --- 2026-09-03 "조용한 OK" 점검 회귀 --------------------------------------------------
// 두 로그(--log-file, --event-log-file) 모두 `JSON.parse(l) as T` 캐스팅만 하던 탓에 모양이
// 다른 줄이 그대로 통과했고, `null` 줄은 `e.gitbookApv`/`s.observedAt` 접근에서 내부 오류를
// 사용자에게 노출했다.

describe("isLogEntry", () => {
  const ok = {
    observedAt: "2026-09-01T00:00:00Z",
    gitbookApv: 200470,
    manifestApv: { odin: 200480, heimdall: 200480, thor: null },
    noticeApv: { en: 200450, kr: 200450, jp: 200450 },
  };

  test("정상 기록은 통과", () => {
    expect(isLogEntry(ok)).toBe(true);
  });

  test("gitbookApv가 null이어도 통과 — 깃북을 못 읽은 관측도 유효한 기록이다", () => {
    expect(isLogEntry({ ...ok, gitbookApv: null })).toBe(true);
  });

  test("null·문자열·모양 다른 객체는 거부", () => {
    expect(isLogEntry(null)).toBe(false);
    expect(isLogEntry("x")).toBe(false);
    expect(isLogEntry({ unrelated: true })).toBe(false);
  });

  test("manifestApv에 필드가 더 늘어난 기록도 통과 — '객체인가'까지만 본다", () => {
    expect(isLogEntry({ ...ok, manifestApv: { ...ok.manifestApv, futureNetwork: 1 } })).toBe(true);
  });
});

describe("isEventJsonSnapshotLike", () => {
  const ok = { observedAt: "2026-09-01T00:00:00Z", versionId: "v1", etag: "e1", lastModified: null, body: "{}" };

  test("정상 스냅샷은 통과", () => {
    expect(isEventJsonSnapshotLike(ok)).toBe(true);
  });

  test("body가 없으면 거부 — 호출부(toEventLogEntry)가 s.body.length를 읽는다", () => {
    // 처음 만든 검증기는 body를 일부러 안 봤는데, 그러면 body 없는 줄이 통과한 뒤
    // `undefined is not an object (evaluating 's.body.length')`로 터졌다(실측).
    // 검증기는 호출부가 실제로 읽는 필드를 다 봐야 한다.
    const { body, ...withoutBody } = ok;
    expect(isEventJsonSnapshotLike(withoutBody)).toBe(false);
  });

  test("versionId·etag는 null이어도 통과 — S3 versioning이 꺼져 있으면 null이 온다", () => {
    expect(isEventJsonSnapshotLike({ ...ok, versionId: null, etag: null })).toBe(true);
  });

  test("null·문자열·모양 다른 객체는 거부", () => {
    expect(isEventJsonSnapshotLike(null)).toBe(false);
    expect(isEventJsonSnapshotLike("x")).toBe(false);
    expect(isEventJsonSnapshotLike({ unrelated: true })).toBe(false);
  });
});
