"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import { priceFromReserves, i80f48ToNumber } from "@pm-amm/sdk/math";
import { decodeName } from "@pm-amm/sdk";
import { getClient } from "@/lib/pm-amm-client";

const bnToNum = (bn: { toString(): string }): number => Number(BigInt(bn.toString()));

/** System program address. Pubkey::default().toBase58() returns this string —
 *  it indicates an unset Pubkey on-chain (Anchor's default value).
 */
const PUBKEY_DEFAULT = "11111111111111111111111111111111";

export interface MarketData {
  publicKey: string;
  marketId: number;
  authority: string;
  /** Collateral mint (any SPL token — not necessarily USDC). */
  collateralMint: string;
  name: string;
  startTs: number;
  endTs: number;
  lZero: number;
  reserveYes: number;
  reserveNo: number;
  totalLpShares: number;
  resolved: boolean;
  winningSide: number;
  price: number;
  lEff: number;
  cumYesPerShare: number;
  cumNoPerShare: number;
  /** GroupMarket PDA this leg is attached to. "" if standalone. */
  group: string;
  /** Calibrated initial YES price in bps (set by `initialize_market` or the
   *  vault launch path). 0 = legacy 50/50. Used as the display price for
   *  freshly-launched markets with zero reserves. */
  initialPriceBps: number;
}

export function useMarkets() {
  const { connection } = useConnection();

  return useQuery<MarketData[]>({
    queryKey: ["markets"],
    queryFn: async () => {
      // Filter by current Market account size (443 bytes) to skip any
      // old-layout accounts left over from earlier devnet deploys.
      const fetched = await getClient(connection).fetchAllMarkets(443);

      return fetched.map((acc) => {
        const m = acc.account;
        const now = Math.floor(Date.now() / 1000);
        const endTs = bnToNum(m.endTs);
        const isExpired = now >= endTs;
        const remaining = Math.max(endTs - now, 1);
        const lZero = i80f48ToNumber(m.lZero);
        const lEff = lZero * Math.sqrt(remaining);
        const x = i80f48ToNumber(m.reserveYes);
        const y = i80f48ToNumber(m.reserveNo);

        // The on-chain reserves (x, y) reflect the pool state at last_accrual_ts.
        // To display the *real* current price we must pair them with L_eff at
        // that same timestamp — otherwise Φ((y-x)/L_eff(now)) under/overshoots
        // mechanically whenever `accrue` hasn't been called recently, because
        // L_eff decays with time but the reserves stay frozen between accruals.
        const lastAccrualTs = bnToNum(m.lastAccrualTs);
        const lEffAtLastAccrual = lZero * Math.sqrt(Math.max(endTs - lastAccrualTs, 1));

        const initialPriceBps: number = m.initialPriceBps ?? 0;
        let price: number;
        if (m.resolved) {
          price = m.winningSide === 1 ? 1 : m.winningSide === 2 ? 0 : 0.5;
        } else if (isExpired || (x === 0 && y === 0)) {
          // Expired or reserves drained: use last-accrual L_eff for the
          // "last real price" (same logic, just narrower fallback for
          // reserves=0 via cumulative residuals).
          if (lEffAtLastAccrual > 0 && (x > 0 || y > 0)) {
            price = Math.max(0.001, Math.min(0.999, priceFromReserves(x, y, lEffAtLastAccrual)));
          } else {
            // Reserves are 0 — try in priority order:
            //   1. initial_price_bps (set by initialize_market / vault launch).
            //      Reflects the calibration target until first deposit_liquidity.
            //   2. cumulative residuals ratio (for expired markets where reserves
            //      drained to LP residuals)
            //   3. 0.5 fallback (legacy markets with no calibration)
            const cumYes = i80f48ToNumber(m.cumYesPerShare);
            const cumNo = i80f48ToNumber(m.cumNoPerShare);
            if (initialPriceBps > 0 && cumYes + cumNo === 0) {
              price = initialPriceBps / 10_000;
            } else if (cumYes + cumNo > 0) {
              // More NO released → price was high (YES), more YES released → price was low
              price = cumNo / (cumYes + cumNo);
            } else {
              price = 0.5;
            }
          }
        } else {
          // Active market: real price uses lEffAtLastAccrual since reserves
          // haven't been rebased since the last accrue.
          price =
            lEffAtLastAccrual > 0 && (x > 0 || y > 0)
              ? priceFromReserves(x, y, lEffAtLastAccrual)
              : 0.5;
        }

        // Decode name: [u8; 64] → trim trailing zeros → UTF-8 string.
        const nameStr = decodeName(m.name);

        const marketId = bnToNum(m.marketId);
        // Anchor exposes Pubkey::default() as the system program address
        // ("111..."). Normalize that to "" so callers can test isAttached
        // with a plain truthy check.
        const groupRaw = m.group.toBase58();
        const group = groupRaw === PUBKEY_DEFAULT ? "" : groupRaw;
        return {
          publicKey: acc.publicKey.toBase58(),
          marketId,
          authority: m.authority.toBase58(),
          collateralMint: m.collateralMint.toBase58(),
          name: nameStr || `Market #${marketId}`,
          startTs: bnToNum(m.startTs),
          endTs,
          lZero,
          reserveYes: x,
          reserveNo: y,
          totalLpShares: i80f48ToNumber(m.totalLpShares),
          resolved: m.resolved,
          winningSide: m.winningSide,
          price,
          lEff,
          cumYesPerShare: i80f48ToNumber(m.cumYesPerShare),
          cumNoPerShare: i80f48ToNumber(m.cumNoPerShare),
          group,
          initialPriceBps,
        };
      });
    },
    refetchInterval: 10_000,
  });
}
