"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  ComputeBudgetProgram,
  Transaction,
  type TransactionInstruction,
  type Connection,
} from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { USDC_MINT } from "@/lib/constants";
import { getClient } from "@/lib/pm-amm-client";
import type { PmAmmClient, SwapDirection } from "@pm-amm/sdk";
import type { UserTokens } from "@/hooks/use-user-tokens";

export interface PositionValue {
  yesValueUsdc: number; // lamports of USDC you'd get selling all YES
  noValueUsdc: number; // lamports of USDC you'd get selling all NO
  totalUsdc: number; // total position value in USDC lamports
  error: string | null;
}

/** Simulate selling all YES and NO tokens to get exact USDC value from the program. */
export function usePositionValue(marketPda: string | undefined, tokens: UserTokens | null) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();

  const yesAmount = tokens?.yes ?? 0;
  const noAmount = tokens?.no ?? 0;

  return useQuery<PositionValue | null>({
    queryKey: ["position-value", marketPda, yesAmount, noAmount],
    queryFn: async () => {
      if (!publicKey || !marketPda) return null;
      if (yesAmount <= 0 && noAmount <= 0) return null;

      try {
        const market = new PublicKey(marketPda);
        const client = getClient(connection);

        const yesMint = client.yesMint(market);
        const noMint = client.noMint(market);

        const userUsdc = await getAssociatedTokenAddress(USDC_MINT, publicKey);
        const userYes = await getAssociatedTokenAddress(yesMint, publicKey);
        const userNo = await getAssociatedTokenAddress(noMint, publicKey);

        // Ensure ATAs exist for simulation
        const { createAssociatedTokenAccountInstruction } = await import("@solana/spl-token");
        const ataIxs: TransactionInstruction[] = [];
        const atas = [
          { ata: userUsdc, mint: USDC_MINT },
          { ata: userYes, mint: yesMint },
          { ata: userNo, mint: noMint },
        ];
        for (const { ata, mint } of atas) {
          const info = await connection.getAccountInfo(ata);
          if (!info) {
            ataIxs.push(createAssociatedTokenAccountInstruction(publicKey, ata, publicKey, mint));
          }
        }

        let yesValueUsdc = 0;
        let noValueUsdc = 0;

        // Simulate selling YES tokens
        if (yesAmount > 0) {
          yesValueUsdc = await simulateSell(
            client,
            connection,
            publicKey,
            "yesToUsdc",
            yesAmount,
            market,
            ataIxs,
            userUsdc,
          );
        }

        // Simulate selling NO tokens
        if (noAmount > 0) {
          noValueUsdc = await simulateSell(
            client,
            connection,
            publicKey,
            "noToUsdc",
            noAmount,
            market,
            ataIxs,
            userUsdc,
          );
        }

        return {
          yesValueUsdc,
          noValueUsdc,
          totalUsdc: yesValueUsdc + noValueUsdc,
          error: null,
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          yesValueUsdc: 0,
          noValueUsdc: 0,
          totalUsdc: 0,
          error: msg.slice(0, 80) || "Unknown error",
        };
      }
    },
    enabled: !!publicKey && !!marketPda && (yesAmount > 0 || noAmount > 0),
    staleTime: 10_000,
    retry: false,
  });
}

async function simulateSell(
  client: PmAmmClient,
  connection: Connection,
  publicKey: PublicKey,
  direction: SwapDirection,
  amount: number,
  market: PublicKey,
  ataIxs: TransactionInstruction[],
  outputAta: PublicKey,
): Promise<number> {
  // Get pre-balance of USDC ATA
  let preBal = 0;
  try {
    const info = await connection.getAccountInfo(outputAta);
    if (info && info.data.length >= 72) {
      const view = new DataView(info.data.buffer, info.data.byteOffset);
      preBal = Number(view.getBigUint64(64, true));
    }
  } catch {
    /* ATA doesn't exist */
  }

  const ix = await client.ix.swap({
    signer: publicKey,
    market,
    direction,
    amountIn: amount,
    minOutput: 0,
  });

  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ...ataIxs,
    ix,
  );
  tx.feePayer = publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  const sim = await connection.simulateTransaction(tx, undefined, [outputAta]);

  if (sim.value.err) return 0;

  // Read post-balance from simulated accounts
  const postAccounts = sim.value.accounts;
  if (postAccounts?.[0]?.data) {
    const buf = Uint8Array.from(atob(postAccounts[0].data[0]), (c) => c.charCodeAt(0));
    const view = new DataView(buf.buffer);
    const postBal = Number(view.getBigUint64(64, true));
    return Math.max(postBal - preBal, 0);
  }

  return 0;
}
