/**
 * Batch-claim winnings across all legs of a resolved GroupMarket.
 *
 * For each leg where the user holds YES or NO tokens, builds a
 * `claim_winnings` instruction. The on-chain handler burns ALL user tokens
 * for that leg and pays out 1 USDC per winning token. We skip legs where
 * the user has no balance.
 *
 * Instructions are bundled in chunks (~3 per tx) since claim_winnings is
 * heavy (~300k CU: token burns + transfer + ATA close).
 */

import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { BN } from "@anchor-lang/core";
import type { GroupData } from "@/hooks/use-groups";
import type { MarketData } from "@/hooks/use-markets";
import { USDC_MINT } from "@/lib/constants";
import { deriveNoMint, deriveVault, deriveYesMint } from "@/lib/pda";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnchorProgram = any;

/** ~3 claim_winnings ix per tx stays under 1.4M CU with headroom. */
const MAX_CLAIMS_PER_TX = 3;

export interface ClaimableLeg {
  market: MarketData;
  legIndex: number;
  yesBalance: number;
  noBalance: number;
  /** Expected USDC payout = balance of the winning side for this leg. */
  expectedPayout: number;
}

export interface RunClaimArgs {
  program: AnchorProgram;
  wallet: PublicKey;
  group: GroupData;
  onProgress?: (label: string, i: number, n: number) => void;
}

/**
 * Walk every attached leg, check the user's YES/NO balances, and return the
 * list of claimable legs with their expected payout. Pure read — no tx.
 */
export async function findClaimableLegs(
  program: AnchorProgram,
  wallet: PublicKey,
  group: GroupData,
): Promise<ClaimableLeg[]> {
  if (!group.resolved) {
    throw new Error("Group is not yet resolved — no winnings available to claim");
  }
  const conn = program.provider.connection;
  const winningLeg = group.winningLeg;

  // Fetch all leg balances in parallel. Sequential `await` per leg would have
  // taken (N × RPC RTT) and opened a stale-state window during which a swap
  // on any leg could shift the user's balance between reads. `Promise.all`
  // closes the window to ~1 RPC RTT.
  const legChecks = await Promise.all(
    group.legs.map(async (market, i) => {
      if (!market) {
        // The market deserialization failed upstream (stale cache, RPC blip).
        // Surface it so the UI can warn the user that not every leg was
        // inspected — silent skip would risk an under-claim.
        console.warn(`findClaimableLegs: leg ${i} on group ${group.publicKey} is null — skipping`);
        return null;
      }
      const marketPda = new PublicKey(market.publicKey);
      const yesMint = deriveYesMint(marketPda);
      const noMint = deriveNoMint(marketPda);
      const userYes = await getAssociatedTokenAddress(yesMint, wallet);
      const userNo = await getAssociatedTokenAddress(noMint, wallet);
      const [yesBal, noBal] = await Promise.all([
        safeBalance(conn, userYes),
        safeBalance(conn, userNo),
      ]);
      if (yesBal === 0 && noBal === 0) return null;
      // Winning side: this leg's YES if i === winningLeg, else NO (also when
      // the group was cancelled — winningLeg === null → every leg is NO
      // winner). `winningLeg === null` makes `i === winningLeg` false even
      // for i=0, so the leg-0-resolved corner case is handled.
      const isYesWinner = winningLeg !== null && i === winningLeg;
      const expectedPayout = isYesWinner ? yesBal : noBal;
      return {
        market,
        legIndex: i,
        yesBalance: yesBal,
        noBalance: noBal,
        expectedPayout,
      } satisfies ClaimableLeg;
    }),
  );
  return legChecks.filter((c): c is ClaimableLeg => c !== null);
}

/**
 * Execute the batch. Returns the total micro-USDC claimed (estimate; the
 * on-chain handler caps each payout at vault.amount, so the actual amount
 * received may be lower in degenerate cases).
 */
export async function runClaimAllGroupWinnings(
  args: RunClaimArgs,
): Promise<{ legsClaimed: number; estimatedMicroUsdc: number }> {
  const { program, wallet, group, onProgress } = args;
  const claimable = await findClaimableLegs(program, wallet, group);
  if (claimable.length === 0) {
    throw new Error("No claimable positions on this group");
  }

  // Build per-leg ix groups. Each group = [createYesAta?, createNoAta?, claim_winnings]
  // depending on whether the user's ATAs already exist. Empty leg group = empty array.
  const headerIxs = await ensureUsdcAtaIxs(program, wallet);
  const legIxGroups = await Promise.all(
    claimable.map((c) => buildLegClaimIxs(program, wallet, c.market)),
  );

  // Pack leg groups into transactions, keeping each group atomic (never split
  // a leg's create-ATA + claim across two txs).
  const chunks = chunkLegGroups(headerIxs, legIxGroups);
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(`Claim batch ${i + 1}`, i + 1, chunks.length);
    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ...chunks[i],
    );
    await program.provider.sendAndConfirm(tx, []);
  }

  const estimatedMicroUsdc = claimable.reduce((s, c) => s + c.expectedPayout, 0);
  return { legsClaimed: claimable.length, estimatedMicroUsdc };
}

// ============================================================================
// Helpers
// ============================================================================

async function safeBalance(
  conn: { getAccountInfo: (pk: PublicKey) => Promise<unknown> },
  ata: PublicKey,
): Promise<number> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const acc = await getAccount(conn as any, ata);
    return Number(acc.amount);
  } catch (err) {
    // `getAccount` throws on two very different conditions:
    //   1. TokenAccountNotFoundError / TokenInvalidAccountOwnerError — the
    //      ATA simply doesn't exist for this user. That's the legitimate
    //      "no balance" case and we report 0.
    //   2. Any RPC failure (timeout, 5xx, rate-limit) — we MUST NOT report 0,
    //      or the user will silently see "nothing to claim" while their
    //      tokens are stuck. Re-throw so the caller (findClaimableLegs) can
    //      surface a real error to the UI.
    const name = err instanceof Error ? err.name : "";
    const msg = err instanceof Error ? err.message : String(err);
    // The set of "missing ATA" error shapes that `@solana/spl-token` and
    // the RPC layer produce varies by version. Match generously on names
    // AND substrings so we don't false-positive a transient RPC failure as
    // "no balance" (which would silently under-claim user funds).
    const isMissingAta =
      name === "TokenAccountNotFoundError" ||
      name === "TokenInvalidAccountOwnerError" ||
      name === "TokenInvalidAccountError" ||
      msg.includes("could not find account") ||
      msg.includes("Account does not exist") ||
      msg.includes("Invalid account owner") ||
      msg.includes("TokenAccountNotFoundError") ||
      msg.includes("Failed to find account");
    if (isMissingAta) return 0;
    console.warn(`safeBalance: RPC error reading ${ata.toBase58()}:`, err);
    throw err;
  }
}

async function ensureUsdcAtaIxs(
  program: AnchorProgram,
  wallet: PublicKey,
): Promise<TransactionInstruction[]> {
  const userUsdc = await getAssociatedTokenAddress(USDC_MINT, wallet);
  const info = await program.provider.connection.getAccountInfo(userUsdc);
  if (info) return [];
  return [createAssociatedTokenAccountInstruction(wallet, userUsdc, wallet, USDC_MINT)];
}

/**
 * Build the full ix group for one leg's claim:
 *   [maybe createYesAta, maybe createNoAta, claim_winnings]
 *
 * claim_winnings requires user_yes, user_no, and user_collateral to be
 * already-initialized TokenAccounts (Anchor `Account<TokenAccount>` is strict).
 * The handler also closes the YES/NO ATAs after burn, so a subsequent claim
 * on a different group leg may need to recreate them.
 */
async function buildLegClaimIxs(
  program: AnchorProgram,
  wallet: PublicKey,
  market: MarketData,
): Promise<TransactionInstruction[]> {
  const marketPda = new PublicKey(market.publicKey);
  const yesMint = deriveYesMint(marketPda);
  const noMint = deriveNoMint(marketPda);
  const vault = deriveVault(marketPda);
  const userYes = await getAssociatedTokenAddress(yesMint, wallet);
  const userNo = await getAssociatedTokenAddress(noMint, wallet);
  const userCollateral = await getAssociatedTokenAddress(USDC_MINT, wallet);
  const conn = program.provider.connection;

  const ixs: TransactionInstruction[] = [];
  if (!(await conn.getAccountInfo(userYes))) {
    ixs.push(createAssociatedTokenAccountInstruction(wallet, userYes, wallet, yesMint));
  }
  if (!(await conn.getAccountInfo(userNo))) {
    ixs.push(createAssociatedTokenAccountInstruction(wallet, userNo, wallet, noMint));
  }

  const claim = await program.methods
    .claimWinnings(new BN(1)) // amount ignored — settles everything
    .accounts({
      signer: wallet,
      market: marketPda,
      collateralMint: USDC_MINT,
      yesMint,
      noMint,
      vault,
      userYes,
      userNo,
      userCollateral,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  ixs.push(claim);
  return ixs;
}

/**
 * Pack leg ix groups into transactions, never splitting a group. Each chunk
 * holds at most MAX_CLAIMS_PER_TX legs (3 claim_winnings = ~900k CU + ATA
 * creates ≈ 1080k CU worst case, still under the 1.4M cap).
 */
function chunkLegGroups(
  headerIxs: TransactionInstruction[],
  legGroups: TransactionInstruction[][],
): TransactionInstruction[][] {
  const chunks: TransactionInstruction[][] = [];
  let current: TransactionInstruction[] = [...headerIxs];
  let legsInCurrent = 0;
  for (const group of legGroups) {
    if (legsInCurrent >= MAX_CLAIMS_PER_TX) {
      chunks.push(current);
      current = [];
      legsInCurrent = 0;
    }
    current.push(...group);
    legsInCurrent += 1;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
