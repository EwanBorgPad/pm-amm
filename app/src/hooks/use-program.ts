"use client";

import { useMemo } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, Program } from "@anchor-lang/core";
import idl from "@/lib/pm_amm_idl.json";
import { PROGRAM_ID } from "@/lib/constants";

/**
 * Wallet-aware Anchor program for tx-building (signing). For read-only
 * queries (account fetchers) prefer `getReadOnlyProgram(connection)` from
 * `@/lib/program` — it returns a typed `accounts` namespace instead of an
 * `as any`-cast surface.
 *
 * The IDL `address` is overridden at construction time with PROGRAM_ID from
 * constants.ts (env-driven), because the JSON ships with the localnet
 * program ID. Without the override, every instruction would target the
 * wrong program on devnet.
 */
export function useProgram() {
  const { connection } = useConnection();
  const wallet = useWallet();

  return useMemo(() => {
    if (!wallet.publicKey) return null;
    // Anchor's `Program` ctor takes the IDL + a Provider with a Wallet for
    // signing. Both shapes are loose at the type boundary; the wallet
    // adapter's interface is a structural superset of what Anchor needs.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const provider = new AnchorProvider(connection, wallet as any, {
      commitment: "confirmed",
    });
    const idlForCluster = { ...idl, address: PROGRAM_ID.toBase58() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new Program(idlForCluster as any, provider);
  }, [connection, wallet]);
}
