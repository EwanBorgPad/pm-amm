"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import { getReadOnlyProgram, decodeName } from "@/lib/program";

/** CommitmentVaultGroup binary account size (matches state.rs::CommitmentVaultGroup::LEN). */
const VAULT_GROUP_ACCOUNT_SIZE = 560;

type AnchorBn = { toString(): string };
const bnToNum = (bn: AnchorBn): number => Number(BigInt(bn.toString()));

export interface VaultGroupLeg {
  index: number;
  name: string;
  total: number; // raw u64 (6 decimals)
  shareBps: number; // 0..10_000
}

export interface VaultGroupData {
  publicKey: string;
  vaultId: number;
  authority: string;
  name: string;
  legCount: number;
  legs: VaultGroupLeg[];
  total: number;
  commitEndTs: number;
  marketEndTs: number;
  commitCount: number;
  minTotal: number;
  /** GroupMarket created? */
  groupMarketInitialized: boolean;
  /** Number of legs whose underlying Market has been launched. */
  legsLaunched: number;
  /** All legs launched. */
  fullyLaunched: boolean;
  groupMarket: string;
  isCommitOpen: boolean;
  isLaunchReady: boolean;
  /** Refund opens when commit ended below min_total OR any leg < 100 bps. */
  isRefundOpen: boolean;
  /** All legs launched and markets still trading (now < market_end_ts). */
  isMarketLive: boolean;
  /** All legs launched and markets ended — claim opens. */
  isClaimOpen: boolean;
}

const PUBKEY_DEFAULT = "11111111111111111111111111111111";

export function useVaultGroups() {
  const { connection } = useConnection();
  return useQuery<VaultGroupData[]>({
    queryKey: ["vault_groups"],
    queryFn: async () => {
      const { program } = getReadOnlyProgram(connection);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const accounts = await (program.account as any).commitmentVaultGroup.all([
        { dataSize: VAULT_GROUP_ACCOUNT_SIZE },
      ]);
      const now = Math.floor(Date.now() / 1000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return accounts.map((acc: any) => buildVaultGroupData(acc, now));
    },
    refetchInterval: 10_000,
  });
}

export function useVaultGroup(vaultId: number | undefined) {
  const { data: vaults, ...rest } = useVaultGroups();
  const vault = useMemo(() => {
    if (vaultId === undefined || !vaults) return undefined;
    return vaults.find((v) => v.vaultId === vaultId);
  }, [vaults, vaultId]);
  return { data: vault, ...rest };
}

function decodeLegName(bytes: number[]): string {
  return decodeName(bytes);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildVaultGroupData(acc: any, now: number): VaultGroupData {
  const v = acc.account;
  const legCount: number = v.legCount;
  const legTotals: number[] = (v.legTotals as AnchorBn[]).map(bnToNum);
  const legNames: string[] = (v.legNames as number[][]).map(decodeLegName);

  let total = 0;
  for (let i = 0; i < legCount; i++) total += legTotals[i];

  const legs: VaultGroupLeg[] = [];
  let minShareBps = 10_000;
  for (let i = 0; i < legCount; i++) {
    const shareBps = total > 0 ? Math.floor((legTotals[i] * 10_000) / total) : 0;
    if (shareBps < minShareBps) minShareBps = shareBps;
    legs.push({
      index: i,
      name: legNames[i] || `Leg ${i}`,
      total: legTotals[i],
      shareBps,
    });
  }

  const commitEndTs = bnToNum(v.commitEndTs);
  const marketEndTs = bnToNum(v.marketEndTs);
  const minTotal = bnToNum(v.minTotal);
  const groupMarketInitialized: boolean = v.groupMarketInitialized;
  const legsLaunched: number = v.legsLaunched;
  const fullyLaunched = groupMarketInitialized && legsLaunched === legCount;
  const groupMarketStr = v.groupMarket.toBase58();
  const groupMarket = groupMarketStr === PUBKEY_DEFAULT ? "" : groupMarketStr;

  return {
    publicKey: acc.publicKey.toBase58(),
    vaultId: bnToNum(v.vaultId),
    authority: v.authority.toBase58(),
    name: decodeName(v.name) || `VaultGroup #${bnToNum(v.vaultId)}`,
    legCount,
    legs,
    total,
    commitEndTs,
    marketEndTs,
    commitCount: v.commitCount,
    minTotal,
    groupMarketInitialized,
    legsLaunched,
    fullyLaunched,
    groupMarket,
    isCommitOpen: !groupMarketInitialized && now < commitEndTs,
    isLaunchReady: !fullyLaunched && now >= commitEndTs && total >= minTotal && minShareBps >= 100,
    isRefundOpen:
      !groupMarketInitialized && now >= commitEndTs && (total < minTotal || minShareBps < 100),
    isMarketLive: fullyLaunched && now < marketEndTs,
    isClaimOpen: fullyLaunched && now >= marketEndTs,
  };
}
