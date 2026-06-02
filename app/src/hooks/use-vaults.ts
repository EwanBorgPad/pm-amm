"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import { decodeName } from "@pm-amm/sdk";
import { getClient } from "@/lib/pm-amm-client";

/** CommitmentVault binary account size (matches state.rs::CommitmentVault::LEN). */
const VAULT_ACCOUNT_SIZE = 288;

type AnchorBn = { toString(): string };

const bnToNum = (bn: AnchorBn): number => Number(BigInt(bn.toString()));

export interface VaultData {
  publicKey: string;
  vaultId: number;
  authority: string;
  name: string;
  commitEndTs: number;
  marketEndTs: number;
  yesTotal: number; // raw u64 (6 decimals → divide by 1e6 for display)
  noTotal: number;
  total: number;
  commitCount: number;
  minTotal: number;
  launched: boolean;
  winningPriceBps: number;
  market: string; // "" if Pubkey::default()
  /** `true` iff `now < commit_end_ts`. */
  isCommitOpen: boolean;
  /** `true` iff `!launched && now >= commit_end_ts && total >= min_total`. */
  isLaunchReady: boolean;
  /** `true` iff `!launched && now >= commit_end_ts && total < min_total`. */
  isRefundOpen: boolean;
  /** Market launched and still trading (`launched && now < market_end_ts`). */
  isMarketLive: boolean;
  /** Market ended — claim is open (`launched && now >= market_end_ts`). */
  isClaimOpen: boolean;
  /** Implied current price from the commit ratio, in [0, 1]. */
  impliedPrice: number;
}

const PUBKEY_DEFAULT = "11111111111111111111111111111111";

export function useVaults() {
  const { connection } = useConnection();
  return useQuery<VaultData[]>({
    queryKey: ["vaults"],
    queryFn: async () => {
      const accounts = await getClient(connection).fetchAllVaults(VAULT_ACCOUNT_SIZE);
      const now = Math.floor(Date.now() / 1000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return accounts.map((acc: any) => buildVaultData(acc, now));
    },
    refetchInterval: 10_000,
  });
}

export function useVault(vaultId: number | undefined) {
  const { data: vaults, ...rest } = useVaults();
  const vault = useMemo(() => {
    if (vaultId === undefined || !vaults) return undefined;
    return vaults.find((v) => v.vaultId === vaultId);
  }, [vaults, vaultId]);
  return { data: vault, ...rest };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildVaultData(acc: any, now: number): VaultData {
  const v = acc.account;
  const yesTotal = bnToNum(v.yesTotal);
  const noTotal = bnToNum(v.noTotal);
  const total = yesTotal + noTotal;
  const commitEndTs = bnToNum(v.commitEndTs);
  const minTotal = bnToNum(v.minTotal);
  const launched: boolean = v.launched;
  const marketStr = v.market.toBase58();
  const market = marketStr === PUBKEY_DEFAULT ? "" : marketStr;

  return {
    publicKey: acc.publicKey.toBase58(),
    vaultId: bnToNum(v.vaultId),
    authority: v.authority.toBase58(),
    name: decodeName(v.name) || `Vault #${bnToNum(v.vaultId)}`,
    commitEndTs,
    marketEndTs: bnToNum(v.marketEndTs),
    yesTotal,
    noTotal,
    total,
    commitCount: v.commitCount,
    minTotal,
    launched,
    winningPriceBps: v.winningPriceBps,
    market,
    isCommitOpen: !launched && now < commitEndTs,
    isLaunchReady: !launched && now >= commitEndTs && total >= minTotal,
    isRefundOpen: !launched && now >= commitEndTs && total < minTotal,
    isMarketLive: launched && now < bnToNum(v.marketEndTs),
    isClaimOpen: launched && now >= bnToNum(v.marketEndTs),
    impliedPrice: total > 0 ? yesTotal / total : 0.5,
  };
}
