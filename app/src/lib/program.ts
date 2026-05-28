/**
 * Centralized Anchor program access for the frontend.
 *
 * The generated target/types/pm_amm.ts (Anchor 1.0) gets stale whenever the
 * on-chain struct changes and `anchor build` hasn't been re-run with IDL gen.
 * Rather than scatter `as any` casts across hooks and libs, this module
 * exports:
 *
 *   - `getReadOnlyProgram(connection)` for read-only queries (no wallet)
 *   - typed `MarketAccount` / `GroupMarketAccount` / `LpPositionAccount`
 *     interfaces that match the JSON IDL bundled at `pm_amm_idl.json`
 *   - typed `AccountNamespace<T>` and `MethodsNamespace` helpers
 *
 * Callers should use these instead of `(program as any).methods.xxx`. When
 * the on-chain struct changes, update the types here in ONE place.
 */

import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { Program, BN } from "@anchor-lang/core";
import idl from "@/lib/pm_amm_idl.json";
import { PROGRAM_ID } from "@/lib/constants";

// ----------------------------------------------------------------------------
// Account shapes — keep aligned with anchor/programs/pm_amm/src/state.rs
// ----------------------------------------------------------------------------

/** Anchor returns u128/i128/i64/u64 as bn.js instances and Pubkey as PublicKey. */
type Bn = BN;
type Pk = PublicKey;

export interface MarketAccount {
  authority: Pk;
  marketId: Bn;
  collateralMint: Pk;
  yesMint: Pk;
  noMint: Pk;
  vault: Pk;
  startTs: Bn;
  endTs: Bn;
  lZero: Bn;
  reserveYes: Bn;
  reserveNo: Bn;
  lastAccrualTs: Bn;
  cumYesPerShare: Bn;
  cumNoPerShare: Bn;
  totalYesDistributed: Bn;
  totalNoDistributed: Bn;
  totalLpShares: Bn;
  resolved: boolean;
  winningSide: number;
  bump: number;
  name: number[];
  /** EXTENSION: seed price in bps. 0 = legacy 50/50. */
  initialPriceBps: number;
  /** EXTENSION: GroupMarket PDA this leg is attached to (default = standalone). */
  group: Pk;
}

export interface GroupMarketAccount {
  authority: Pk;
  groupId: Bn;
  startTs: Bn;
  endTs: Bn;
  legCount: number;
  legs: Pk[];
  resolved: boolean;
  /** 0xFF until resolved, else index of the winning leg. */
  winningLeg: number;
  bump: number;
  name: number[];
  /** Cumulative seeded bps across attached legs (Σ p_i × 10_000). */
  totalSeededBps: number;
}

export interface LpPositionAccount {
  owner: Pk;
  market: Pk;
  shares: Bn;
  collateralDeposited: Bn;
  yesPerShareCheckpoint: Bn;
  noPerShareCheckpoint: Bn;
  bump: number;
}

export interface CommitmentVaultGroupAccount {
  authority: Pk;
  vaultId: Bn;
  collateralMint: Pk;
  name: number[];
  legCount: number;
  /** Per-leg label, [u8; 32] zero-padded. */
  legNames: number[][];
  /** Per-leg committed USDC totals (raw u64, 6 decimals). */
  legTotals: Bn[];
  commitEndTs: Bn;
  marketEndTs: Bn;
  commitCount: number;
  minTotal: Bn;
  groupMarketInitialized: boolean;
  legsLaunched: number;
  groupMarket: Pk;
  bump: number;
}

export interface CommitPositionGroupAccount {
  vault: Pk;
  owner: Pk;
  legAmounts: Bn[];
  claimed: boolean;
  bump: number;
}

// ----------------------------------------------------------------------------
// Account namespace shapes — Anchor's typed surface for `program.account.<x>`
// ----------------------------------------------------------------------------

interface AccountFetcher<T> {
  fetch(address: Pk): Promise<T>;
  all(filters?: { dataSize: number }[]): Promise<{ publicKey: Pk; account: T }[]>;
}

export interface ProgramAccountNamespace {
  market: AccountFetcher<MarketAccount>;
  groupMarket: AccountFetcher<GroupMarketAccount>;
  lpPosition: AccountFetcher<LpPositionAccount>;
  commitmentVaultGroup: AccountFetcher<CommitmentVaultGroupAccount>;
  commitPositionGroup: AccountFetcher<CommitPositionGroupAccount>;
}

// ----------------------------------------------------------------------------
// Program factory
// ----------------------------------------------------------------------------

interface ReadOnlyProvider {
  connection: Connection;
}

/**
 * Read-only program for queries that don't sign — fetching markets, groups,
 * LP positions, account decode. For tx-building, prefer the wallet-aware
 * Program instance (via @solana/wallet-adapter + AnchorProvider).
 *
 * Two casts live here, not at every call site:
 *   1. `idl as any` — Anchor's `Program` ctor expects its IDL type generated
 *      by `anchor build`; the JSON we ship here is structurally compatible
 *      but typed as `unknown` after JSON import.
 *   2. `provider as any` — `Program` accepts an `AnchorProvider` which
 *      carries a wallet for signing. Read-only callers pass `{ connection }`
 *      only; methods that touch `provider.wallet` would throw, but they're
 *      never called from this entry point (account fetchers only).
 *   3. `as unknown as ProgramAccountNamespace` — the runtime shape of
 *      `program.account` matches our typed namespace 1:1 via the IDL's
 *      `accounts` array. If a field is renamed in `state.rs`, the cast
 *      stays valid at runtime but typed call sites break — which is the
 *      desired failure mode.
 */
export function getReadOnlyProgram(connection: Connection) {
  const provider: ReadOnlyProvider = { connection };
  // Override the IDL's hard-coded `address` with the env-driven PROGRAM_ID
  // from constants.ts. The two can diverge — the JSON ships with the
  // localnet program ID (`anchor build` writes whatever is in
  // `lib.rs::declare_id!`), but the frontend runs against devnet by default.
  // Without this override, `program.account.<x>.all()` would filter by the
  // wrong owner and silently return zero accounts.
  const idlForCluster = { ...idl, address: PROGRAM_ID.toBase58() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const program = new Program(idlForCluster as any, provider as any);
  return {
    program,
    accounts: program.account as unknown as ProgramAccountNamespace,
  };
}

/** Decode a fixed-size `[u8; 64]` name field into UTF-8, stripping trailing zeros. */
export function decodeName(nameBytes: number[] | undefined): string {
  const arr = nameBytes ?? [];
  const end = arr.indexOf(0);
  return new TextDecoder().decode(new Uint8Array(end >= 0 ? arr.slice(0, end) : arr));
}
