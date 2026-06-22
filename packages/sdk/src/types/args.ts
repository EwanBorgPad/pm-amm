/**
 * Argument types for instruction builders / send helpers, plus converters from
 * friendly string unions to the Anchor enum object form (`{ yes: {} }`).
 */
import type { PublicKey } from "@solana/web3.js";

/** A binary market side. */
export type Side = "yes" | "no";

/** One of the 6 swap directions supported by the pm-AMM `swap` instruction. */
export type SwapDirection =
  | "usdcToYes"
  | "usdcToNo"
  | "yesToUsdc"
  | "noToUsdc"
  | "yesToNo"
  | "noToYes";

/** Anchor enum form for `Side`. */
export function sideArg(side: Side): Record<string, Record<string, never>> {
  return { [side]: {} };
}

/** Anchor enum form for `SwapDirection`. */
export function swapDirectionArg(dir: SwapDirection): Record<string, Record<string, never>> {
  return { [dir]: {} };
}

// ----------------------------------------------------------------------------
// High-level inputs (send / flows)
// ----------------------------------------------------------------------------

export interface CreateMarketInput {
  /** Market question / name (1–64 bytes UTF-8). */
  name: string;
  /** Market lifetime in seconds (used to compute `end_ts = now + durationSecs`). */
  durationSecs: number;
  /** YES seed price in bps [100, 9900]; omit / 0 = legacy 50/50. */
  initialPriceBps?: number;
  /** Optional first liquidity deposit (collateral, human units) bundled in the same tx. */
  depositUsdc?: number;
  /** Collateral mint for the market (any SPL token). Defaults to the client's collateral. */
  collateralMint?: PublicKey;
}

export interface CreateVaultInput {
  name: string;
  commitDurationSecs: number;
  marketDurationSecs: number;
  /** Minimum total USDC (human units) required to launch. */
  minTotalUsdc: number;
}

export interface CreateVaultGroupInput {
  name: string;
  /** 2–8 leg labels (each 1–32 bytes). */
  legNames: string[];
  commitDurationSecs: number;
  marketDurationSecs: number;
  minTotalUsdc: number;
}

export interface GroupCreateInput {
  name: string;
  /** 2–32 leg names. */
  legNames: string[];
  durationSecs: number;
  /** USDC (human units) of bootstrap liquidity per leg. */
  budgetPerLegUsdc: number;
}
