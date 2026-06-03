/**
 * Instruction builders for the 5 binary Commitment Vault instructions (Sprint 22).
 */
import { SystemProgram, type PublicKey, type TransactionInstruction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import type { BN } from "@anchor-lang/core";
import { type IxContext, bn } from "./context";
import { SYSVAR_RENT_PUBKEY } from "../constants";
import {
  deriveVaultPda,
  deriveVaultCollateralPda,
  deriveCommitPositionPda,
  deriveLpPosition,
  deriveMarketPda,
  deriveYesMint,
  deriveNoMint,
  deriveMarketVault,
  deriveMetadataPda,
} from "../pda";
import { sideArg, type Side } from "../types/args";

type Amount = BN | number | bigint;

export async function buildInitializeVault(
  ctx: IxContext,
  p: {
    authority: PublicKey;
    vaultId: number | bigint;
    name: string;
    commitDurationSecs: number | bigint;
    marketDurationSecs: number | bigint;
    minTotal: Amount;
  },
): Promise<TransactionInstruction> {
  const vault = deriveVaultPda(ctx.programId, p.vaultId);
  return ctx.program.methods
    .initializeVault(
      bn(p.vaultId),
      p.name,
      bn(p.commitDurationSecs),
      bn(p.marketDurationSecs),
      bn(p.minTotal),
    )
    .accountsPartial({
      authority: p.authority,
      vault,
      collateralMint: ctx.collateralMint,
      vaultCollateral: deriveVaultCollateralPda(ctx.programId, vault),
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();
}

export async function buildVaultCommit(
  ctx: IxContext,
  p: { signer: PublicKey; vault: PublicKey; side: Side; amount: Amount },
): Promise<TransactionInstruction> {
  return ctx.program.methods
    .vaultCommit(sideArg(p.side), bn(p.amount))
    .accountsPartial({
      signer: p.signer,
      vault: p.vault,
      collateralMint: ctx.collateralMint,
      vaultCollateral: deriveVaultCollateralPda(ctx.programId, p.vault),
      userCollateral: await getAssociatedTokenAddress(ctx.collateralMint, p.signer),
      commitPosition: deriveCommitPositionPda(ctx.programId, p.vault, p.signer),
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

export async function buildLaunchVaultMarket(
  ctx: IxContext,
  p: { payer: PublicKey; vault: PublicKey; marketId: number | bigint },
): Promise<TransactionInstruction> {
  const market = deriveMarketPda(ctx.programId, p.marketId);
  const yesMint = deriveYesMint(ctx.programId, market);
  const noMint = deriveNoMint(ctx.programId, market);
  return ctx.program.methods
    .launchVaultMarket(bn(p.marketId))
    .accountsPartial({
      payer: p.payer,
      vault: p.vault,
      market,
      collateralMint: ctx.collateralMint,
      yesMint,
      noMint,
      marketVault: deriveMarketVault(ctx.programId, market),
      vaultCollateral: deriveVaultCollateralPda(ctx.programId, p.vault),
      yesMetadata: deriveMetadataPda(yesMint, ctx.metaplexProgramId),
      noMetadata: deriveMetadataPda(noMint, ctx.metaplexProgramId),
      tokenMetadataProgram: ctx.metaplexProgramId,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();
}

export async function buildClaimCommitter(
  ctx: IxContext,
  p: { signer: PublicKey; vault: PublicKey; market: PublicKey },
): Promise<TransactionInstruction> {
  // Option C (audit #6): claim materializes the committer's LP position
  // (1 USDC committed = 1 LP share). No YES/NO mint or USDC move here — the
  // pot was deposited as liquidity at launch.
  return ctx.program.methods
    .claimCommitter()
    .accountsPartial({
      signer: p.signer,
      vault: p.vault,
      market: p.market,
      commitPosition: deriveCommitPositionPda(ctx.programId, p.vault, p.signer),
      lpPosition: deriveLpPosition(ctx.programId, p.market, p.signer),
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export async function buildRefundCommit(
  ctx: IxContext,
  p: { signer: PublicKey; vault: PublicKey },
): Promise<TransactionInstruction> {
  return ctx.program.methods
    .refundCommit()
    .accountsPartial({
      signer: p.signer,
      vault: p.vault,
      vaultCollateral: deriveVaultCollateralPda(ctx.programId, p.vault),
      collateralMint: ctx.collateralMint,
      userCollateral: await getAssociatedTokenAddress(ctx.collateralMint, p.signer),
      commitPosition: deriveCommitPositionPda(ctx.programId, p.vault, p.signer),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}
