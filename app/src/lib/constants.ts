import { PublicKey } from "@solana/web3.js";

// Program ID: the same across clusters (declare_id! is compiled into the .so).
// Override via NEXT_PUBLIC_PROGRAM_ID when running against another deploy.
export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID || "GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y",
);

// Canonical mainnet USDC (Circle, 6 decimals). Set NEXT_PUBLIC_USDC_MINT to this
// on mainnet. The default below is the devnet MOCK USDC (also 6 decimals, so no
// decimal handling changes between clusters).
export const MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT || "3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ",
);

export const METAPLEX_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

export type Cluster = "mainnet-beta" | "devnet" | "localnet";

export const CLUSTER = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER as Cluster) || "devnet";

/** True on mainnet-beta — gates the faucet and other devnet-only affordances. */
export const IS_MAINNET = CLUSTER === "mainnet-beta";

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ||
  (IS_MAINNET
    ? "https://api.mainnet-beta.solana.com"
    : CLUSTER === "devnet"
      ? "https://api.devnet.solana.com"
      : "http://localhost:8899");

// solscan treats mainnet as the default (no cluster query string); devnet and
// localnet require the explicit `?cluster=` param.
function clusterQuery(): string {
  return IS_MAINNET ? "" : `?cluster=${CLUSTER}`;
}

export function solscanTxUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}${clusterQuery()}`;
}

export function solscanAccountUrl(address: string): string {
  return `https://solscan.io/account/${address}${clusterQuery()}`;
}
