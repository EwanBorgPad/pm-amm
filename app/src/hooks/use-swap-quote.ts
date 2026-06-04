"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  ComputeBudgetProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { USDC_MINT } from "@/lib/constants";
import { getClient } from "@/lib/pm-amm-client";
import { estimateSwapOutput } from "@pm-amm/sdk/math";
import type { SwapDirection } from "@pm-amm/sdk";
import { PROTOCOL_DAO, SWAP_FEE_BPS } from "@pm-amm/sdk";

export type SwapMode = "buy" | "sell";

export interface SwapQuote {
  output: number;
  error: string | null;
  estimated?: boolean;
}

interface MarketReserves {
  reserveYes: number;
  reserveNo: number;
  lEff: number;
}

/**
 * Swap quote: tries on-chain simulation first, falls back to client-side math.
 * Client-side uses the same pm-AMM formulas (float64 port of on-chain I80F48).
 */
export function useSwapQuote(
  marketPda: string | undefined,
  side: "yes" | "no",
  mode: SwapMode,
  amount: number,
  reserves?: MarketReserves,
) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();

  return useQuery<SwapQuote | null>({
    queryKey: ["swap-quote", marketPda, side, mode, amount],
    queryFn: async () => {
      if (!publicKey || !marketPda || amount <= 0) return null;

      // Try on-chain simulation first
      const onChain = await tryOnChainQuote(connection, publicKey, marketPda, side, mode, amount);
      if (onChain) return onChain;

      // Fallback: client-side estimation using pm-AMM math
      if (reserves && reserves.lEff > 0) {
        return clientSideQuote(reserves, side, mode, amount);
      }

      return { output: 0, error: null };
    },
    enabled: !!publicKey && !!marketPda && amount > 0,
    staleTime: 10_000,
    retry: false,
  });
}

/** Client-side quote using the same pm-AMM formulas (float64). */
function clientSideQuote(
  reserves: MarketReserves,
  side: "yes" | "no",
  mode: SwapMode,
  amount: number,
): SwapQuote {
  const lamports = mode === "buy" ? Math.floor(amount * 1e6) : Math.floor(amount);
  // 2% protocol fee on the USDC leg: skimmed off the INPUT on a buy (only the
  // net trades the curve) and off the OUTPUT on a sell. Must match the program
  // so the slippage `minOutput` derived from this quote isn't over-stated.
  const netNum = 10_000 - SWAP_FEE_BPS;
  if (mode === "sell") {
    // Sell YES/NO → USDC: mirror the buy math with reversed sides
    const sellSide = side === "yes" ? "no" : "yes";
    const est = estimateSwapOutput(
      reserves.reserveYes,
      reserves.reserveNo,
      reserves.lEff,
      lamports,
      sellSide,
    );
    // Output is USDC (reserves freed by removing tokens) minus the 2% fee.
    const net = Math.floor((est.output * netNum) / 10_000);
    return { output: Math.max(0, net), error: null, estimated: true };
  }
  // Buy: only the post-fee USDC trades on the curve.
  const netIn = Math.floor((lamports * netNum) / 10_000);
  const est = estimateSwapOutput(
    reserves.reserveYes,
    reserves.reserveNo,
    reserves.lEff,
    netIn,
    side,
  );
  return { output: Math.max(0, Math.floor(est.output)), error: null, estimated: true };
}

/** Try on-chain simulation. Returns null if simulation can't run. */
async function tryOnChainQuote(
  connection: ReturnType<typeof useConnection>["connection"],
  publicKey: PublicKey,
  marketPda: string,
  side: "yes" | "no",
  mode: SwapMode,
  amount: number,
): Promise<SwapQuote | null> {
  try {
    const market = new PublicKey(marketPda);
    const client = getClient(connection);
    const yesMint = client.yesMint(market);
    const noMint = client.noMint(market);

    const userUsdc = await getAssociatedTokenAddress(USDC_MINT, publicKey);
    const userYes = await getAssociatedTokenAddress(yesMint, publicKey);
    const userNo = await getAssociatedTokenAddress(noMint, publicKey);

    const outputAta = mode === "buy" ? (side === "yes" ? userYes : userNo) : userUsdc;

    // Check which ATAs need creation
    const { createAssociatedTokenAccountInstruction } = await import("@solana/spl-token");
    const ataIxs: TransactionInstruction[] = [];
    for (const { ata, mint } of [
      { ata: userUsdc, mint: USDC_MINT },
      { ata: userYes, mint: yesMint },
      { ata: userNo, mint: noMint },
    ]) {
      const info = await connection.getAccountInfo(ata);
      if (!info) {
        ataIxs.push(createAssociatedTokenAccountInstruction(publicKey, ata, publicKey, mint));
      }
    }
    // Include the DAO fee ATA (off-curve owner) so the sim doesn't fail on a
    // missing required account. We quote with creatorUsdc=null (signer treated
    // as creator) — the output is identical either way, and it avoids a market
    // fetch + a possibly-missing creator ATA on every keystroke.
    const daoUsdc = await getAssociatedTokenAddress(USDC_MINT, PROTOCOL_DAO, true);
    if (!(await connection.getAccountInfo(daoUsdc))) {
      ataIxs.push(
        createAssociatedTokenAccountInstruction(publicKey, daoUsdc, PROTOCOL_DAO, USDC_MINT),
      );
    }

    // Pre-balance
    let preBal = 0;
    try {
      const info = await connection.getAccountInfo(outputAta);
      if (info && info.data.length >= 72) {
        const view = new DataView(info.data.buffer, info.data.byteOffset);
        preBal = Number(view.getBigUint64(64, true));
      }
    } catch {
      /* ATA doesn't exist yet */
    }

    const direction: SwapDirection =
      mode === "buy"
        ? side === "yes"
          ? "usdcToYes"
          : "usdcToNo"
        : side === "yes"
          ? "yesToUsdc"
          : "noToUsdc";

    const lamports = mode === "buy" ? Math.floor(amount * 1e6) : Math.floor(amount);

    const ix = await client.ix.swap({
      signer: publicKey,
      market,
      direction,
      amountIn: lamports,
      minOutput: 0,
      creatorAuthority: publicKey, // quote with creatorUsdc=null (output is identical)
    });

    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ...ataIxs,
      ix,
    );
    tx.feePayer = publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    const sim = await connection.simulateTransaction(tx, undefined, [outputAta]);

    if (sim.value.err) {
      // Simulation failed (no SOL for ATA rent, account missing, etc.)
      // Return null so caller falls back to client-side
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const postAccounts = (sim.value as any).accounts;
    if (postAccounts?.[0]?.data) {
      const buf = Uint8Array.from(atob(postAccounts[0].data[0]), (c) => c.charCodeAt(0));
      const view = new DataView(buf.buffer);
      const postBal = Number(view.getBigUint64(64, true));
      return { output: postBal - preBal, error: null };
    }

    return null;
  } catch {
    return null;
  }
}
