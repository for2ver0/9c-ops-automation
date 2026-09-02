#!/usr/bin/env bun
/**
 * arena-settlement-check — CURRENTLY A PARTIAL BUILD. See SKILL.md for the full story;
 * short version: the spec doc's premise for this skill (compare independently-computed
 * per-user rewards against "the actual payout list") turned out not to exist as a
 * checkable thing — investigated 2026-08-30, see
 * .claude/skills/arena-settlement-check/references/settlement-investigation.md.
 * `ArenaNcgSettlement.razor` is a single per-planet corporate NCG sweep (not a per-user
 * payout page), and no confirmed per-user payout record is stored anywhere — the reward
 * calculation API (`/api/arena/reward/calculate`) is stateless and needs an API key this
 * environment doesn't have yet.
 *
 * What IS built here is the one piece confirmed safe to automate regardless (spec §6-1:
 * "지급 후 거래(tx) 성공 여부 확인은 읽기 동작이라 자동화해도 안전합니다") and genuinely
 * needed: the settlement page's Sign/Stage state lives only in Blazor circuit memory and is
 * lost on refresh, so a txId copied out before refreshing is the only way back to "did this
 * actually go through" — this CLI checks that, and optionally appends a durable local
 * record (--log-file) since the server keeps none.
 *
 * Usage:
 *   bun run tools/9c/arena-settlement-check.ts --network odin --tx <txId>[,<txId>...] \
 *     [--log-file ./settlement-log.jsonl]
 */
import { fetchTxStatus, TxNotFoundError, type TxStatusResult } from "./lib/arena-tx-status";
import type { ArenaNetwork } from "./lib/arena-network";

interface Args {
  network?: ArenaNetwork;
  txIds?: string[];
  logFile?: string;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--network":
        args.network = next() as ArenaNetwork;
        break;
      case "--tx":
        args.txIds = next()
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        break;
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

interface LogEntry extends TxStatusResult {
  readonly checkedAt: string;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const missing: string[] = [];
  if (!args.network) missing.push("--network");
  if (!args.txIds || args.txIds.length === 0) missing.push("--tx");
  if (missing.length > 0) {
    throw new Error(`다음 값을 명시적으로 입력해야 합니다: ${missing.join(", ")}`);
  }

  const results: Array<TxStatusResult | { txId: string; error: string }> = [];
  for (const txId of args.txIds!) {
    try {
      results.push(await fetchTxStatus(args.network!, txId));
    } catch (e) {
      if (e instanceof TxNotFoundError) {
        results.push({ txId, error: e.message });
      } else {
        throw e;
      }
    }
  }

  if (args.logFile) {
    const lines = results
      .filter((r): r is TxStatusResult => !("error" in r))
      .map((r): LogEntry => ({ ...r, checkedAt: new Date().toISOString() }))
      .map((entry) => JSON.stringify(entry))
      .join("\n");
    if (lines) {
      const existing = (await Bun.file(args.logFile).exists()) ? await Bun.file(args.logFile).text() : "";
      await Bun.write(args.logFile, existing + (existing && !existing.endsWith("\n") ? "\n" : "") + lines + "\n");
    }
  }

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const r of results) {
      if ("error" in r) {
        console.log(`[?] ${r.txId} — ${r.error}`);
        continue;
      }
      const mark = r.status === "SUCCESS" ? "OK " : r.status === "STAGING" || r.status === "INCLUDED" ? "..." : "!! ";
      console.log(
        `[${mark}] ${r.network} ${r.txId} — ${r.status}${r.blockIndex ? ` (block ${r.blockIndex.toLocaleString()})` : ""}${r.signer ? ` signer=${r.signer}` : ""}`,
      );
    }
  }

  const anyFailed = results.some((r) => !("error" in r) && (r.status === "FAILURE" || r.status === "INVALID"));
  const anyMissing = results.some((r) => "error" in r);
  if (anyFailed) {
    console.error("\n실패(FAILURE/INVALID) tx가 있습니다 — 반드시 확인하세요.");
    process.exit(1);
  }
  if (anyMissing) {
    console.error("\n일부 tx를 찾지 못했습니다 — txId를 다시 확인하거나 잠시 후 재시도하세요.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
