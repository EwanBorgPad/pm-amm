/**
 * Client helpers for the Commitment Vault (Sprint 22).
 *
 * Wraps the 5 vault instructions into TS-friendly entry points that the UI
 * pages can call. Errors are surfaced via thrown Errors so the caller can
 * toast them.
 */

/* eslint-disable @typescript-eslint/no-explicit-any --
 * Write-path Anchor CPI builders use `(program.methods as any)` because the
 * generated IDL TS types lag the on-chain struct between `anchor build` runs.
 */

import { ComputeBudgetProgram, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { BN } from "@anchor-lang/core";
import { METAPLEX_PROGRAM_ID, USDC_MINT } from "@/lib/constants";
import { deriveMarketPda, deriveNoMint, deriveVault, deriveYesMint } from "@/lib/pda";

type AnchorProgram = any;

const VAULT_SEED = Buffer.from("vault");
const VAULT_COLLATERAL_SEED = Buffer.from("vault_collateral");
const COMMIT_SEED = Buffer.from("commit");

function programId(program: AnchorProgram): PublicKey {
  return new PublicKey(program.idl.address);
}

export function deriveVaultPda(vaultId: number, program: AnchorProgram): PublicKey {
  const idBuf = new BN(vaultId).toArrayLike(Buffer, "le", 8);
  return PublicKey.findProgramAddressSync([VAULT_SEED, idBuf], programId(program))[0];
}

export function deriveVaultCollateralPda(vault: PublicKey, program: AnchorProgram): PublicKey {
  return PublicKey.findProgramAddressSync(
    [VAULT_COLLATERAL_SEED, vault.toBuffer()],
    programId(program),
  )[0];
}

export function deriveCommitPositionPda(
  vault: PublicKey,
  owner: PublicKey,
  program: AnchorProgram,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [COMMIT_SEED, vault.toBuffer(), owner.toBuffer()],
    programId(program),
  )[0];
}

function deriveMetadataPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METAPLEX_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METAPLEX_PROGRAM_ID,
  )[0];
}

/** Generate a 48-bit random id (fits in JS Number, unpredictable). */
function randomU48(): number {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let n = 0;
  for (let i = 0; i < 6; i++) n = n * 256 + bytes[i];
  return n;
}

// ============================================================================
// Public entrypoints
// ============================================================================

export interface CreateVaultInput {
  name: string;
  commitDurationSecs: number;
  marketDurationSecs: number;
  minTotalUsdc: number;
}

export async function runCreateVault(
  program: AnchorProgram,
  wallet: PublicKey,
  input: CreateVaultInput,
): Promise<{ vaultId: number; vaultPda: string }> {
  const vaultId = randomU48();
  const vault = deriveVaultPda(vaultId, program);
  const vaultCollateral = deriveVaultCollateralPda(vault, program);

  await program.methods
    .initializeVault(
      new BN(vaultId),
      input.name,
      new BN(input.commitDurationSecs),
      new BN(input.marketDurationSecs),
      new BN(Math.floor(input.minTotalUsdc * 1e6)),
    )
    .accountsPartial({
      authority: wallet,
      vault,
      collateralMint: USDC_MINT,
      vaultCollateral,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: new PublicKey("SysvarRent111111111111111111111111111111111"),
    })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
    .rpc();

  return { vaultId, vaultPda: vault.toBase58() };
}

export async function runVaultCommit(
  program: AnchorProgram,
  wallet: PublicKey,
  vaultPda: PublicKey,
  side: "yes" | "no",
  amountUsdc: number,
): Promise<void> {
  const vaultCollateral = deriveVaultCollateralPda(vaultPda, program);
  const userCollateral = await getAssociatedTokenAddress(USDC_MINT, wallet);
  const commitPosition = deriveCommitPositionPda(vaultPda, wallet, program);
  const directionArg = side === "yes" ? { yes: {} } : { no: {} };

  // Make sure the user has a USDC ATA before transferring.
  const preIxs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })];
  const ataInfo = await program.provider.connection.getAccountInfo(userCollateral);
  if (!ataInfo) {
    preIxs.push(createAssociatedTokenAccountInstruction(wallet, userCollateral, wallet, USDC_MINT));
  }

  await program.methods
    .vaultCommit(directionArg, new BN(Math.floor(amountUsdc * 1e6)))
    .accountsPartial({
      signer: wallet,
      vault: vaultPda,
      collateralMint: USDC_MINT,
      vaultCollateral,
      userCollateral,
      commitPosition,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions(preIxs)
    .rpc();
}

export async function runLaunchVaultMarket(
  program: AnchorProgram,
  wallet: PublicKey,
  vaultPda: PublicKey,
): Promise<{ marketId: number; marketPda: string }> {
  const marketId = randomU48();
  const marketPda = deriveMarketPda(marketId);
  const yesMint = deriveYesMint(marketPda);
  const noMint = deriveNoMint(marketPda);
  const marketVault = deriveVault(marketPda);
  const yesMetadata = deriveMetadataPda(yesMint);
  const noMetadata = deriveMetadataPda(noMint);

  await program.methods
    .launchVaultMarket(new BN(marketId))
    .accountsPartial({
      payer: wallet,
      vault: vaultPda,
      market: marketPda,
      collateralMint: USDC_MINT,
      yesMint,
      noMint,
      marketVault,
      yesMetadata,
      noMetadata,
      tokenMetadataProgram: METAPLEX_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: new PublicKey("SysvarRent111111111111111111111111111111111"),
    })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
    .rpc();

  return { marketId, marketPda: marketPda.toBase58() };
}

/** Binary vault v2 claim — mints YES + NO tokens to the user, transfers
 *  the backing USDC from commitment vault to market vault.
 *
 *  Caller must pass the launched `marketPda` (read from `vault.market`).
 *  YES/NO mints, market vault, and user YES/NO ATAs are derived. */
export async function runClaimCommitter(
  program: AnchorProgram,
  wallet: PublicKey,
  vaultPda: PublicKey,
  marketPda: PublicKey,
): Promise<void> {
  const vaultCollateral = deriveVaultCollateralPda(vaultPda, program);
  const commitPosition = deriveCommitPositionPda(vaultPda, wallet, program);
  const yesMint = deriveYesMint(marketPda);
  const noMint = deriveNoMint(marketPda);
  const marketVault = deriveVault(marketPda);
  const userYes = await getAssociatedTokenAddress(yesMint, wallet);
  const userNo = await getAssociatedTokenAddress(noMint, wallet);

  await program.methods
    .claimCommitter()
    .accountsPartial({
      signer: wallet,
      vault: vaultPda,
      vaultCollateral,
      collateralMint: USDC_MINT,
      market: marketPda,
      marketVault,
      yesMint,
      noMint,
      userYes,
      userNo,
      commitPosition,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
    .rpc();
}

export async function runRefundCommit(
  program: AnchorProgram,
  wallet: PublicKey,
  vaultPda: PublicKey,
): Promise<void> {
  const vaultCollateral = deriveVaultCollateralPda(vaultPda, program);
  const userCollateral = await getAssociatedTokenAddress(USDC_MINT, wallet);
  const commitPosition = deriveCommitPositionPda(vaultPda, wallet, program);

  await program.methods
    .refundCommit()
    .accountsPartial({
      signer: wallet,
      vault: vaultPda,
      vaultCollateral,
      collateralMint: USDC_MINT,
      userCollateral,
      commitPosition,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
    .rpc();
}
