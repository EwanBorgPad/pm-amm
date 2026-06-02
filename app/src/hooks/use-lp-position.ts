"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { i80f48ToNumber } from "@pm-amm/sdk/math";
import { getClient } from "@/lib/pm-amm-client";

export interface LpPositionData {
  shares: number;
  /** Raw on-chain shares as a decimal string of the I80F48 (Q64.64) bits.
   *  Use this for withdraw — the float `shares` loses precision and can round
   *  ABOVE the stored bits, tripping the on-chain `burn <= shares` check. */
  sharesRaw: string;
  collateralDeposited: number;
  yesCheckpoint: number;
  noCheckpoint: number;
  pda: string;
}

export function useLpPosition(marketPda: string | undefined) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();

  return useQuery<LpPositionData | null>({
    queryKey: ["lp-position", marketPda, publicKey?.toBase58()],
    queryFn: async () => {
      if (!publicKey || !marketPda) return null;
      const marketKey = new PublicKey(marketPda);
      const client = getClient(connection);
      const lp = await client.fetchLpPosition(marketKey, publicKey);
      if (!lp) return null;
      return {
        shares: i80f48ToNumber(lp.shares),
        sharesRaw: lp.shares.toString(),
        collateralDeposited: Number(BigInt(lp.collateralDeposited.toString())),
        yesCheckpoint: i80f48ToNumber(lp.yesPerShareCheckpoint),
        noCheckpoint: i80f48ToNumber(lp.noPerShareCheckpoint),
        pda: client.lpPosition(marketKey, publicKey).toBase58(),
      };
    },
    enabled: !!publicKey && !!marketPda,
    refetchInterval: 5_000,
  });
}
