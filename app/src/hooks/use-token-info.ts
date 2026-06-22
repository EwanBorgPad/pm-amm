"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { findToken, shortMint, type TokenMeta } from "@/lib/tokens";

export type TokenInfo = TokenMeta;

/**
 * Resolve a collateral mint's metadata (symbol / name / logo / decimals).
 * Curated list first; otherwise read the decimals on-chain and use a short-mint
 * symbol. Token metadata is immutable → cached indefinitely.
 */
export function useTokenInfo(mint: string | undefined) {
  const { connection } = useConnection();
  return useQuery<TokenInfo | null>({
    queryKey: ["token-info", mint],
    enabled: !!mint,
    staleTime: Infinity,
    queryFn: async () => {
      if (!mint) return null;
      const known = findToken(mint);
      if (known) return known;
      const info = await getMint(connection, new PublicKey(mint));
      return { mint, symbol: shortMint(mint), name: shortMint(mint), decimals: info.decimals };
    },
  });
}
