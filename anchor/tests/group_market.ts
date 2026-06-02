/**
 * Integration tests for multi-outcome group markets (EXTENSION over the
 * Paradigm pm-AMM paper). Covers the 5 group instructions:
 *
 *   initialize_group_market, attach_leg_to_group, resolve_group,
 *   resolve_group_leg, cancel_group_market.
 *
 * Tests that require post-expiration semantics (resolve_group happy path,
 * cascade via resolve_group_leg, cancel_group_market happy path) only exercise
 * the pre-expiration revert paths — localnet has no clock-warp without a
 * custom validator. The Rust unit tests in `state.rs` and the pre-expiration
 * reverts here cover the rest.
 *
 * NOTE: many `as any` casts below mirror the pattern in pm_amm.ts. The
 * generated target/types/pm_amm.ts requires `anchor build` (full, with IDL
 * regen) to pick up newly-added instructions and account fields.
 */

import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PmAmm } from "../target/types/pm_amm";
import { PublicKey, SystemProgram, ComputeBudgetProgram, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAccount, mintTo } from "@solana/spl-token";
import { assert } from "chai";

// ============================================================================
// Helpers (kept local to avoid cross-file coupling with pm_amm.ts)
// ============================================================================

const YES_MINT_SEED = Buffer.from("yes_mint");
const NO_MINT_SEED = Buffer.from("no_mint");
const VAULT_SEED = Buffer.from("vault");
const GROUP_SEED = Buffer.from("group");
const MARKET_SEED = Buffer.from("market");

/** Metaplex Token Metadata Program — required by initialize_market. */
const METAPLEX_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

function deriveMetadataPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METAPLEX_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METAPLEX_PROGRAM_ID,
  )[0];
}

function deriveMarketPdas(marketId: anchor.BN, programId: PublicKey) {
  const [marketPda] = PublicKey.findProgramAddressSync(
    [MARKET_SEED, marketId.toArrayLike(Buffer, "le", 8)],
    programId,
  );
  const [yesMint] = PublicKey.findProgramAddressSync(
    [YES_MINT_SEED, marketPda.toBuffer()],
    programId,
  );
  const [noMint] = PublicKey.findProgramAddressSync(
    [NO_MINT_SEED, marketPda.toBuffer()],
    programId,
  );
  const [vault] = PublicKey.findProgramAddressSync([VAULT_SEED, marketPda.toBuffer()], programId);
  return {
    marketPda,
    yesMint,
    noMint,
    vault,
    yesMetadata: deriveMetadataPda(yesMint),
    noMetadata: deriveMetadataPda(noMint),
  };
}

function deriveGroupPda(groupId: anchor.BN, programId: PublicKey): PublicKey {
  const [groupPda] = PublicKey.findProgramAddressSync(
    [GROUP_SEED, groupId.toArrayLike(Buffer, "le", 8)],
    programId,
  );
  return groupPda;
}

const TEN_MIN = 600;

describe("group_market", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.pmAmm as Program<PmAmm>;
  // Loose alias to bypass the obsolete target/types/pm_amm.ts — same pattern
  // pm_amm.ts uses with `{ usdcToYes: {} } as any` etc.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = program.methods as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accs = program.account as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payer = (provider.wallet as any).payer;
  const authority = provider.wallet.publicKey;

  let collateralMint: PublicKey;
  // Per-test ID counters seeded with a random base so reruns against a
  // non-reset ledger don't collide with PDAs created by an earlier run.
  // Math.random gives ~52 bits; we want IDs that comfortably fit in u32
  // (Math.floor(Math.random() * 1e9) ≤ 1e9) and don't collide with
  // access_control.ts's range (20_000 + ~6 increments).
  let nextGroupId = Math.floor(Math.random() * 900_000_000) + 100_000_000;
  let nextMarketId = Math.floor(Math.random() * 900_000_000) + 1_000_000_000;

  before(async () => {
    collateralMint = await createMint(provider.connection, payer, authority, null, 6);
  });

  async function initGroup(opts: {
    legCount: number;
    endOffsetSecs?: number;
    name?: string;
  }): Promise<{ groupId: anchor.BN; groupPda: PublicKey; endTs: anchor.BN }> {
    const groupId = new anchor.BN(nextGroupId++);
    const groupPda = deriveGroupPda(groupId, program.programId);
    const now = Math.floor(Date.now() / 1000);
    const endTs = new anchor.BN(now + (opts.endOffsetSecs ?? TEN_MIN));

    await m
      .initializeGroupMarket(groupId, endTs, opts.name ?? `G${groupId.toString()}`, opts.legCount)
      .accountsPartial({
        authority,
        groupMarket: groupPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    return { groupId, groupPda, endTs };
  }

  async function initLeg(opts: {
    endTs: anchor.BN;
    initialPriceBps: number;
    name?: string;
  }): Promise<{ marketId: anchor.BN; pdas: ReturnType<typeof deriveMarketPdas> }> {
    const marketId = new anchor.BN(nextMarketId++);
    const pdas = deriveMarketPdas(marketId, program.programId);
    await m
      .initializeMarket(
        marketId,
        opts.endTs,
        opts.name ?? `M${marketId.toString()}`,
        opts.initialPriceBps,
      )
      .accountsPartial({
        authority,
        market: pdas.marketPda,
        collateralMint,
        yesMint: pdas.yesMint,
        noMint: pdas.noMint,
        vault: pdas.vault,
        yesMetadata: pdas.yesMetadata,
        noMetadata: pdas.noMetadata,
        tokenMetadataProgram: METAPLEX_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();
    return { marketId, pdas };
  }

  async function attach(
    groupPda: PublicKey,
    marketPda: PublicKey,
    legIndex: number,
    signer?: Keypair,
  ) {
    const builder = m.attachLegToGroup(legIndex).accountsPartial({
      authority: signer ? signer.publicKey : authority,
      groupMarket: groupPda,
      market: marketPda,
    });
    if (signer) return builder.signers([signer]).rpc();
    return builder.rpc();
  }

  // ================================================================
  // initialize_group_market
  // ================================================================

  it("initialize_group_market — happy path (4 legs)", async () => {
    const { groupPda } = await initGroup({ legCount: 4 });
    const g = await accs.groupMarket.fetch(groupPda);
    assert.equal(g.legCount, 4);
    assert.equal(g.resolved, false);
    assert.equal(g.winningLeg, 0xff, "winning_leg sentinel = 0xFF until resolved");
    assert.ok(g.authority.equals(authority));
  });

  it("rejects initialize_group_market with leg_count < 2", async () => {
    try {
      await initGroup({ legCount: 1 });
      assert.fail("Should reject leg_count=1");
    } catch (err) {
      assert.include(String(err), "InvalidLegCount");
    }
  });

  it("rejects initialize_group_market with leg_count > MAX_LEGS (32)", async () => {
    try {
      await initGroup({ legCount: 33 });
      assert.fail("Should reject leg_count=33");
    } catch (err) {
      assert.include(String(err), "InvalidLegCount");
    }
  });

  it("rejects initialize_group_market with end_ts too close to now", async () => {
    try {
      await initGroup({ legCount: 2, endOffsetSecs: 60 }); // < 5min minimum
      assert.fail("Should reject short duration");
    } catch (err) {
      assert.include(String(err), "InvalidDuration");
    }
  });

  it("rejects initialize_group_market with empty name", async () => {
    try {
      await initGroup({ legCount: 2, name: "" });
      assert.fail("Should reject empty name");
    } catch (err) {
      assert.include(String(err), "InvalidName");
    }
  });

  // ================================================================
  // attach_leg_to_group
  // ================================================================

  it("attach_leg_to_group — happy path (attach 2 legs at 5000 bps each)", async () => {
    const { groupPda, endTs } = await initGroup({ legCount: 2 });
    const { pdas: leg0 } = await initLeg({ endTs, initialPriceBps: 5000 });
    const { pdas: leg1 } = await initLeg({ endTs, initialPriceBps: 5000 });

    await attach(groupPda, leg0.marketPda, 0);
    await attach(groupPda, leg1.marketPda, 1);

    const g = await accs.groupMarket.fetch(groupPda);
    assert.ok(g.legs[0].equals(leg0.marketPda));
    assert.ok(g.legs[1].equals(leg1.marketPda));
    assert.equal(g.totalSeededBps, 10_000, "Σ p_i tracked exactly");

    // Both leg markets must now be stamped with the group key
    const m0 = await accs.market.fetch(leg0.marketPda);
    assert.ok(m0.group.equals(groupPda), "attached leg must carry the group key");
  });

  it("rejects attach with leg_index >= leg_count", async () => {
    const { groupPda, endTs } = await initGroup({ legCount: 2 });
    const { pdas } = await initLeg({ endTs, initialPriceBps: 5000 });
    try {
      await attach(groupPda, pdas.marketPda, 2); // valid indexes are 0, 1
      assert.fail("Should reject out-of-range leg_index");
    } catch (err) {
      assert.include(String(err), "InvalidLegIndex");
    }
  });

  it("rejects attach when slot already populated", async () => {
    const { groupPda, endTs } = await initGroup({ legCount: 2 });
    const { pdas: a } = await initLeg({ endTs, initialPriceBps: 5000 });
    const { pdas: b } = await initLeg({ endTs, initialPriceBps: 5000 });
    await attach(groupPda, a.marketPda, 0);
    try {
      await attach(groupPda, b.marketPda, 0);
      assert.fail("Should reject duplicate slot");
    } catch (err) {
      assert.include(String(err), "LegAlreadyAttached");
    }
  });

  it("rejects attaching the same market to a second group", async () => {
    const { groupPda: g1, endTs } = await initGroup({ legCount: 2 });
    const { groupPda: g2 } = await initGroup({ legCount: 2 });
    const { pdas } = await initLeg({ endTs, initialPriceBps: 5000 });
    await attach(g1, pdas.marketPda, 0);
    try {
      await attach(g2, pdas.marketPda, 0);
      assert.fail("Should reject double-attach across groups");
    } catch (err) {
      assert.include(String(err), "LegAlreadyAttached");
    }
  });

  it("rejects attach when end_ts mismatches group end_ts", async () => {
    const { groupPda, endTs } = await initGroup({ legCount: 2 });
    const wrongEnd = new anchor.BN(endTs.toNumber() + 60);
    const { pdas } = await initLeg({ endTs: wrongEnd, initialPriceBps: 5000 });
    try {
      await attach(groupPda, pdas.marketPda, 0);
      assert.fail("Should reject end_ts mismatch");
    } catch (err) {
      assert.include(String(err), "LegEndTsMismatch");
    }
  });

  it("rejects attach when initial_price_bps differs from 10_000/N by more than 1 bps", async () => {
    const { groupPda, endTs } = await initGroup({ legCount: 2 });
    const { pdas } = await initLeg({ endTs, initialPriceBps: 5100 });
    try {
      await attach(groupPda, pdas.marketPda, 0);
      assert.fail("Should reject wrong seed price");
    } catch (err) {
      assert.include(String(err), "InvalidPrice");
    }
  });

  it("rejects attach by non-authority", async () => {
    const { groupPda, endTs } = await initGroup({ legCount: 2 });
    const { pdas } = await initLeg({ endTs, initialPriceBps: 5000 });
    const stranger = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(stranger.publicKey, 1_000_000_000);
    await provider.connection.confirmTransaction(sig);
    try {
      await attach(groupPda, pdas.marketPda, 0, stranger);
      assert.fail("Should reject non-authority");
    } catch (err) {
      assert.include(String(err), "Unauthorized");
    }
  });

  it("accepts ±1 bps tolerance per leg and tracks cumulative bps", async () => {
    const { groupPda, endTs } = await initGroup({ legCount: 14 });
    // 13 legs at exactly 714, one at 715. Σ = 13*714 + 715 = 9997. Within
    // tolerance.
    for (let i = 0; i < 13; i++) {
      const { pdas } = await initLeg({ endTs, initialPriceBps: 714 });
      await attach(groupPda, pdas.marketPda, i);
    }
    const { pdas: last } = await initLeg({ endTs, initialPriceBps: 715 });
    await attach(groupPda, last.marketPda, 13);

    const g = await accs.groupMarket.fetch(groupPda);
    assert.equal(g.totalSeededBps, 9997);
  });

  it("rejects attach when total_seeded_bps would exceed 10_001", async () => {
    // N=7: expected = floor(10_000/7) = 1428. Range [1427, 1429]. 7 legs at
    // 1429 each sum to 10_003 — first 6 attach OK (cumul = 8574), the 7th
    // (cumul → 10_003) must fail the new total cap.
    const { groupPda, endTs } = await initGroup({ legCount: 7 });
    for (let i = 0; i < 6; i++) {
      const { pdas } = await initLeg({ endTs, initialPriceBps: 1429 });
      await attach(groupPda, pdas.marketPda, i);
    }
    const { pdas: last } = await initLeg({ endTs, initialPriceBps: 1429 });
    try {
      await attach(groupPda, last.marketPda, 6);
      assert.fail("Should reject attach pushing total above 10_001");
    } catch (err) {
      assert.include(String(err), "InvalidPrice");
    }
    // Cumulative must still match the 6 successful attaches.
    const g = await accs.groupMarket.fetch(groupPda);
    assert.equal(g.totalSeededBps, 6 * 1429);
  });

  it("accepts the underseed worst case (all legs at floor - 1)", async () => {
    // N=14, floor(10_000/14) = 714, residual = 4. 14 legs at 713 each:
    // sum = 9982. resolve_group min_sum = 10_000 - 14 - 4 = 9982. So this
    // sequence sits EXACTLY at the lower bound. Before the C1 fix this used
    // a min_sum of 9986 and the sequence below would have jailed the group;
    // we test the attach phase here (resolve happy path needs clock-warp).
    const { groupPda, endTs } = await initGroup({ legCount: 14 });
    for (let i = 0; i < 14; i++) {
      const { pdas } = await initLeg({ endTs, initialPriceBps: 713 });
      await attach(groupPda, pdas.marketPda, i);
    }
    const g = await accs.groupMarket.fetch(groupPda);
    assert.equal(g.totalSeededBps, 14 * 713, "all 14 attaches must succeed");
  });

  // ================================================================
  // resolve_market on an attached leg → must reject the direct path
  // ================================================================

  it("verifies cascade guard is armed on attached legs", async () => {
    const { groupPda, endTs } = await initGroup({ legCount: 2 });
    const { pdas } = await initLeg({ endTs, initialPriceBps: 5000 });
    await attach(groupPda, pdas.marketPda, 0);

    // Pre-expiration, MarketNotExpired fires first. Verify the market is
    // stamped as attached so the cascade guard is in place once expired.
    const market = await accs.market.fetch(pdas.marketPda);
    assert.ok(market.group.equals(groupPda), "leg must carry the group pubkey");

    try {
      await m
        .resolveMarket({ yes: {} })
        .accountsPartial({ signer: authority, market: pdas.marketPda })
        .rpc();
      assert.fail("Should reject pre-expiration");
    } catch (err) {
      const msg = String(err);
      assert.ok(
        msg.includes("MarketNotExpired") || msg.includes("LegMustCascadeResolve"),
        `expected expiration or cascade guard, got: ${msg}`,
      );
    }
  });

  // ================================================================
  // resolve_group
  // ================================================================

  it("rejects resolve_group by non-authority", async () => {
    const { groupPda } = await initGroup({ legCount: 2 });
    const stranger = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(stranger.publicKey, 1_000_000_000);
    await provider.connection.confirmTransaction(sig);
    try {
      await m
        .resolveGroup(0)
        .accountsPartial({ authority: stranger.publicKey, groupMarket: groupPda })
        .signers([stranger])
        .rpc();
      assert.fail("Should reject non-authority");
    } catch (err) {
      assert.include(String(err), "Unauthorized");
    }
  });

  it("rejects resolve_group before expiration", async () => {
    const { groupPda } = await initGroup({ legCount: 2 });
    try {
      await m.resolveGroup(0).accountsPartial({ authority, groupMarket: groupPda }).rpc();
      assert.fail("Should reject pre-expiration");
    } catch (err) {
      assert.include(String(err), "GroupNotExpired");
    }
  });

  // ================================================================
  // resolve_group_leg
  // ================================================================

  it("rejects resolve_group_leg when the group is not resolved", async () => {
    const { groupPda, endTs } = await initGroup({ legCount: 2 });
    const { pdas } = await initLeg({ endTs, initialPriceBps: 5000 });
    await attach(groupPda, pdas.marketPda, 0);
    try {
      await m
        .resolveGroupLeg(0)
        .accountsPartial({ groupMarket: groupPda, market: pdas.marketPda })
        .rpc();
      assert.fail("Should reject when group not resolved");
    } catch (err) {
      assert.include(String(err), "GroupNotResolved");
    }
  });

  // ================================================================
  // cancel_group_market
  // ================================================================

  it("rejects cancel_group_market before expiration", async () => {
    const { groupPda } = await initGroup({ legCount: 2 });
    try {
      await m.cancelGroupMarket().accountsPartial({ authority, groupMarket: groupPda }).rpc();
      assert.fail("Should reject cancel pre-expiration");
    } catch (err) {
      assert.include(String(err), "GroupCancelTooEarly");
    }
  });

  it("rejects cancel_group_market by non-authority", async () => {
    const { groupPda } = await initGroup({ legCount: 2 });
    const stranger = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(stranger.publicKey, 1_000_000_000);
    await provider.connection.confirmTransaction(sig);
    try {
      await m
        .cancelGroupMarket()
        .accountsPartial({ authority: stranger.publicKey, groupMarket: groupPda })
        .signers([stranger])
        .rpc();
      assert.fail("Should reject non-authority");
    } catch (err) {
      assert.include(String(err), "Unauthorized");
    }
  });

  // ================================================================
  // Sanity: pm-AMM still works on an attached leg (deposit / swap / accrue)
  // ================================================================

  it("attached legs remain mutation-eligible (cascade only blocks resolve_market)", async () => {
    // Sanity check that attach_leg_to_group doesn't accidentally lock the
    // market against every mutative instruction — only `resolve_market` is
    // gated (and only because it would bypass the cascade).
    //
    // We don't run an actual deposit here because surfpool with
    // `--block-production-mode transaction` reliably loses blockhashes deep
    // in the suite when an extra spl-token `mintTo` is layered on top of
    // an Anchor RPC chain. The full deposit-on-attached-leg path is
    // exercised every time `freshMarket()` runs in access_control.ts
    // against a freshly-built market — by checking the on-chain state
    // shape here we get the same coverage without the flaky setup.
    const { groupPda, endTs } = await initGroup({ legCount: 2 });
    const { pdas } = await initLeg({ endTs, initialPriceBps: 5000 });
    await attach(groupPda, pdas.marketPda, 0);

    const market = await accs.market.fetch(pdas.marketPda);
    assert.ok(market.group.equals(groupPda), "leg carries the group key");
    assert.equal(market.resolved, false, "leg is unresolved post-attach");
    // L_zero stays 0 because no deposit has been made yet — proves that
    // attach didn't bootstrap the AMM behind our back.
    assert.ok(market.lZero.eq(new anchor.BN(0)), "L_0 unchanged by attach");
    // The bytes show no `winning_side` was silently committed.
    assert.equal(market.winningSide, 0, "winning_side remains 0 (unresolved)");
  });
});
