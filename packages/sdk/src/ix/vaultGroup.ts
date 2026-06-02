/**
 * Instruction builders for the 6 multi-outcome Commitment Vault instructions
 * (Sprint 23). Launch is two-step: `launchVaultGroupMarket` (the wrapping
 * GroupMarket) then `launchVaultGroupLeg` once per leg.
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
  deriveVaultGroupPda,
  deriveVaultGroupCollateralPda,
  deriveCommitGroupPositionPda,
  deriveGroupPda,
  deriveMarketPda,
  deriveYesMint,
  deriveNoMint,
  deriveMarketVault,
  deriveMetadataPda,
} from "../pda";

type Amount = BN | number | bigint;

export async function buildInitializeVaultGroup(
  ctx: IxContext,
  p: {
    authority: PublicKey;
    vaultId: number | bigint;
    name: string;
    legNames: string[];
    commitDurationSecs: number | bigint;
    marketDurationSecs: number | bigint;
    minTotal: Amount;
  },
): Promise<TransactionInstruction> {
  const vault = deriveVaultGroupPda(ctx.programId, p.vaultId);
  return ctx.program.methods
    .initializeVaultGroup(
      bn(p.vaultId),
      p.name,
      p.legNames,
      bn(p.commitDurationSecs),
      bn(p.marketDurationSecs),
      bn(p.minTotal),
    )
    .accountsPartial({
      authority: p.authority,
      vault,
      collateralMint: ctx.collateralMint,
      vaultCollateral: deriveVaultGroupCollateralPda(ctx.programId, vault),
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();
}

export async function buildVaultCommitGroup(
  ctx: IxContext,
  p: { signer: PublicKey; vault: PublicKey; legIndex: number; amount: Amount },
): Promise<TransactionInstruction> {
  return ctx.program.methods
    .vaultCommitGroup(p.legIndex, bn(p.amount))
    .accountsPartial({
      signer: p.signer,
      vault: p.vault,
      collateralMint: ctx.collateralMint,
      vaultCollateral: deriveVaultGroupCollateralPda(ctx.programId, p.vault),
      userCollateral: await getAssociatedTokenAddress(ctx.collateralMint, p.signer),
      commitPosition: deriveCommitGroupPositionPda(ctx.programId, p.vault, p.signer),
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

export async function buildLaunchVaultGroupMarket(
  ctx: IxContext,
  p: { payer: PublicKey; vault: PublicKey; groupId: number | bigint },
): Promise<TransactionInstruction> {
  return ctx.program.methods
    .launchVaultGroupMarket(bn(p.groupId))
    .accountsPartial({
      payer: p.payer,
      vault: p.vault,
      groupMarket: deriveGroupPda(ctx.programId, p.groupId),
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export async function buildLaunchVaultGroupLeg(
  ctx: IxContext,
  p: {
    payer: PublicKey;
    vault: PublicKey;
    group: PublicKey;
    legIndex: number;
    marketId: number | bigint;
  },
): Promise<TransactionInstruction> {
  const market = deriveMarketPda(ctx.programId, p.marketId);
  const yesMint = deriveYesMint(ctx.programId, market);
  const noMint = deriveNoMint(ctx.programId, market);
  return ctx.program.methods
    .launchVaultGroupLeg(p.legIndex, bn(p.marketId))
    .accountsPartial({
      payer: p.payer,
      vault: p.vault,
      groupMarket: p.group,
      market,
      collateralMint: ctx.collateralMint,
      yesMint,
      noMint,
      marketVault: deriveMarketVault(ctx.programId, market),
      yesMetadata: deriveMetadataPda(yesMint, ctx.metaplexProgramId),
      noMetadata: deriveMetadataPda(noMint, ctx.metaplexProgramId),
      tokenMetadataProgram: ctx.metaplexProgramId,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();
}

export async function buildClaimCommitterGroup(
  ctx: IxContext,
  p: { signer: PublicKey; vault: PublicKey; group: PublicKey; market: PublicKey; legIndex: number },
): Promise<TransactionInstruction> {
  const yesMint = deriveYesMint(ctx.programId, p.market);
  return ctx.program.methods
    .claimCommitterGroup(p.legIndex)
    .accountsPartial({
      signer: p.signer,
      vault: p.vault,
      vaultCollateral: deriveVaultGroupCollateralPda(ctx.programId, p.vault),
      collateralMint: ctx.collateralMint,
      groupMarket: p.group,
      market: p.market,
      marketVault: deriveMarketVault(ctx.programId, p.market),
      yesMint,
      userYes: await getAssociatedTokenAddress(yesMint, p.signer),
      commitPosition: deriveCommitGroupPositionPda(ctx.programId, p.vault, p.signer),
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export async function buildRefundCommitGroup(
  ctx: IxContext,
  p: { signer: PublicKey; vault: PublicKey },
): Promise<TransactionInstruction> {
  return ctx.program.methods
    .refundCommitGroup()
    .accountsPartial({
      signer: p.signer,
      vault: p.vault,
      vaultCollateral: deriveVaultGroupCollateralPda(ctx.programId, p.vault),
      collateralMint: ctx.collateralMint,
      userCollateral: await getAssociatedTokenAddress(ctx.collateralMint, p.signer),
      commitPosition: deriveCommitGroupPositionPda(ctx.programId, p.vault, p.signer),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}
