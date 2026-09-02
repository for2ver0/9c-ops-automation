/**
 * On-chain transaction status lookup, via Mimir.
 *
 * Built for arena-settlement-check's one confirmed-safe-to-automate piece (spec doc
 * §6-1: "지급 후 거래(tx) 성공 여부 확인은 읽기 동작이라 자동화해도 안전합니다").
 *
 * Context that makes this genuinely useful, not just a convenience wrapper (investigated
 * 2026-08-30 — see .claude/skills/arena-settlement-check/references/settlement-investigation.md):
 * `ArenaNcgSettlement.razor` (the actual settlement page — one corporate NCG sweep tx per
 * planet, NOT a per-user payout list) keeps its Sign/Stage state (txId, nonce, sender) only
 * in Blazor circuit memory. Refresh the page and it's gone — there is no server-side record
 * of "did we already sign/stage this, and did it succeed" anywhere. A txId copied out of
 * that page before refreshing is the only thread back to the truth, and this module (plus
 * arena-settlement-check.ts's --log-file) is what turns that thread into something durable.
 *
 * Data source: same Mimir `transaction(txId:)` query used nowhere else in this codebase yet
 * (arena-block-time.ts uses `block`/`blocks`, not `transaction`). Confirmed live 2026-08-30
 * against a real Odin tx (SUCCESS, unauthenticated).
 */

import { requireMimirHost, type ArenaNetwork } from "./arena-network";

export type TxStatus = "SUCCESS" | "FAILURE" | "STAGING" | "INCLUDED" | "INVALID";

export interface TxStatusResult {
  readonly network: ArenaNetwork;
  readonly txId: string;
  readonly status: TxStatus;
  readonly signer: string | null;
  readonly blockIndex: number | null;
}

export class TxNotFoundError extends Error {
  constructor(network: ArenaNetwork, txId: string) {
    super(`${network}에서 tx ${txId}를 찾을 수 없습니다 — Mimir에 아직 인덱싱 안 됐거나(방금 낸 tx라면 잠시 후 재시도) txId가 틀렸을 수 있습니다.`);
  }
}

export async function fetchTxStatus(network: ArenaNetwork, txId: string): Promise<TxStatusResult> {
  const mimirHost = requireMimirHost(network);
  const res = await fetch(mimirHost, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // blockIndex lives on the TransactionDocument wrapper, NOT inside `object` (Transaction
    // itself has no blockIndex field). Got this wrong on the first pass and GraphQL schema
    // validation caught it immediately and loudly ("The field `blockIndex` does not exist
    // on the type `Transaction`") rather than silently returning null — verified live
    // 2026-08-30, both the wrong shape (error) and the right one (real value) tested.
    body: JSON.stringify({
      query: `{ transaction(txId: "${txId}") { blockIndex object { id txStatus signer } } }`,
    }),
  });
  if (!res.ok) throw new Error(`Mimir transaction(txId: ${txId}) -> HTTP ${res.status}`);
  const body = (await res.json()) as {
    data?: { transaction?: { blockIndex: number | null; object: { id: string; txStatus: TxStatus; signer: string | null } } };
    errors?: Array<{ message: string }>;
  };
  if (body.errors?.length) {
    // Mimir reports "not found" as a GraphQL error, not an empty/null data.transaction —
    // same surprise hit earlier in arena-block-time.ts's fetchBlockTimestamp. Must special
    // case the message text rather than relying on the data-shape check below, which this
    // response never reaches.
    if (body.errors[0].message.includes("not found")) throw new TxNotFoundError(network, txId);
    throw new Error(`Mimir transaction(txId: ${txId}) error: ${body.errors[0].message}`);
  }
  if (!body.data?.transaction) throw new TxNotFoundError(network, txId);

  const { blockIndex, object: obj } = body.data.transaction;
  return { network, txId: obj.id, status: obj.txStatus, signer: obj.signer, blockIndex };
}
