/**
 * Orchestrates the full multi-outcome group creation flow client-side.
 *
 * Sequence (N + 1 transactions for N legs, +1 if user has no USDC ATA yet):
 *   0. (optional) Create user's USDC ATA
 *   1. initialize_group_market
 *   2. For each leg i in 0..N, ONE transaction bundling:
 *        a. initialize_market (with initial_price_bps = 10_000 / N)
 *        b. deposit_liquidity (bootstrap budgetPerLegUsdc)
 *        c. attach_leg_to_group
 *
 * The per-leg bundle measures ~700 bytes and ~700k CU, well under the Solana
 * limits (1232 bytes, 1.4M CU). Further compaction would need versioned tx +
 * Address Lookup Tables — out of scope for now.
 */

import { ComputeBudgetProgram, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { BN } from "@anchor-lang/core";
import {
  deriveGroupPda,
  deriveLpPosition,
  deriveMarketPda,
  deriveNoMint,
  deriveVault,
  deriveYesMint,
} from "@/lib/pda";
import { METAPLEX_PROGRAM_ID, USDC_MINT } from "@/lib/constants";

export interface GroupCreateInput {
  name: string;
  legCount: number;
  legNames: string[];
  durationSecs: number;
  budgetPerLegUsdc: number;
}

export interface GroupCreateResult {
  groupId: number;
  groupPda: string;
  legMarketIds: number[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnchorProgram = any; // Anchor 1.0 types are still loose; matches use-program.ts

export interface RunCreateGroupArgs {
  program: AnchorProgram;
  wallet: PublicKey;
  input: GroupCreateInput;
  onProgress?: (label: string, index: number) => void;
}

export async function runCreateGroup({
  program,
  wallet,
  input,
  onProgress,
}: RunCreateGroupArgs): Promise<GroupCreateResult> {
  const now = Math.floor(Date.now() / 1000);
  const endTs = now + input.durationSecs;
  const baseId = Date.now() % 1_000_000_000;
  const groupId = baseId;
  const legBps = Math.floor(10_000 / input.legCount);

  const groupPda = deriveGroupPda(groupId);
  let step = 0;
  const tick = (label: string) => onProgress?.(label, ++step);

  // 0. Ensure the user has an ATA for USDC_MINT. If they're on a fresh wallet
  //    (or just switched to a new mock USDC mint), the ATA doesn't exist yet
  //    and the deposit_liquidity instruction would fail with
  //    AccountNotInitialized on user_collateral.
  await ensureUserUsdcAta(program, wallet, tick);

  // 1. Group wrapper
  tick("Create group");
  await initGroupTx(program, wallet, groupPda, groupId, endTs, input);

  // 2. Each leg: init + deposit + attach bundled in ONE tx
  const legMarketIds: number[] = [];
  for (let i = 0; i < input.legCount; i++) {
    const marketId = baseId + 1 + i;
    legMarketIds.push(marketId);
    const legName = (input.legNames[i] || `Outcome ${i + 1}`).slice(0, 60);

    tick(`Setup leg ${i}`);
    await setupLegTx(
      program,
      wallet,
      groupPda,
      marketId,
      i,
      endTs,
      legName,
      legBps,
      input.budgetPerLegUsdc,
    );
  }

  return { groupId, groupPda: groupPda.toBase58(), legMarketIds };
}

// ============================================================================
// Per-step transactions — each under 70 lines per the project rule.
// ============================================================================

async function initGroupTx(
  program: AnchorProgram,
  wallet: PublicKey,
  groupPda: PublicKey,
  groupId: number,
  endTs: number,
  input: GroupCreateInput,
): Promise<void> {
  await program.methods
    .initializeGroupMarket(new BN(groupId), new BN(endTs), input.name, input.legCount)
    .accounts({
      authority: wallet,
      groupMarket: groupPda,
      systemProgram: SystemProgram.programId,
    })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
    .rpc();
}

/**
 * Bundle initialize_market + deposit_liquidity + attach_leg_to_group into a
 * SINGLE Solana transaction. ~700 bytes, ~700k CU — comfortably under the
 * 1232 byte / 1.4M CU caps. Net effect: one Phantom prompt per leg instead
 * of three.
 */
async function setupLegTx(
  program: AnchorProgram,
  wallet: PublicKey,
  groupPda: PublicKey,
  marketId: number,
  legIndex: number,
  endTs: number,
  legName: string,
  initialPriceBps: number,
  budgetUsdc: number,
): Promise<void> {
  const marketPda = deriveMarketPda(marketId);
  const yesMint = deriveYesMint(marketPda);
  const noMint = deriveNoMint(marketPda);
  const vault = deriveVault(marketPda);
  const yesMeta = deriveMetadataPda(yesMint);
  const noMeta = deriveMetadataPda(noMint);
  const userUsdc = await getAssociatedTokenAddress(USDC_MINT, wallet);
  const lpPda = deriveLpPosition(marketPda, wallet);
  const lamports = Math.floor(budgetUsdc * 1e6);

  const ixInit = await program.methods
    .initializeMarket(new BN(marketId), new BN(endTs), legName, initialPriceBps)
    .accounts({
      authority: wallet,
      market: marketPda,
      collateralMint: USDC_MINT,
      yesMint,
      noMint,
      vault,
      yesMetadata: yesMeta,
      noMetadata: noMeta,
      tokenMetadataProgram: METAPLEX_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: new PublicKey("SysvarRent111111111111111111111111111111111"),
    })
    .instruction();

  const ixDeposit = await program.methods
    .depositLiquidity(new BN(lamports))
    .accounts({
      signer: wallet,
      market: marketPda,
      collateralMint: USDC_MINT,
      vault,
      userCollateral: userUsdc,
      lpPosition: lpPda,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  const ixAttach = await program.methods
    .attachLegToGroup(legIndex)
    .accounts({
      authority: wallet,
      groupMarket: groupPda,
      market: marketPda,
    })
    .instruction();

  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ixInit,
    ixDeposit,
    ixAttach,
  );
  await program.provider.sendAndConfirm(tx, []);
}

/** Metaplex Token Metadata PDA: [b"metadata", program, mint]. */
function deriveMetadataPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METAPLEX_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METAPLEX_PROGRAM_ID,
  )[0];
}

/**
 * Cancel an abandoned group past its end_ts. Marks it resolved with
 * NO_WINNING_LEG so attached legs can be finalized as Side::No via
 * `resolve_group_leg`. Authority-only on-chain.
 */
export async function cancelGroupMarket(
  program: AnchorProgram,
  groupPda: PublicKey,
): Promise<void> {
  await program.methods
    .cancelGroupMarket()
    .accounts({
      authority: program.provider.wallet.publicKey,
      groupMarket: groupPda,
    })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 })])
    .rpc();
}

/**
 * Create the user's USDC ATA if it doesn't exist yet. No-op if the account
 * is already initialized. Required before any deposit_liquidity call.
 */
async function ensureUserUsdcAta(
  program: AnchorProgram,
  wallet: PublicKey,
  tick: (label: string) => void,
): Promise<void> {
  const ata = await getAssociatedTokenAddress(USDC_MINT, wallet);
  const info = await program.provider.connection.getAccountInfo(ata);
  if (info) return;

  tick("Create USDC token account");
  const tx = new Transaction().add(
    createAssociatedTokenAccountInstruction(wallet, ata, wallet, USDC_MINT),
  );
  await program.provider.sendAndConfirm(tx, []);
}
