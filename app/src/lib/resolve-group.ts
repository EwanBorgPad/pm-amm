/**
 * Orchestrates the cascade resolution of a GroupMarket from the UI.
 *
 * Two flows:
 *   runResolveGroup({...})    → authority picks a winner, all legs cascade
 *   runCancelGroup({...})     → group is abandoned, all legs → Side::No
 *
 * Both flows attempt to bundle (resolve_group | cancel_group_market) and
 * every `resolve_group_leg(i)` into a SINGLE transaction. For typical N ≤ 10
 * this fits well under Solana's 1232-byte / 1.4M CU caps. For larger N we
 * split into chunks of `MAX_LEGS_PER_TX` to stay safe.
 */

import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnchorProgram = any;

/** Empirical limit: resolve_group_leg ≈ 100k CU each + ~30k for the header
 *  instruction. Cap at 8 (≈ 830k CU + header) to keep margin against future
 *  per-ix cost growth and 1232-byte tx-size limits with large pubkey sets. */
const MAX_LEGS_PER_TX = 8;

/** Anchor exposes Pubkey::default() as the system program address ("111…1").
 *  These are unattached leg slots — we must skip them in the cascade. */
const PUBKEY_DEFAULT = "11111111111111111111111111111111";

export interface RunResolveGroupArgs {
  program: AnchorProgram;
  wallet: PublicKey;
  groupPda: PublicKey;
  legPubkeys: string[];
  /** Index of the winning leg, or `null` to cancel. */
  winningLeg: number | null;
  onProgress?: (label: string, index: number, total: number) => void;
}

export async function runResolveGroup(args: RunResolveGroupArgs): Promise<void> {
  const { program, wallet, groupPda, legPubkeys, winningLeg, onProgress } = args;
  const isCancel = winningLeg === null;

  // Defensive client-side validation. The on-chain handler enforces the same
  // bounds, but failing here saves the user a signature on a tx that would
  // revert anyway.
  if (!isCancel) {
    if (!Number.isInteger(winningLeg) || winningLeg < 0 || winningLeg >= legPubkeys.length) {
      throw new Error(
        `Winning leg ${winningLeg} out of range [0, ${legPubkeys.length}) for this group`,
      );
    }
  }
  if (legPubkeys.length === 0) {
    throw new Error("Group has no leg slots — nothing to cascade-resolve");
  }

  // Build the "header" instruction: either resolve_group or cancel_group_market.
  const headerIx = isCancel
    ? await buildCancelIx(program, wallet, groupPda)
    : await buildResolveIx(program, wallet, groupPda, winningLeg);

  // Build one resolve_group_leg(i) per ATTACHED leg only — skip empty slots
  // (Pubkey::default() means the slot was never attached, e.g. when a
  // partial group is being cancelled).
  const attached = legPubkeys
    .map((pk, i) => ({ legIndex: i, pubkey: pk }))
    .filter((x) => x.pubkey !== PUBKEY_DEFAULT && x.pubkey !== "");
  const legIxs = await Promise.all(
    attached.map(({ legIndex, pubkey }) =>
      buildLegCascadeIx(program, groupPda, new PublicKey(pubkey), legIndex),
    ),
  );

  // Pack everything into transactions of up to MAX_LEGS_PER_TX legs.
  // First chunk includes the header ix; subsequent chunks are leg-only.
  const chunks = chunkInstructions(headerIx, legIxs);
  const total = chunks.length;
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(
      i === 0 ? (isCancel ? "Cancel group" : "Resolve group") : `Cascade legs #${i + 1}`,
      i + 1,
      total,
    );
    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ...chunks[i],
    );
    await program.provider.sendAndConfirm(tx, []);
  }
}

/** Split instructions into chunks small enough for one tx each. */
function chunkInstructions(
  headerIx: TransactionInstruction,
  legIxs: TransactionInstruction[],
): TransactionInstruction[][] {
  const chunks: TransactionInstruction[][] = [];
  let current: TransactionInstruction[] = [headerIx];
  for (const ix of legIxs) {
    if (current.length >= MAX_LEGS_PER_TX + (chunks.length === 0 ? 1 : 0)) {
      chunks.push(current);
      current = [];
    }
    current.push(ix);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

async function buildResolveIx(
  program: AnchorProgram,
  wallet: PublicKey,
  groupPda: PublicKey,
  winningLeg: number,
): Promise<TransactionInstruction> {
  return program.methods
    .resolveGroup(winningLeg)
    .accounts({ authority: wallet, groupMarket: groupPda })
    .instruction();
}

async function buildCancelIx(
  program: AnchorProgram,
  wallet: PublicKey,
  groupPda: PublicKey,
): Promise<TransactionInstruction> {
  return program.methods
    .cancelGroupMarket()
    .accounts({ authority: wallet, groupMarket: groupPda })
    .instruction();
}

async function buildLegCascadeIx(
  program: AnchorProgram,
  groupPda: PublicKey,
  marketPda: PublicKey,
  legIndex: number,
): Promise<TransactionInstruction> {
  return program.methods
    .resolveGroupLeg(legIndex)
    .accounts({ groupMarket: groupPda, market: marketPda })
    .instruction();
}
