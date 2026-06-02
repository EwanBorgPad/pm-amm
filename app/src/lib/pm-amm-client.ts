"use client";

/**
 * Frontend glue around `@pm-amm/sdk`'s `PmAmmClient`. This is the ONLY place
 * the app turns env config (program id, USDC mint) into an SDK client — every
 * hook / component / lib adapter goes through here, so the SDK is the single
 * source of truth for on-chain logic.
 */
import { useMemo } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { Connection } from "@solana/web3.js";
import { AnchorProvider, type Program } from "@anchor-lang/core";
import { PmAmmClient } from "@pm-amm/sdk";
import { PROGRAM_ID, USDC_MINT } from "@/lib/constants";

/** Read-only client for queries (no wallet). */
export function getClient(connection: Connection): PmAmmClient {
  return PmAmmClient.readOnly(connection, PROGRAM_ID, USDC_MINT);
}

/** Wallet-aware client for signing. Null until a wallet is connected. */
export function useClient(): PmAmmClient | null {
  const { connection } = useConnection();
  const wallet = useWallet();
  return useMemo(() => {
    if (!wallet.publicKey) return null;
    // The wallet-adapter shape is a structural superset of Anchor's Wallet.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const provider = new AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
    return PmAmmClient.fromProvider(provider, PROGRAM_ID, USDC_MINT);
  }, [connection, wallet]);
}

/**
 * Build a client from an existing wallet-aware `Program` (used by the `lib/*`
 * flow adapters that still receive a `program` from the old `useProgram()`
 * surface). The program's provider carries the wallet.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function clientFromProgram(program: Program<any>): PmAmmClient {
  return PmAmmClient.fromProvider(program.provider as AnchorProvider, PROGRAM_ID, USDC_MINT);
}
