/**
 * `flows.*` — multi-transaction orchestrations that don't fit a single ix:
 *   - createGroup: init group + per-leg (init + deposit + attach) bundles
 *   - resolveGroup / cancelGroup: header + cascade `resolve_group_leg` chunks
 *   - findClaimableLegs / claimAllGroupWinnings: per-leg `claim_winnings` batch
 *
 * Ports `create-group.ts`, `resolve-group.ts`, `claim-group-winnings.ts`.
 */
import { type PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddress } from "@solana/spl-token";
import type { PmAmmClient } from "../client";
import type { GroupCreateInput } from "../types/args";
import { CU } from "../constants";
import { randomU48 } from "../encoding";
import { ensureAtaIx, computeBudgetIx } from "../util/ata";

const usdc = (human: number): number => Math.floor(human * 1e6);

/** Cascade ≈ 100k CU/leg; cap chunks at 8 legs for the 1232-byte / 1.4M-CU caps. */
const MAX_LEGS_PER_TX = 8;
/** claim_winnings ≈ 300k CU each; 3 per tx leaves headroom under 1.4M. */
const MAX_CLAIMS_PER_TX = 3;

export interface GroupCreateResult {
  groupId: number;
  groupPda: string;
  legMarketIds: number[];
}

export interface ClaimableLeg {
  market: PublicKey;
  legIndex: number;
  yesBalance: number;
  noBalance: number;
}

export type FlowsApi = ReturnType<typeof makeFlows>;

export function makeFlows(client: PmAmmClient) {
  async function createGroup(
    input: GroupCreateInput,
    onProgress?: (label: string, step: number) => void,
  ): Promise<GroupCreateResult> {
    const legCount = input.legNames.length;
    if (legCount < 2 || legCount > 32) throw new Error("createGroup: legNames must be 2..32");
    const authority = client.walletPubkey();
    const endTs = Math.floor(Date.now() / 1000) + input.durationSecs;
    const groupId = randomU48();
    const groupPda = client.groupPda(groupId);
    const legBps = Math.floor(10_000 / legCount);
    let step = 0;
    const tick = (label: string) => onProgress?.(label, ++step);

    const { ix: ataIx } = await ensureAtaIx(
      client.connection,
      authority,
      authority,
      client.collateralMint,
    );
    if (ataIx) {
      tick("Create USDC token account");
      await client.sendIxs([ataIx]);
    }

    tick("Create group");
    await client.sendIxs([
      computeBudgetIx(CU.DEFAULT),
      await client.ix.initializeGroupMarket({
        authority,
        groupId,
        endTs,
        name: input.name,
        legCount,
      }),
    ]);

    const legMarketIds: number[] = [];
    for (let i = 0; i < legCount; i++) {
      const marketId = randomU48();
      legMarketIds.push(marketId);
      const market = client.marketPda(marketId);
      const legName = (input.legNames[i] || `Outcome ${i + 1}`).slice(0, 60);
      tick(`Setup leg ${i}`);
      await client.sendIxs([
        computeBudgetIx(CU.HEAVY),
        await client.ix.initializeMarket({
          authority,
          marketId,
          endTs,
          name: legName,
          initialPriceBps: legBps,
        }),
        await client.ix.depositLiquidity({
          signer: authority,
          market,
          amount: usdc(input.budgetPerLegUsdc),
        }),
        await client.ix.attachLegToGroup({ authority, group: groupPda, market, legIndex: i }),
      ]);
    }
    return { groupId, groupPda: groupPda.toBase58(), legMarketIds };
  }

  /**
   * Resolve (winningLeg set) or cancel (winningLeg null) a group, cascading
   * every attached leg. `legMarkets[i]` is null for unattached slots.
   */
  async function resolveGroup(args: {
    group: PublicKey;
    legMarkets: (PublicKey | null)[];
    winningLeg: number | null;
    onProgress?: (label: string, i: number, total: number) => void;
  }): Promise<void> {
    const { group, legMarkets, winningLeg, onProgress } = args;
    const authority = client.walletPubkey();
    const isCancel = winningLeg === null;
    if (!isCancel && (winningLeg < 0 || winningLeg >= legMarkets.length)) {
      throw new Error(`resolveGroup: winningLeg ${winningLeg} out of range`);
    }

    const header = isCancel
      ? await client.ix.cancelGroupMarket({ authority, group })
      : await client.ix.resolveGroup({ authority, group, winningLeg: winningLeg as number });

    const legIxs: TransactionInstruction[] = [];
    for (let i = 0; i < legMarkets.length; i++) {
      const m = legMarkets[i];
      if (m) legIxs.push(await client.ix.resolveGroupLeg({ group, market: m, legIndex: i }));
    }

    const chunks = chunkWithHeader(header, legIxs, MAX_LEGS_PER_TX);
    for (let i = 0; i < chunks.length; i++) {
      onProgress?.(
        i === 0 ? (isCancel ? "Cancel group" : "Resolve group") : `Cascade legs #${i + 1}`,
        i + 1,
        chunks.length,
      );
      await client.sendIxs([computeBudgetIx(CU.HEAVY), ...chunks[i]]);
    }
  }

  /** Walk leg markets, return those where `owner` holds YES or NO. Pure read. */
  async function findClaimableLegs(
    legMarkets: (PublicKey | null)[],
    owner?: PublicKey,
  ): Promise<ClaimableLeg[]> {
    const who = owner ?? client.walletPubkey();
    const checks = await Promise.all(
      legMarkets.map(async (market, legIndex) => {
        if (!market) return null;
        const userYes = await getAssociatedTokenAddress(client.yesMint(market), who);
        const userNo = await getAssociatedTokenAddress(client.noMint(market), who);
        const [yesBalance, noBalance] = await Promise.all([
          safeBalance(client.connection, userYes),
          safeBalance(client.connection, userNo),
        ]);
        if (yesBalance === 0 && noBalance === 0) return null;
        return { market, legIndex, yesBalance, noBalance } satisfies ClaimableLeg;
      }),
    );
    return checks.filter((c): c is ClaimableLeg => c !== null);
  }

  /** Build + send `claim_winnings` for every leg the wallet holds tokens in. */
  async function claimAllGroupWinnings(args: {
    legMarkets: (PublicKey | null)[];
    onProgress?: (label: string, i: number, total: number) => void;
  }): Promise<{ legsClaimed: number }> {
    const { legMarkets, onProgress } = args;
    const owner = client.walletPubkey();
    const claimable = await findClaimableLegs(legMarkets, owner);
    if (claimable.length === 0) throw new Error("No claimable positions on this group");

    const header = await ataPreIxs([client.collateralMint]);
    const legGroups = await Promise.all(claimable.map((c) => legClaimIxs(c.market)));
    const chunks = chunkLegGroups(header, legGroups, MAX_CLAIMS_PER_TX);
    for (let i = 0; i < chunks.length; i++) {
      onProgress?.(`Claim batch ${i + 1}`, i + 1, chunks.length);
      await client.sendIxs([computeBudgetIx(CU.HEAVY), ...chunks[i]]);
    }
    return { legsClaimed: claimable.length };
  }

  // ---- local helpers ----
  async function ataPreIxs(mints: PublicKey[]): Promise<TransactionInstruction[]> {
    const owner = client.walletPubkey();
    const out: TransactionInstruction[] = [];
    for (const mint of mints) {
      const { ix } = await ensureAtaIx(client.connection, owner, owner, mint);
      if (ix) out.push(ix);
    }
    return out;
  }

  /** [maybe createYesAta, maybe createNoAta, claim_winnings] for one leg. */
  async function legClaimIxs(market: PublicKey): Promise<TransactionInstruction[]> {
    const owner = client.walletPubkey();
    const ixs: TransactionInstruction[] = [];
    for (const mint of [client.yesMint(market), client.noMint(market)]) {
      const { ix } = await ensureAtaIx(client.connection, owner, owner, mint);
      if (ix) ixs.push(ix);
    }
    ixs.push(await client.ix.claimWinnings({ signer: owner, market }));
    return ixs;
  }

  return { createGroup, resolveGroup, findClaimableLegs, claimAllGroupWinnings };
}

// ----------------------------------------------------------------------------
// Stateless helpers
// ----------------------------------------------------------------------------

async function safeBalance(connection: PmAmmClient["connection"], ata: PublicKey): Promise<number> {
  try {
    const acc = await getAccount(connection, ata);
    return Number(acc.amount);
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const msg = err instanceof Error ? err.message : String(err);
    const isMissing =
      name === "TokenAccountNotFoundError" ||
      name === "TokenInvalidAccountOwnerError" ||
      msg.includes("could not find account") ||
      msg.includes("Account does not exist") ||
      msg.includes("Failed to find account");
    if (isMissing) return 0;
    throw err; // a real RPC failure must not read as "no balance"
  }
}

function chunkWithHeader(
  header: TransactionInstruction,
  legIxs: TransactionInstruction[],
  maxLegs: number,
): TransactionInstruction[][] {
  const chunks: TransactionInstruction[][] = [];
  let current: TransactionInstruction[] = [header];
  for (const ix of legIxs) {
    if (current.length >= maxLegs + (chunks.length === 0 ? 1 : 0)) {
      chunks.push(current);
      current = [];
    }
    current.push(ix);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function chunkLegGroups(
  headerIxs: TransactionInstruction[],
  legGroups: TransactionInstruction[][],
  maxPerTx: number,
): TransactionInstruction[][] {
  const chunks: TransactionInstruction[][] = [];
  let current: TransactionInstruction[] = [...headerIxs];
  let count = 0;
  for (const group of legGroups) {
    if (count >= maxPerTx) {
      chunks.push(current);
      current = [];
      count = 0;
    }
    current.push(...group);
    count += 1;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
