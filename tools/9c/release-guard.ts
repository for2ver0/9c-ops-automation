#!/usr/bin/env bun
/**
 * release-guard — CURRENTLY A PARTIAL BUILD covering only the "일관성·헤드" half of the
 * design doc's release-guard scope. See SKILL.md for the full story; short version:
 *
 * The design doc splits release-guard into two independent halves:
 *   1. 일관성·헤드 대조 — 깃북(기준) vs 메인넷 매니페스트 APV vs 인게임 공지판 헤더.
 *      전부 공개 읽기라 권한 대기 없이 착수 가능(설계 문서 §4 "release-guard" 행 + §5 주석).
 *   2. Event.json 스냅샷/백업 — S3 읽기 권한 + 백업 저장 위치 결정이 아직 없어 미착수.
 *
 * 이 CLI는 1번만 한다. 매 실행은 stateless이므로, "깃북 자체가 며칠째 안 올라왔는지" 같은
 * 지속시간 판단은 `--log-file`로 넘긴 로컬 append-only 로그에서 되짚는다(서버 상태 없음 —
 * 설계 문서 부록 B-4(c)와 같은 이유).
 *
 * Usage:
 *   bun run tools/9c/release-guard.ts [--log-file ./release-guard-log.jsonl] [--json]
 */
import {
  fetchGitbookHead,
  fetchManifestApv,
  fetchNoticeHead,
  fetchNoticeHeadFromGit,
  fetchClientBuildInfo,
  checkNoticeHeaderFormat,
  checkNoticeEmptyContents,
  checkNoticeFilesAgree,
  checkNoticeGitMatchesCdn,
  checkGitbookVsNotice,
  checkGitbookVsManifest,
  checkThorInfo,
  findStaleSince,
  checkGitbookStaleness,
  overallLevel,
  type Check,
  type LogEntry,
  type NoticeFile,
} from "./lib/release-guard";

interface Args {
  logFile?: string;
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
      case "--json":
        args.json = true;
        break;
      default:
        throw new Error(`알 수 없는 옵션: ${a}`);
    }
  }
  return args;
}

async function readLog(path: string | undefined): Promise<LogEntry[]> {
  if (!path) return [];
  const exists = await Bun.file(path).exists();
  if (!exists) return [];
  const text = await Bun.file(path).text();
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LogEntry);
}

async function appendLog(path: string | undefined, entry: LogEntry): Promise<void> {
  if (!path) return;
  const existing = (await Bun.file(path).exists()) ? await Bun.file(path).text() : "";
  const sep = existing && !existing.endsWith("\n") ? "\n" : "";
  await Bun.write(path, existing + sep + JSON.stringify(entry) + "\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const [gitbookApv, odin, heimdall, thor, noticeEn, noticeKr, noticeJp, noticeEnGit, noticeKrGit, noticeJpGit, clientBuild] =
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
  const priorLog = await readLog(args.logFile);
  const staleSince = findStaleSince(priorLog, current);
  checks.push(checkGitbookStaleness(current, staleSince, new Date()));
  await appendLog(args.logFile, current);

  const summary = {
    observedAt: current.observedAt,
    level: overallLevel(checks),
    gitbookApv,
    manifestApv: current.manifestApv,
    noticeApv: current.noticeApv,
    clientBuild, // 정보성만 — 어떤 check에도 쓰이지 않음, 인코딩 규칙 미확정
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
  checks: Check[];
}) {
  console.log(`전체 상태: ${summary.level}`);
  console.log(
    `깃북(기준) v${summary.gitbookApv} | odin v${summary.manifestApv.odin ?? "?"} | heimdall v${summary.manifestApv.heimdall ?? "?"} | 공지 EN v${summary.noticeApv.en ?? "?"}/KR v${summary.noticeApv.kr ?? "?"}/JP v${summary.noticeApv.jp ?? "?"}`,
  );
  if (summary.clientBuild) {
    console.log(`(참고, 정보성) 클라 빌드 버전: ${summary.clientBuild.version} (${summary.clientBuild.timestamp}) — APV와의 인코딩 규칙 미확정`);
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
