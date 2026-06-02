/**
 * Deployment-independent constants for the pm-AMM program.
 *
 * NOTE: the program id and collateral (USDC) mint are NOT here — they are
 * per-deployment and supplied to `PmAmmClient`. The SDK never reads env vars.
 */
import { PublicKey } from "@solana/web3.js";

/** Metaplex Token Metadata program — fixed across clusters. */
export const METAPLEX_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

/** Rent sysvar (still required by a few `init` instructions). */
export const SYSVAR_RENT_PUBKEY = new PublicKey("SysvarRent111111111111111111111111111111111");

/**
 * Compute-unit budgets used as preinstructions by the `send.*` helpers.
 * Mutative instructions target 400k CU; the market-init / launch / swap paths
 * touch many accounts (mints, vault, metadata CPI) and use the heavier budget.
 */
export const CU = {
  DEFAULT: 400_000,
  HEAVY: 1_400_000,
} as const;

/** PDA seed strings — must match `anchor/programs/pm_amm/src/state.rs` + instructions. */
export const SEEDS = {
  MARKET: "market",
  YES_MINT: "yes_mint",
  NO_MINT: "no_mint",
  /** Used for BOTH the per-market collateral vault (["vault", market]) and the
   *  commitment-vault account (["vault", u64(vaultId)]). */
  VAULT: "vault",
  LP: "lp",
  GROUP: "group",
  VAULT_COLLATERAL: "vault_collateral",
  COMMIT: "commit",
  VAULT_GROUP: "vault_group",
  VAULT_GROUP_COLLATERAL: "vault_group_collateral",
  COMMIT_GROUP: "commit_group",
  METADATA: "metadata",
} as const;

export type Cluster = "mainnet-beta" | "devnet" | "testnet" | "localnet";

function clusterQuery(cluster: Cluster): string {
  return cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
}

export function solscanTxUrl(signature: string, cluster: Cluster = "devnet"): string {
  return `https://solscan.io/tx/${signature}${clusterQuery(cluster)}`;
}

export function solscanAccountUrl(address: string, cluster: Cluster = "devnet"): string {
  return `https://solscan.io/account/${address}${clusterQuery(cluster)}`;
}
