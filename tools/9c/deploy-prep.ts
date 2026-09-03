#!/usr/bin/env bun
/**
 * deploy-prep — CURRENTLY A PARTIAL BUILD. See tools/9c/lib/deploy-prep.ts module doc and
 * .claude/skills/deploy-prep/SKILL.md for the full story; short version:
 *
 * 설계 문서 부록 C가 deploy-prep에 요구한 것 중, 이번 착수는 다음만 만든다.
 *   1. APV 결번 검사 — release-guard의 checkGitbookVsManifest를 그대로 재사용(중복 구현 안 함).
 *   2. latest.json 롤백 스냅샷 — --snapshot-log로 append-only 로그를 쌓고, 지금 값과 다른
 *      가장 최근 값을 롤백 대상으로 계산.
 *   3. Manage Apv 워크플로 입력값 준비 — 트리거는 안 함, 값만 계산.
 * 인코딩 규칙(APV ↔ latest.json version)은 관측 1건뿐이라 정보성으로만 표시하고 어떤
 * 판정에도 쓰지 않는다 (lib/deploy-prep.ts 모듈 doc 참고).
 *
 * Usage:
 *   bun run tools/9c/deploy-prep.ts [--snapshot-log ./deploy-prep-log.jsonl] [--json]
 */
import { fetchGitbookHead, fetchManifestApv, fetchClientBuildInfo } from "./lib/release-guard";
import {
  checkGitbookVsManifest,
  checkRollbackSnapshotAvailable,
  findRollbackTarget,
  planManageApvWorkflowInputs,
  buildDeployChecklist,
  overallLevel,
  isLatestJsonSnapshotEntry,
  type Check,
  type LatestJsonSnapshotEntry,
} from "./lib/deploy-prep";
import { parseJsonlLog, describeSkippedLines } from "./lib/jsonl-log";

interface Args {
  snapshotLog?: string;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--snapshot-log":
        args.snapshotLog = next();
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

async function readLog(
  path: string | undefined,
): Promise<{ entries: LatestJsonSnapshotEntry[]; warning: string | null }> {
  if (!path) return { entries: [], warning: null };
  const exists = await Bun.file(path).exists();
  if (!exists) return { entries: [], warning: null };
  const text = await Bun.file(path).text();
  // 모양 검증 없이 캐스팅하면 쓰레기 줄이 스냅샷으로 둔갑해 "롤백 대상 확보됨"이 잘못 뜬다
  // (실측 근거는 lib/jsonl-log.ts 모듈 주석).
  const { entries, skippedLines } = parseJsonlLog(text, isLatestJsonSnapshotEntry);
  return { entries, warning: describeSkippedLines(path, skippedLines) };
}

async function appendLog(path: string | undefined, entry: LatestJsonSnapshotEntry): Promise<void> {
  if (!path) return;
  const existing = (await Bun.file(path).exists()) ? await Bun.file(path).text() : "";
  const sep = existing && !existing.endsWith("\n") ? "\n" : "";
  await Bun.write(path, existing + sep + JSON.stringify(entry) + "\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const [gitbookApv, odin, heimdall, clientBuild] = await Promise.all([
    fetchGitbookHead(),
    fetchManifestApv("odin"),
    fetchManifestApv("heimdall"),
    fetchClientBuildInfo().catch(() => null),
  ]);

  const { entries: priorLog, warning: logWarning } = await readLog(args.snapshotLog);
  let rollbackTarget: LatestJsonSnapshotEntry | null = null;
  if (clientBuild) {
    rollbackTarget = findRollbackTarget(priorLog, clientBuild.version);
    await appendLog(args.snapshotLog, {
      observedAt: new Date().toISOString(),
      version: clientBuild.version,
      clientTimestamp: clientBuild.timestamp,
    });
  }

  const checks: Check[] = [checkGitbookVsManifest(gitbookApv, odin), checkGitbookVsManifest(gitbookApv, heimdall)];
  if (clientBuild) {
    checks.push(checkRollbackSnapshotAvailable(rollbackTarget, priorLog.length > 0));
  }
  // 건너뛴 로그 줄은 반드시 사람이 보게 체크 항목으로 올린다 — 조용히 무시하면 "롤백 대상이
  // 없는 이유"를 알 수 없게 된다(로그가 상했는지 원래 기록이 없는지 구분이 안 된다).
  if (logWarning) {
    checks.push({
      id: "snapshot-log-unreadable-lines",
      name: "롤백 스냅샷 로그 형식",
      ok: false,
      level: "WARN",
      detail: logWarning,
    });
  }

  const manageApvInputs = planManageApvWorkflowInputs(gitbookApv, odin, heimdall);
  const checklist = buildDeployChecklist({ gitbookApv, odin, heimdall, clientBuild, rollbackTarget, manageApvInputs });

  const summary = {
    observedAt: new Date().toISOString(),
    level: overallLevel(checks),
    gitbookApv,
    manifestApv: { odin: odin.apv, heimdall: heimdall.apv },
    clientBuild,
    rollbackTarget,
    manageApvInputs,
    checks,
    checklist,
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
  manifestApv: { odin: number | null; heimdall: number | null };
  clientBuild: { version: number; timestamp: string } | null;
  checks: Check[];
  checklist: string[];
}) {
  console.log(`전체 상태: ${summary.level}`);
  console.log(
    `깃북(기준) v${summary.gitbookApv} | odin v${summary.manifestApv.odin ?? "?"} | heimdall v${summary.manifestApv.heimdall ?? "?"}`,
  );
  if (summary.clientBuild) {
    console.log(`(참고, 정보성) latest.json version: ${summary.clientBuild.version} (${summary.clientBuild.timestamp})`);
  }
  console.log("");
  for (const c of summary.checks) {
    const mark = c.ok ? "OK   " : c.level === "FATAL" ? "FATAL" : "WARN ";
    console.log(`[${mark}] ${c.name} — ${c.detail}`);
  }
  console.log("\n=== 배포 전/후 체크리스트 ===");
  for (const item of summary.checklist) {
    console.log(item);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
