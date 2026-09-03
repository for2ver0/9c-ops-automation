#!/usr/bin/env bun
/**
 * release-guard — CURRENTLY A PARTIAL BUILD. See SKILL.md for the full story; short version:
 *
 * The design doc splits release-guard into two independent halves:
 *   1. 일관성·헤드 대조 — 깃북(기준) vs 메인넷 매니페스트 APV vs 인게임 공지판 헤더.
 *      전부 공개 읽기라 권한 대기 없이 착수 가능(설계 문서 §4 "release-guard" 행 + §5 주석).
 *   2. Event.json 스냅샷 — **2026-09-01 담당자 제보로 절반 풀림.** `Event.json`은
 *      S3(9c-assets)와 같은 오브젝트가 인증 없는 공개 CDN
 *      (assets.nine-chronicles.com/live-assets/Json/Event.json)으로도 서빙된다 — "현재 값"을
 *      읽는 데는 S3 자격증명이 전혀 필요 없다(부록 D의 원래 전제가 틀렸음). 응답에 실려 오는
 *      `x-amz-version-id`/`ETag`까지 같이 기록해두면, 나중에 S3 쪽 과거 버전과 대조할 근거가
 *      남는다. 다만 **과거 버전을 "소급 조회"하는 건 여전히 S3 자격증명(s3:GetObjectVersion)이
 *      필요**하다 — 그건 아직 미착수(권한 요청 문서 ⑧, 범위가 좁아짐).
 *
 * 매 실행은 stateless이므로, "깃북 자체가 며칠째 안 올라왔는지" 같은 지속시간 판단은
 * `--log-file`로 넘긴 로컬 append-only 로그에서 되짚는다(서버 상태 없음 — 설계 문서 부록
 * B-4(c)와 같은 이유). Event.json 스냅샷도 같은 이유로 `--event-log-file`을 쓴다.
 *
 * Usage:
 *   bun run tools/9c/release-guard.ts [--log-file ./release-guard-log.jsonl] [--event-log-file ./event-json-log.jsonl] [--json]
 */
import {
  fetchGitbookHead,
  fetchManifestApv,
  fetchNoticeHead,
  fetchNoticeHeadFromGit,
  fetchClientBuildInfo,
  fetchEventJsonSnapshot,
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
  isLogEntry,
  isEventJsonSnapshotLike,
  type Check,
  type LogEntry,
  type NoticeFile,
  type EventJsonSnapshot,
  type EventJsonLogEntry,
} from "./lib/release-guard";
import { parseJsonlLog, describeSkippedLines } from "./lib/jsonl-log";

interface Args {
  logFile?: string;
  eventLogFile?: string;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--log-file":
        args.logFile = next();
        break;
      case "--event-log-file":
        args.eventLogFile = next();
        break;
      case "--json":
        args.json = true;
        break;
      default:
        throw new Error(`알 수 없는 옵션: ${a}`);
    }
  }
  return args;
}

async function readLog(path: string | undefined): Promise<{ entries: LogEntry[]; warning: string | null }> {
  if (!path) return { entries: [], warning: null };
  const exists = await Bun.file(path).exists();
  if (!exists) return { entries: [], warning: null };
  const text = await Bun.file(path).text();
  // 모양 검증 없이 캐스팅하면 쓰레기 줄이 "어긋난 기록"으로 섞여 staleSince 기간이 틀리게
  // 나온다(실측 근거는 lib/jsonl-log.ts 모듈 주석).
  const { entries, skippedLines } = parseJsonlLog(text, isLogEntry);
  return { entries, warning: describeSkippedLines(path, skippedLines) };
}

async function appendLog(path: string | undefined, entry: LogEntry): Promise<void> {
  if (!path) return;
  const existing = (await Bun.file(path).exists()) ? await Bun.file(path).text() : "";
  const sep = existing && !existing.endsWith("\n") ? "\n" : "";
  await Bun.write(path, existing + sep + JSON.stringify(entry) + "\n");
}

/** Event.json 스냅샷 로그는 원문(`body`)까지 통째로 남긴다 — 4KB대로 작아서(2026-09-01
 *  라이브 확인 기준) 회차마다 쌓아도 부담이 적고, 원문이 있어야 나중에 실제로 뭐가
 *  바뀌었는지 diff를 뜰 수 있다. */
async function readEventLog(
  path: string | undefined,
): Promise<{ entries: EventJsonSnapshot[]; warning: string | null }> {
  if (!path) return { entries: [], warning: null };
  const exists = await Bun.file(path).exists();
  if (!exists) return { entries: [], warning: null };
  const text = await Bun.file(path).text();
  // --log-file과 같은 이유로 모양을 검증한다 — 감사 기록이라 쓰레기가 섞이면 변경 이력이
  // 틀리게 읽힌다(lib/jsonl-log.ts 참고).
  const { entries, skippedLines } = parseJsonlLog(text, isEventJsonSnapshotLike);
  return { entries, warning: describeSkippedLines(path, skippedLines) };
}

async function appendEventLog(path: string | undefined, entry: EventJsonSnapshot): Promise<void> {
  if (!path) return;
  const existing = (await Bun.file(path).exists()) ? await Bun.file(path).text() : "";
  const sep = existing && !existing.endsWith("\n") ? "\n" : "";
  await Bun.write(path, existing + sep + JSON.stringify(entry) + "\n");
}

function toEventLogEntry(s: EventJsonSnapshot): EventJsonLogEntry {
  return { observedAt: s.observedAt, versionId: s.versionId, etag: s.etag, bodyLength: s.body.length };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const [gitbookApv, odin, heimdall, thor, noticeEn, noticeKr, noticeJp, noticeEnGit, noticeKrGit, noticeJpGit, clientBuild, eventSnapshot] =
    await Promise.all([
      fetchGitbookHead(),
      fetchManifestApv("odin"),
      fetchManifestApv("heimdall"),
      fetchManifestApv("thor"),
      fetchNoticeHead("TextNotice"),
      fetchNoticeHead("TextNotice_KR"),
      fetchNoticeHead("TextNotice_JP"),
      fetchNoticeHeadFromGit("TextNotice"),
      fetchNoticeHeadFromGit("TextNotice_KR"),
      fetchNoticeHeadFromGit("TextNotice_JP"),
      fetchClientBuildInfo().catch(() => null), // 정보성일 뿐이라 실패해도 전체를 막지 않는다
      fetchEventJsonSnapshot().catch(() => null), // 실패해도 나머지 대조를 막지 않는다
    ]);

  const noticeFiles: Array<{ file: NoticeFile; head: typeof noticeEn; git: typeof noticeEnGit }> = [
    { file: "TextNotice", head: noticeEn, git: noticeEnGit },
    { file: "TextNotice_KR", head: noticeKr, git: noticeKrGit },
    { file: "TextNotice_JP", head: noticeJp, git: noticeJpGit },
  ];

  const checks: Check[] = [];
  for (const { file, head, git } of noticeFiles) {
    checks.push(checkNoticeHeaderFormat(file, head));
    checks.push(checkNoticeEmptyContents(file, head));
    checks.push(checkGitbookVsNotice(gitbookApv, head.apv, file));
    checks.push(checkNoticeGitMatchesCdn(file, head, git));
  }
  checks.push(checkNoticeFilesAgree({ en: noticeEn.apv, kr: noticeKr.apv, jp: noticeJp.apv }));
  checks.push(checkGitbookVsManifest(gitbookApv, odin));
  checks.push(checkGitbookVsManifest(gitbookApv, heimdall));
  checks.push(checkThorInfo(thor.apv));

  const current: LogEntry = {
    observedAt: new Date().toISOString(),
    gitbookApv,
    manifestApv: { odin: odin.apv, heimdall: heimdall.apv, thor: thor.apv },
    noticeApv: { en: noticeEn.apv, kr: noticeKr.apv, jp: noticeJp.apv },
  };
  const { entries: priorLog, warning: logWarning } = await readLog(args.logFile);
  const staleSince = findStaleSince(priorLog, current);
  checks.push(checkGitbookStaleness(current, staleSince, new Date()));
  // 건너뛴 줄은 반드시 사람이 보게 체크 항목으로 올린다 — 조용히 무시하면 staleSince가
  // "언제부터"를 잘못 짚어도 그 이유를 알 수 없다.
  if (logWarning) {
    checks.push({
      id: "log-file-unreadable-lines",
      name: "관측 로그 형식",
      ok: false,
      level: "WARN",
      detail: logWarning,
    });
  }
  await appendLog(args.logFile, current);

  if (eventSnapshot) {
    const { entries: priorEventEntries, warning: eventLogWarning } = await readEventLog(args.eventLogFile);
    checks.push(checkEventJsonSnapshot(eventSnapshot, priorEventEntries.map(toEventLogEntry)));
    if (eventLogWarning) {
      checks.push({
        id: "event-log-unreadable-lines",
        name: "Event.json 스냅샷 로그 형식",
        ok: false,
        level: "WARN",
        detail: eventLogWarning,
      });
    }
    await appendEventLog(args.eventLogFile, eventSnapshot);
  }

  const summary = {
    observedAt: current.observedAt,
    level: overallLevel(checks),
    gitbookApv,
    manifestApv: current.manifestApv,
    noticeApv: current.noticeApv,
    clientBuild, // 정보성만 — 어떤 check에도 쓰이지 않음, 인코딩 규칙 미확정
    eventJson: eventSnapshot ? { versionId: eventSnapshot.versionId, etag: eventSnapshot.etag, bytes: eventSnapshot.body.length } : null,
    checks,
  };

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printHumanReadable(summary);
  }

  process.exit(summary.level === "FATAL" ? 1 : 0);
}

function printHumanReadable(summary: {
  level: string;
  gitbookApv: number;
  manifestApv: { odin: number | null; heimdall: number | null; thor: number | null };
  noticeApv: { en: number | null; kr: number | null; jp: number | null };
  clientBuild: { version: number; timestamp: string } | null;
  eventJson: { versionId: string | null; etag: string | null; bytes: number } | null;
  checks: Check[];
}) {
  console.log(`전체 상태: ${summary.level}`);
  console.log(
    `깃북(기준) v${summary.gitbookApv} | odin v${summary.manifestApv.odin ?? "?"} | heimdall v${summary.manifestApv.heimdall ?? "?"} | 공지 EN v${summary.noticeApv.en ?? "?"}/KR v${summary.noticeApv.kr ?? "?"}/JP v${summary.noticeApv.jp ?? "?"}`,
  );
  if (summary.clientBuild) {
    console.log(`(참고, 정보성) 클라 빌드 버전: ${summary.clientBuild.version} (${summary.clientBuild.timestamp}) — APV와의 인코딩 규칙 미확정`);
  }
  if (summary.eventJson) {
    console.log(`(참고) Event.json versionId=${summary.eventJson.versionId ?? "?"} (${summary.eventJson.bytes}바이트) — S3 과거 버전 소급 조회는 별도 자격증명 필요`);
  } else {
    console.log("(참고) Event.json 조회 실패 — 아래 검사에서 이 부분은 건너뜀");
  }
  console.log("");
  for (const c of summary.checks) {
    const mark = c.ok ? "OK   " : c.level === "FATAL" ? "FATAL" : "WARN ";
    console.log(`[${mark}] ${c.name} — ${c.detail}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
