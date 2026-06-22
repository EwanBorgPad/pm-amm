/**
 * Instruction builders for the 10 binary-market instructions. Each returns a
 * composable `TransactionInstruction` (no signing). PDAs and fixed program
 * accounts are derived from the `IxContext`.
 *
 * Per-market collateral: every builder that moves collateral accepts an optional
 * `collateralMint` (defaults to `ctx.collateralMint`). A market can be denominated
 * in ANY SPL token (any decimals) — pass the market's `collateralMint` so the
 * userCollateral / fee / vault ATAs resolve against the right mint.
 */
import { PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";
import type { BN } from "@anchor-lang/core";
import { type IxContext, bn } from "./context";
import { SYSVAR_RENT_PUBKEY, PROTOCOL_DAO } from "../constants";
import {
  deriveMarketPda,
  deriveYesMint,
  deriveNoMint,
  deriveMarketVault,
  deriveLpPosition,
  deriveMetadataPda,
} from "../pda";
import { sideArg, swapDirectionArg, type Side, type SwapDirection } from "../types/args";

type Amount = BN | number | bigint;

export interface InitializeMarketParams {
  authority: PublicKey;
  marketId: number | bigint;
  /** Absolute expiry, unix seconds. */
  endTs: number | bigint;
  name: string;
  /** YES seed price in bps [100, 9900]; 0 = legacy 50/50. */
  initialPriceBps: number;
  /** Collateral mint for the new market (any SPL token). Defaults to ctx.collateralMint. */
  collateralMint?: PublicKey;
}

export async function buildInitializeMarket(
  ctx: IxContext,
  p: InitializeMarketParams,
): Promise<TransactionInstruction> {
  const market = deriveMarketPda(ctx.programId, p.marketId);
  const yesMint = deriveYesMint(ctx.programId, market);
  const noMint = deriveNoMint(ctx.programId, market);
  const collateralMint = p.collateralMint ?? ctx.collateralMint;
  return ctx.program.methods
    .initializeMarket(bn(p.marketId), bn(p.endTs), p.name, p.initialPriceBps)
    .accountsPartial({
      authority: p.authority,
      market,
      collateralMint,
      yesMint,
      noMint,
      vault: deriveMarketVault(ctx.programId, market),
      yesMetadata: deriveMetadataPda(yesMint, ctx.metaplexProgramId),
      noMetadata: deriveMetadataPda(noMint, ctx.metaplexProgramId),
      tokenMetadataProgram: ctx.metaplexProgramId,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();
}

export async function buildDepositLiquidity(
  ctx: IxContext,
  p: { signer: PublicKey; market: PublicKey; amount: Amount; collateralMint?: PublicKey },
): Promise<TransactionInstruction> {
  const collateralMint = p.collateralMint ?? ctx.collateralMint;
  const userCollateral = await getAssociatedTokenAddress(collateralMint, p.signer);
  return ctx.program.methods
    .depositLiquidity(bn(p.amount))
    .accountsPartial({
      signer: p.signer,
      market: p.market,
      collateralMint,
      vault: deriveMarketVault(ctx.programId, p.market),
      userCollateral,
      lpPosition: deriveLpPosition(ctx.programId, p.market, p.signer),
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

export async function buildSwap(
  ctx: IxContext,
  p: {
    signer: PublicKey;
    market: PublicKey;
    direction: SwapDirection;
    amountIn: Amount;
    minOutput: Amount;
    /** Market creator (= market.authority), receiver of 50% of the swap fee.
     *  Fetched from the market account when omitted. */
    creatorAuthority?: PublicKey;
    /** Market collateral mint. Defaults to ctx.collateralMint. */
    collateralMint?: PublicKey;
  },
): Promise<TransactionInstruction> {
  const yesMint = deriveYesMint(ctx.programId, p.market);
  const noMint = deriveNoMint(ctx.programId, p.market);
  const collateralMint = p.collateralMint ?? ctx.collateralMint;
  const authority =
    p.creatorAuthority ??
    ((await ctx.program.account.market.fetch(p.market)).authority as PublicKey);
  // The swapper keeps their own fee share when they ARE the creator → pass
  // `creatorUsdc = null` (optional account) to avoid a duplicate-mutable error
  // with `userCollateral`. The DAO key is off-curve → allowOwnerOffCurve.
  const creatorUsdc = authority.equals(p.signer)
    ? null
    : await getAssociatedTokenAddress(collateralMint, authority, true);
  return ctx.program.methods
    .swap(swapDirectionArg(p.direction), bn(p.amountIn), bn(p.minOutput))
    .accountsPartial({
      signer: p.signer,
      market: p.market,
      collateralMint,
      yesMint,
      noMint,
      vault: deriveMarketVault(ctx.programId, p.market),
      userCollateral: await getAssociatedTokenAddress(collateralMint, p.signer),
      userYes: await getAssociatedTokenAddress(yesMint, p.signer),
      userNo: await getAssociatedTokenAddress(noMint, p.signer),
      daoUsdc: await getAssociatedTokenAddress(collateralMint, PROTOCOL_DAO, true),
      creatorUsdc,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

export async function buildWithdrawLiquidity(
  ctx: IxContext,
  p: { signer: PublicKey; market: PublicKey; sharesToBurn: Amount; collateralMint?: PublicKey },
): Promise<TransactionInstruction> {
  const yesMint = deriveYesMint(ctx.programId, p.market);
  const noMint = deriveNoMint(ctx.programId, p.market);
  return ctx.program.methods
    .withdrawLiquidity(bn(p.sharesToBurn))
    .accountsPartial({
      signer: p.signer,
      market: p.market,
      collateralMint: p.collateralMint ?? ctx.collateralMint,
      yesMint,
      noMint,
      lpPosition: deriveLpPosition(ctx.programId, p.market, p.signer),
      userYes: await getAssociatedTokenAddress(yesMint, p.signer),
      userNo: await getAssociatedTokenAddress(noMint, p.signer),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

export async function buildAccrue(
  ctx: IxContext,
  p: { market: PublicKey },
): Promise<TransactionInstruction> {
  return ctx.program.methods.accrue().accountsPartial({ market: p.market }).instruction();
}

export async function buildClaimLpResiduals(
  ctx: IxContext,
  p: { signer: PublicKey; market: PublicKey },
): Promise<TransactionInstruction> {
  const yesMint = deriveYesMint(ctx.programId, p.market);
  const noMint = deriveNoMint(ctx.programId, p.market);
  return ctx.program.methods
    .claimLpResiduals()
    .accountsPartial({
      signer: p.signer,
      market: p.market,
      yesMint,
      noMint,
      lpPosition: deriveLpPosition(ctx.programId, p.market, p.signer),
      userYes: await getAssociatedTokenAddress(yesMint, p.signer),
      userNo: await getAssociatedTokenAddress(noMint, p.signer),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

export async function buildRedeemPair(
  ctx: IxContext,
  p: { signer: PublicKey; market: PublicKey; amount: Amount; collateralMint?: PublicKey },
): Promise<TransactionInstruction> {
  const yesMint = deriveYesMint(ctx.programId, p.market);
  const noMint = deriveNoMint(ctx.programId, p.market);
  const collateralMint = p.collateralMint ?? ctx.collateralMint;
  return ctx.program.methods
    .redeemPair(bn(p.amount))
    .accountsPartial({
      signer: p.signer,
      market: p.market,
      collateralMint,
      yesMint,
      noMint,
      vault: deriveMarketVault(ctx.programId, p.market),
      userYes: await getAssociatedTokenAddress(yesMint, p.signer),
      userNo: await getAssociatedTokenAddress(noMint, p.signer),
      userCollateral: await getAssociatedTokenAddress(collateralMint, p.signer),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

export async function buildSuggestLZero(
  ctx: IxContext,
  p: { market: PublicKey; budgetUsdc: Amount; sigmaBps: Amount },
): Promise<TransactionInstruction> {
  return ctx.program.methods
    .suggestLZero(bn(p.budgetUsdc), bn(p.sigmaBps))
    .accountsPartial({ market: p.market })
    .instruction();
}

export async function buildResolveMarket(
  ctx: IxContext,
  p: { signer: PublicKey; market: PublicKey; side: Side },
): Promise<TransactionInstruction> {
  return ctx.program.methods
    .resolveMarket(sideArg(p.side))
    .accountsPartial({ signer: p.signer, market: p.market })
    .instruction();
}

export async function buildClaimWinnings(
  ctx: IxContext,
  p: { signer: PublicKey; market: PublicKey; amount?: Amount; collateralMint?: PublicKey },
): Promise<TransactionInstruction> {
  const yesMint = deriveYesMint(ctx.programId, p.market);
  const noMint = deriveNoMint(ctx.programId, p.market);
  const collateralMint = p.collateralMint ?? ctx.collateralMint;
  // `amount` is ignored on-chain (claim settles everything) — default to 1.
  return ctx.program.methods
    .claimWinnings(bn(p.amount ?? 1))
    .accountsPartial({
      signer: p.signer,
      market: p.market,
      collateralMint,
      yesMint,
      noMint,
      vault: deriveMarketVault(ctx.programId, p.market),
      userYes: await getAssociatedTokenAddress(yesMint, p.signer),
      userNo: await getAssociatedTokenAddress(noMint, p.signer),
      userCollateral: await getAssociatedTokenAddress(collateralMint, p.signer),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}
