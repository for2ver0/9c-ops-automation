#!/usr/bin/env bun
/**
 * Regression check for arena-tx-status.ts / arena-settlement-check.ts — runs against a
 * real, permanently-settled Odin transaction (won't change status) plus a deliberately
 * fake txId to confirm the not-found path works. Needs live Mimir access.
 */
import { fetchTxStatus, TxNotFoundError } from "../lib/arena-tx-status";

let failed = 0;

// Real Odin tx, confirmed SUCCESS 2026-08-30. A finalized tx's status never changes, so
// this is safe to pin as a golden value.
const KNOWN_TX = {
  network: "odin" as const,
  txId: "0f2623c4002567fda88d70798863b737b9c3ecfd789894033f35ad3887f507fe",
  expectedStatus: "SUCCESS" as const,
  expectedBlockIndex: 19499632,
  expectedSigner: "0x7045A20D79dD63c04dCd7F1d256F41aD4B247e4E",
};

{
  const result = await fetchTxStatus(KNOWN_TX.network, KNOWN_TX.txId);
  const diffs: string[] = [];
  if (result.status !== KNOWN_TX.expectedStatus) diffs.push(`status: ${result.status} != ${KNOWN_TX.expectedStatus}`);
  if (result.blockIndex !== KNOWN_TX.expectedBlockIndex) diffs.push(`blockIndex: ${result.blockIndex} != ${KNOWN_TX.expectedBlockIndex}`);
  if (result.signer !== KNOWN_TX.expectedSigner) diffs.push(`signer: ${result.signer} != ${KNOWN_TX.expectedSigner}`);

  if (diffs.length) {
    failed++;
    console.log("FAIL  known tx lookup");
    diffs.forEach((d) => console.log(`        ${d}`));
  } else {
    console.log("PASS  known tx lookup (status/blockIndex/signer all match)");
  }
}

{
  try {
    await fetchTxStatus("odin", "0000000000000000000000000000000000000000000000000000000000000000");
    failed++;
    console.log("FAIL  not-found tx should have thrown TxNotFoundError, didn't throw at all");
  } catch (e) {
    if (e instanceof TxNotFoundError) {
      console.log("PASS  not-found tx correctly throws TxNotFoundError");
    } else {
      failed++;
      console.log(`FAIL  not-found tx threw the wrong error type: ${e instanceof Error ? e.message : e}`);
    }
  }
}

console.log(failed ? `\n${failed} case(s) FAILED` : "\nall cases match");
process.exit(failed ? 1 : 0);
