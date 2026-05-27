"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import type { MarketData } from "@/hooks/use-markets";
import { sumProbabilities } from "@/lib/pm-math";
import { getReadOnlyProgram, type GroupMarketAccount, decodeName } from "@/lib/program";

/** GroupMarket binary account size (matches state.rs::GroupMarket::LEN). */
const GROUP_ACCOUNT_SIZE = 1188;

/** Anchor BN-like type; we only read .toString() to widen-convert. */
type AnchorBn = { toString(): string };

const bnToNum = (bn: AnchorBn): number => Number(BigInt(bn.toString()));

export interface GroupData {
  publicKey: string;
  groupId: number;
  authority: string;
  name: string;
  startTs: number;
  endTs: number;
  legCount: number;
  /** Length = legCount. `null` slots indicate an attached pubkey we couldn't resolve. */
  legs: (MarketData | null)[];
  /** Pubkeys of all leg slots (raw, before resolution). */
  legPubkeys: string[];
  resolved: boolean;
  /** Index of the winning leg, or `null` if not resolved or cancelled. */
  winningLeg: number | null;
  /** Σ p_i across attached legs. Should be ≈ 1; drift = arb opportunity. */
  sumProbabilities: number;
  /** Number of slots in `legs` that hold a real pubkey (not Pubkey::default()). */
  attachedLegCount: number;
  /** True when every slot in [0..legCount) is populated. */
  isComplete: boolean;
  /** True for unresolved groups that are missing legs — eligible for cancel. */
  isIncomplete: boolean;
}

/**
 * Fetch all GroupMarket accounts and join each with its leg Market data.
 *
 * `markets` is passed in (from useMarkets) rather than re-fetched so the leg
 * price + reserves stay in sync with the rest of the UI on a single 10s tick.
 */
export function useGroups(markets: MarketData[] | undefined) {
  const { connection } = useConnection();

  const marketByPubkey = useMemo(
    () => new Map((markets ?? []).map((m) => [m.publicKey, m])),
    [markets],
  );

  return useQuery<GroupData[]>({
    queryKey: ["groups", markets?.length ?? 0],
    enabled: markets !== undefined,
    queryFn: async () => {
      const { accounts } = getReadOnlyProgram(connection);
      const fetched = await accounts.groupMarket.all([{ dataSize: GROUP_ACCOUNT_SIZE }]);
      return fetched.map((acc) =>
        buildGroupData(acc.publicKey.toBase58(), acc.account, marketByPubkey),
      );
    },
    refetchInterval: 10_000,
  });
}

function buildGroupData(
  publicKey: string,
  g: GroupMarketAccount,
  marketByPubkey: Map<string, MarketData>,
): GroupData {
  const legCount = g.legCount;
  const legPubkeys = g.legs.slice(0, legCount).map((p) => p.toBase58());
  const legs: (MarketData | null)[] = legPubkeys.map((pk) => marketByPubkey.get(pk) ?? null);
  const legPrices = legs.filter((m): m is MarketData => m !== null).map((m) => m.price);
  const sumP = sumProbabilities(legPrices);

  const NO_WINNING_LEG = 0xff;
  const winningLeg = g.resolved && g.winningLeg !== NO_WINNING_LEG ? g.winningLeg : null;

  const groupId = bnToNum(g.groupId);
  const nameStr = decodeName(g.name) || `Group #${groupId}`;

  const DEFAULT_PUBKEY = "11111111111111111111111111111111";
  const attachedLegCount = legPubkeys.filter((pk) => pk !== DEFAULT_PUBKEY).length;
  const isComplete = attachedLegCount === legCount;

  return {
    publicKey,
    groupId,
    authority: g.authority.toBase58(),
    name: nameStr,
    startTs: bnToNum(g.startTs),
    endTs: bnToNum(g.endTs),
    legCount,
    legs,
    legPubkeys,
    resolved: g.resolved,
    winningLeg,
    sumProbabilities: sumP,
    attachedLegCount,
    isComplete,
    isIncomplete: !g.resolved && !isComplete,
  };
}

/** Filter to groups owned by `authority` that are unresolved and missing legs. */
export function useIncompleteUserGroups(
  authority: string | undefined,
  markets: MarketData[] | undefined,
): GroupData[] {
  const { data: groups } = useGroups(markets);
  return useMemo(() => {
    if (!authority || !groups) return [];
    return groups.filter((g) => g.authority === authority && g.isIncomplete);
  }, [authority, groups]);
}

/** Fetch a single group by groupId, with its resolved legs. */
export function useGroup(groupId: number | bigint | undefined, markets: MarketData[] | undefined) {
  const { data: groups, ...rest } = useGroups(markets);
  const group = useMemo(() => {
    if (groupId === undefined || !groups) return undefined;
    const target = BigInt(groupId);
    return groups.find((g) => BigInt(g.groupId) === target);
  }, [groups, groupId]);

  return { data: group, ...rest };
}
