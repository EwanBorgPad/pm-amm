/**
 * `send.*` — convenience wrappers that build an instruction, prepend a
 * compute-budget preinstruction (+ any missing ATA creates), and send+confirm
 * via the bound provider. Mirrors the semantics of the app's former `run*`
 * helpers. USDC-denominated amounts are in HUMAN units (converted to 6dp here);
 * `swap` amounts are RAW micro-units (the caller computes slippage).
 */
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { BN } from "@anchor-lang/core";
import type { PmAmmClient } from "./client";
import { CU, PROTOCOL_DAO } from "./constants";
import { randomU48 } from "./encoding";
import { ensureAtaIx, computeBudgetIx } from "./util/ata";
import type {
  Side,
  SwapDirection,
  CreateMarketInput,
  CreateVaultInput,
  CreateVaultGroupInput,
} from "./types/args";

const usdc = (human: number): number => Math.floor(human * 1e6);

export type SendApi = ReturnType<typeof makeSend>;

export function makeSend(client: PmAmmClient) {
  /** Create-ATA preinstructions for the wallet's ATAs of the given mints. */
  async function ataPreIxs(mints: PublicKey[]): Promise<TransactionInstruction[]> {
    const owner = client.walletPubkey();
    const out: TransactionInstruction[] = [];
    for (const mint of mints) {
      const { ix } = await ensureAtaIx(client.connection, owner, owner, mint);
      if (ix) out.push(ix);
    }
    return out;
  }

  return {
    // ---- binary market ----
    async createMarket(input: CreateMarketInput) {
      const authority = client.walletPubkey();
      const marketId = randomU48();
      const market = client.marketPda(marketId);
      const endTs = Math.floor(Date.now() / 1000) + input.durationSecs;
      const ixs: TransactionInstruction[] = [computeBudgetIx(CU.HEAVY)];
      ixs.push(
        await client.ix.initializeMarket({
          authority,
          marketId,
          endTs,
          name: input.name,
          initialPriceBps: input.initialPriceBps ?? 0,
        }),
      );
      if (input.depositUsdc && input.depositUsdc > 0) {
        ixs.push(...(await ataPreIxs([client.collateralMint])));
        ixs.push(
          await client.ix.depositLiquidity({
            signer: authority,
            market,
            amount: usdc(input.depositUsdc),
          }),
        );
      }
      const signature = await client.sendIxs(ixs);
      return { marketId, marketPda: market.toBase58(), signature };
    },

    async swap(
      market: PublicKey,
      direction: SwapDirection,
      amountInMicro: number | BN,
      minOutputMicro: number | BN,
    ) {
      const signer = client.walletPubkey();
      const m = await client.fetchMarket(market);
      if (!m) throw new Error("swap: market not found");
      const authority = m.authority as PublicKey;
      const pre = await ataPreIxs([
        client.yesMint(market),
        client.noMint(market),
        client.collateralMint,
      ]);
      // Ensure the fee-recipient USDC ATAs exist (2% fee → 50% DAO, 50%
      // creator). Idempotent; payer is the swapper. The DAO key is off-curve.
      const { ix: daoAta } = await ensureAtaIx(
        client.connection,
        signer,
        PROTOCOL_DAO,
        client.collateralMint,
        true,
      );
      if (daoAta) pre.push(daoAta);
      // Creator ATA only when the swapper is NOT the creator (otherwise the
      // creator keeps their share and `creatorUsdc` is passed as null).
      if (!authority.equals(signer)) {
        const { ix: creatorAta } = await ensureAtaIx(
          client.connection,
          signer,
          authority,
          client.collateralMint,
        );
        if (creatorAta) pre.push(creatorAta);
      }
      const ix = await client.ix.swap({
        signer,
        market,
        direction,
        amountIn: amountInMicro,
        minOutput: minOutputMicro,
        creatorAuthority: authority,
      });
      return client.sendIxs([computeBudgetIx(CU.HEAVY), ...pre, ix]);
    },

    async depositLiquidity(market: PublicKey, amountUsdc: number) {
      const signer = client.walletPubkey();
      const pre = await ataPreIxs([client.collateralMint]);
      const ix = await client.ix.depositLiquidity({ signer, market, amount: usdc(amountUsdc) });
      return client.sendIxs([computeBudgetIx(CU.HEAVY), ...pre, ix]);
    },

    async withdrawLiquidity(market: PublicKey, sharesToBurn: BN | number) {
      const signer = client.walletPubkey();
      const pre = await ataPreIxs([client.yesMint(market), client.noMint(market)]);
      const ix = await client.ix.withdrawLiquidity({ signer, market, sharesToBurn });
      return client.sendIxs([computeBudgetIx(CU.HEAVY), ...pre, ix]);
    },

    async redeemPair(market: PublicKey, amountMicro: number | BN) {
      const signer = client.walletPubkey();
      const pre = await ataPreIxs([
        client.yesMint(market),
        client.noMint(market),
        client.collateralMint,
      ]);
      const ix = await client.ix.redeemPair({ signer, market, amount: amountMicro });
      return client.sendIxs([computeBudgetIx(CU.DEFAULT), ...pre, ix]);
    },

    async claimWinnings(market: PublicKey) {
      const signer = client.walletPubkey();
      const pre = await ataPreIxs([
        client.yesMint(market),
        client.noMint(market),
        client.collateralMint,
      ]);
      const ix = await client.ix.claimWinnings({ signer, market });
      return client.sendIxs([computeBudgetIx(CU.HEAVY), ...pre, ix]);
    },

    async claimLpResiduals(market: PublicKey) {
      const signer = client.walletPubkey();
      const pre = await ataPreIxs([client.yesMint(market), client.noMint(market)]);
      const ix = await client.ix.claimLpResiduals({ signer, market });
      // Residual accrual + dual mint-to is compute-heavy — matches the app's
      // original 1.4M budget; 400k can trip "Program failed to complete".
      return client.sendIxs([computeBudgetIx(CU.HEAVY), ...pre, ix]);
    },

    async resolveMarket(market: PublicKey, side: Side) {
      const signer = client.walletPubkey();
      const ix = await client.ix.resolveMarket({ signer, market, side });
      return client.sendIxs([computeBudgetIx(CU.DEFAULT), ix]);
    },

    async accrue(market: PublicKey) {
      const ix = await client.ix.accrue({ market });
      return client.sendIxs([computeBudgetIx(CU.DEFAULT), ix]);
    },

    // ---- binary commitment vault ----
    async createVault(input: CreateVaultInput) {
      const authority = client.walletPubkey();
      const vaultId = randomU48();
      const ix = await client.ix.initializeVault({
        authority,
        vaultId,
        name: input.name,
        commitDurationSecs: input.commitDurationSecs,
        marketDurationSecs: input.marketDurationSecs,
        minTotal: usdc(input.minTotalUsdc),
      });
      const signature = await client.sendIxs([computeBudgetIx(CU.DEFAULT), ix]);
      return { vaultId, vaultPda: client.vaultPda(vaultId).toBase58(), signature };
    },

    async vaultCommit(vault: PublicKey, side: Side, amountUsdc: number) {
      const signer = client.walletPubkey();
      const pre = await ataPreIxs([client.collateralMint]);
      const ix = await client.ix.vaultCommit({ signer, vault, side, amount: usdc(amountUsdc) });
      return client.sendIxs([computeBudgetIx(CU.DEFAULT), ...pre, ix]);
    },

    async launchVaultMarket(vault: PublicKey) {
      const payer = client.walletPubkey();
      const marketId = randomU48();
      const ix = await client.ix.launchVaultMarket({ payer, vault, marketId });
      const signature = await client.sendIxs([computeBudgetIx(CU.HEAVY), ix]);
      return { marketId, marketPda: client.marketPda(marketId).toBase58(), signature };
    },

    async claimCommitter(vault: PublicKey, market: PublicKey) {
      const signer = client.walletPubkey();
      const ix = await client.ix.claimCommitter({ signer, vault, market });
      return client.sendIxs([computeBudgetIx(CU.DEFAULT), ix]);
    },

    async refundCommit(vault: PublicKey) {
      const signer = client.walletPubkey();
      const ix = await client.ix.refundCommit({ signer, vault });
      return client.sendIxs([computeBudgetIx(CU.DEFAULT), ix]);
    },

    // ---- multi-outcome commitment vault ----
    async createVaultGroup(input: CreateVaultGroupInput) {
      if (input.legNames.length < 2 || input.legNames.length > 8) {
        throw new Error("createVaultGroup: legNames must contain 2 to 8 entries");
      }
      const authority = client.walletPubkey();
      const vaultId = randomU48();
      const ix = await client.ix.initializeVaultGroup({
        authority,
        vaultId,
        name: input.name,
        legNames: input.legNames,
        commitDurationSecs: input.commitDurationSecs,
        marketDurationSecs: input.marketDurationSecs,
        minTotal: usdc(input.minTotalUsdc),
      });
      const signature = await client.sendIxs([computeBudgetIx(CU.DEFAULT), ix]);
      return { vaultId, vaultPda: client.vaultGroupPda(vaultId).toBase58(), signature };
    },

    async vaultCommitGroup(vault: PublicKey, legIndex: number, amountUsdc: number) {
      const signer = client.walletPubkey();
      const pre = await ataPreIxs([client.collateralMint]);
      const ix = await client.ix.vaultCommitGroup({
        signer,
        vault,
        legIndex,
        amount: usdc(amountUsdc),
      });
      return client.sendIxs([computeBudgetIx(CU.DEFAULT), ...pre, ix]);
    },

    async launchVaultGroupMarket(vault: PublicKey) {
      const payer = client.walletPubkey();
      const groupId = randomU48();
      const ix = await client.ix.launchVaultGroupMarket({ payer, vault, groupId });
      const signature = await client.sendIxs([computeBudgetIx(CU.DEFAULT), ix]);
      return { groupId, groupPda: client.groupPda(groupId).toBase58(), signature };
    },

    async launchVaultGroupLeg(vault: PublicKey, group: PublicKey, legIndex: number) {
      const payer = client.walletPubkey();
      const marketId = randomU48();
      const ix = await client.ix.launchVaultGroupLeg({ payer, vault, group, legIndex, marketId });
      const signature = await client.sendIxs([computeBudgetIx(CU.HEAVY), ix]);
      return { marketId, marketPda: client.marketPda(marketId).toBase58(), signature };
    },

    async claimCommitterGroup(
      vault: PublicKey,
      group: PublicKey,
      market: PublicKey,
      legIndex: number,
    ) {
      const signer = client.walletPubkey();
      const ix = await client.ix.claimCommitterGroup({ signer, vault, group, market, legIndex });
      return client.sendIxs([computeBudgetIx(CU.DEFAULT), ix]);
    },

    async refundCommitGroup(vault: PublicKey) {
      const signer = client.walletPubkey();
      const ix = await client.ix.refundCommitGroup({ signer, vault });
      return client.sendIxs([computeBudgetIx(CU.DEFAULT), ix]);
    },
  };
}
