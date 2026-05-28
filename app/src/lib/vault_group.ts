/**
 * Client helpers for the Multi-outcome Commitment Vault (Sprint 23).
 *
 * Wraps the 6 vault_group instructions into TS entry points. The launch flow
 * is split into 1 setup tx (`runLaunchVaultGroupMarket`) + N leg txs
 * (`runLaunchVaultGroupLeg`) so the per-tx compute budget stays under cap.
 */

/* eslint-disable @typescript-eslint/no-explicit-any --
 * Write-path Anchor CPI builders use `(program.methods as any)` because the
 * generated IDL TS types lag the on-chain struct between `anchor build` runs.
 */

import { ComputeBudgetProgram, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { BN } from "@anchor-lang/core";
import { METAPLEX_PROGRAM_ID, USDC_MINT } from "@/lib/constants";
import {
  deriveGroupPda,
  deriveMarketPda,
  deriveNoMint,
  deriveVault,
  deriveYesMint,
} from "@/lib/pda";

type AnchorProgram = any;

const VAULT_GROUP_SEED = Buffer.from("vault_group");
const VAULT_GROUP_COLLATERAL_SEED = Buffer.from("vault_group_collateral");
const COMMIT_GROUP_SEED = Buffer.from("commit_group");

function programId(program: AnchorProgram): PublicKey {
  return new PublicKey(program.idl.address);
}

export function deriveVaultGroupPda(vaultId: number, program: AnchorProgram): PublicKey {
  const idBuf = new BN(vaultId).toArrayLike(Buffer, "le", 8);
  return PublicKey.findProgramAddressSync([VAULT_GROUP_SEED, idBuf], programId(program))[0];
}

export function deriveVaultGroupCollateralPda(vault: PublicKey, program: AnchorProgram): PublicKey {
  return PublicKey.findProgramAddressSync(
    [VAULT_GROUP_COLLATERAL_SEED, vault.toBuffer()],
    programId(program),
  )[0];
}

export function deriveCommitGroupPositionPda(
  vault: PublicKey,
  owner: PublicKey,
  program: AnchorProgram,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [COMMIT_GROUP_SEED, vault.toBuffer(), owner.toBuffer()],
    programId(program),
  )[0];
}

function deriveMetadataPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METAPLEX_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METAPLEX_PROGRAM_ID,
  )[0];
}

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

export interface CreateVaultGroupInput {
  name: string;
  legNames: string[]; // 2..8
  commitDurationSecs: number;
  marketDurationSecs: number;
  minTotalUsdc: number;
}

export async function runCreateVaultGroup(
  program: AnchorProgram,
  wallet: PublicKey,
  input: CreateVaultGroupInput,
): Promise<{ vaultId: number; vaultPda: string }> {
  if (input.legNames.length < 2 || input.legNames.length > 8) {
    throw new Error("legNames must contain 2 to 8 entries");
  }

  const vaultId = randomU48();
  const vault = deriveVaultGroupPda(vaultId, program);
  const vaultCollateral = deriveVaultGroupCollateralPda(vault, program);

  await program.methods
    .initializeVaultGroup(
      new BN(vaultId),
      input.name,
      input.legNames,
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

export async function runVaultCommitGroup(
  program: AnchorProgram,
  wallet: PublicKey,
  vaultPda: PublicKey,
  legIndex: number,
  amountUsdc: number,
): Promise<void> {
  const vaultCollateral = deriveVaultGroupCollateralPda(vaultPda, program);
  const userCollateral = await getAssociatedTokenAddress(USDC_MINT, wallet);
  const commitPosition = deriveCommitGroupPositionPda(vaultPda, wallet, program);

  const preIxs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })];
  const ataInfo = await program.provider.connection.getAccountInfo(userCollateral);
  if (!ataInfo) {
    preIxs.push(createAssociatedTokenAccountInstruction(wallet, userCollateral, wallet, USDC_MINT));
  }

  await program.methods
    .vaultCommitGroup(legIndex, new BN(Math.floor(amountUsdc * 1e6)))
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

/** Step 1 of launch: create the wrapping GroupMarket. */
export async function runLaunchVaultGroupMarket(
  program: AnchorProgram,
  wallet: PublicKey,
  vaultPda: PublicKey,
): Promise<{ groupId: number; groupPda: string }> {
  const groupId = randomU48();
  const groupPda = deriveGroupPda(groupId);

  await program.methods
    .launchVaultGroupMarket(new BN(groupId))
    .accountsPartial({
      payer: wallet,
      vault: vaultPda,
      groupMarket: groupPda,
      systemProgram: SystemProgram.programId,
    })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
    .rpc();

  return { groupId, groupPda: groupPda.toBase58() };
}

/** Step 2 of launch: create one leg market + attach to group. */
export async function runLaunchVaultGroupLeg(
  program: AnchorProgram,
  wallet: PublicKey,
  vaultPda: PublicKey,
  groupPda: PublicKey,
  legIndex: number,
): Promise<{ marketId: number; marketPda: string }> {
  const marketId = randomU48();
  const marketPda = deriveMarketPda(marketId);
  const yesMint = deriveYesMint(marketPda);
  const noMint = deriveNoMint(marketPda);
  const marketVault = deriveVault(marketPda);
  const yesMetadata = deriveMetadataPda(yesMint);
  const noMetadata = deriveMetadataPda(noMint);

  await program.methods
    .launchVaultGroupLeg(legIndex, new BN(marketId))
    .accountsPartial({
      payer: wallet,
      vault: vaultPda,
      groupMarket: groupPda,
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

export async function runClaimCommitterGroup(
  program: AnchorProgram,
  wallet: PublicKey,
  vaultPda: PublicKey,
): Promise<void> {
  const vaultCollateral = deriveVaultGroupCollateralPda(vaultPda, program);
  const userCollateral = await getAssociatedTokenAddress(USDC_MINT, wallet);
  const commitPosition = deriveCommitGroupPositionPda(vaultPda, wallet, program);

  const preIxs: ReturnType<typeof ComputeBudgetProgram.setComputeUnitLimit>[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
  ];
  const ataInfo = await program.provider.connection.getAccountInfo(userCollateral);
  if (!ataInfo) {
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(wallet, userCollateral, wallet, USDC_MINT),
    );
    await program.provider.sendAndConfirm(tx, []);
  }

  await program.methods
    .claimCommitterGroup()
    .accountsPartial({
      signer: wallet,
      vault: vaultPda,
      vaultCollateral,
      collateralMint: USDC_MINT,
      userCollateral,
      commitPosition,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions(preIxs)
    .rpc();
}

export async function runRefundCommitGroup(
  program: AnchorProgram,
  wallet: PublicKey,
  vaultPda: PublicKey,
): Promise<void> {
  const vaultCollateral = deriveVaultGroupCollateralPda(vaultPda, program);
  const userCollateral = await getAssociatedTokenAddress(USDC_MINT, wallet);
  const commitPosition = deriveCommitGroupPositionPda(vaultPda, wallet, program);

  await program.methods
    .refundCommitGroup()
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
