/**
 * Devnet end-to-end test driven by a LOCAL keypair (no browser wallet).
 * Exercises the exact SDK paths the frontend calls — client.send.* / flows.* —
 * against the live program, with on-chain assertions at each step.
 *
 *   NODE_PATH="$PWD/app/node_modules" node scripts/e2e-devnet.cjs
 *
 * On-chain minimums: market/group duration >= 300s, commit >= 60s. To exercise
 * resolve+claim we create the resolvable market FIRST, run every no-wait test
 * while it expires, then resolve + claim at the end (overlapped ~5 min wait).
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const { getAssociatedTokenAddress, getAccount } = require("@solana/spl-token");
const anchor = require("@anchor-lang/core");
const { PmAmmClient, priceFromReserves, i80f48ToNumber } = require("../packages/sdk/dist/index.cjs");

const PROGRAM = new PublicKey("B1fuVjvzN1r7tWPxeexqJmHCoWUHGq3Pz6TpRqH8HbBf");
const USDC = new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ");
const RPC = "https://api.devnet.solana.com";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowS = () => Math.floor(Date.now() / 1000);
const kp = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json")))),
);

class NodeWallet {
  constructor(payer) {
    this.payer = payer;
  }
  get publicKey() {
    return this.payer.publicKey;
  }
  async signTransaction(tx) {
    tx.partialSign(this.payer);
    return tx;
  }
  async signAllTransactions(txs) {
    txs.forEach((t) => t.partialSign(this.payer));
    return txs;
  }
}

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(`PASS ${name}`);
    console.log(`✓ ${name}`);
  } catch (e) {
    results.push(`FAIL ${name} — ${(e.message || String(e)).slice(0, 160)}`);
    console.log(`✗ ${name} — ${(e.message || String(e)).slice(0, 160)}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const price = (m) =>
  priceFromReserves(
    i80f48ToNumber(m.reserveYes),
    i80f48ToNumber(m.reserveNo),
    i80f48ToNumber(m.lZero) * Math.sqrt(Math.max(Number(m.endTs.toString()) - nowS(), 1)),
  );

(async () => {
  const connection = new Connection(RPC, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new NodeWallet(kp), {
    commitment: "confirmed",
  });
  const client = PmAmmClient.fromProvider(provider, PROGRAM, USDC);
  console.log("signer:", kp.publicKey.toBase58(), "\n");

  // -- create the resolvable market up-front (305s ≈ just over the 300s min) --
  let resolveMkt;
  await step("resolve-market: create (305s) + deposit 10 + buy 4 YES", async () => {
    const r = await client.send.createMarket({
      name: "E2E resolve",
      durationSecs: 305,
      initialPriceBps: 5000,
      depositUsdc: 10,
    });
    resolveMkt = new PublicKey(r.marketPda);
    await client.send.swap(resolveMkt, "usdcToYes", 4_000_000, 0);
    const m = await client.fetchMarket(resolveMkt);
    assert(i80f48ToNumber(m.lZero) > 0, "lZero > 0");
  });

  // ------------------------------------------------------------ BINARY trade -
  await step("binary: createMarket(+deposit 50, seed 60%) + buy 5 YES → price up", async () => {
    const r = await client.send.createMarket({
      name: "E2E binary",
      durationSecs: 600,
      initialPriceBps: 6000,
      depositUsdc: 50,
    });
    const market = new PublicKey(r.marketPda);
    const m0 = await client.fetchMarket(market);
    assert(m0.initialPriceBps === 6000, `initBps ${m0.initialPriceBps}`);
    const p0 = price(m0);
    await client.send.swap(market, "usdcToYes", 5_000_000, 0);
    const p1 = price(await client.fetchMarket(market));
    assert(p1 > p0, `price did not rise (${p0.toFixed(3)} -> ${p1.toFixed(3)})`);
    await client.send.accrue(market);
  });

  // ------------------------------------------------------------------- GROUP -
  await step("group: createGroup(2 legs, 15/leg, 600s) + buy 3 YES on leg 0", async () => {
    const r = await client.flows.createGroup({
      name: "E2E group",
      legNames: ["Alpha", "Beta"],
      durationSecs: 600,
      budgetPerLegUsdc: 15,
    });
    const g = await client.fetchGroup(new PublicKey(r.groupPda));
    assert(g && g.legCount === 2, "legCount != 2");
    await client.send.swap(client.marketPda(r.legMarketIds[0]), "usdcToYes", 3_000_000, 0);
  });

  // ------------------------------------------------- VAULT (full flow, 60s) --
  let vault;
  await step("vault: create + commit 5 YES", async () => {
    const r = await client.send.createVault({
      name: "E2E vault",
      commitDurationSecs: 60,
      // > 300 so the launched market still clears the 300s min AFTER the commit
      // window elapses (end_ts is fixed at vault creation = commit_end + market).
      marketDurationSecs: 600,
      minTotalUsdc: 1,
    });
    vault = new PublicKey(r.vaultPda);
    await client.send.vaultCommit(vault, "yes", 5);
    const v = await client.fetchVault(vault);
    assert(Number(v.yesTotal.toString()) === 5_000_000 && v.commitCount === 1, "commit state");
  });

  await step("vault: wait 63s → launch → claimCommitter (mint 5 YES 1:1)", async () => {
    await sleep(63_000);
    const lr = await client.send.launchVaultMarket(vault);
    const v = await client.fetchVault(vault);
    assert(v.launched && v.market.toBase58() === lr.marketPda, "launch state");
    await client.send.claimCommitter(vault, v.market);
    const yesAta = await getAssociatedTokenAddress(client.yesMint(v.market), kp.publicKey);
    assert(Number((await getAccount(connection, yesAta)).amount) === 5_000_000, "claimed YES != 5e6");
  });

  // --------------------------------- RESOLVE + CLAIM the up-front market -----
  await step("resolve-market: wait expiry → resolveMarket(YES) → claimWinnings", async () => {
    const m = await client.fetchMarket(resolveMkt);
    const endTs = Number(m.endTs.toString());
    while (nowS() <= endTs + 3) await sleep(5_000);
    await client.send.resolveMarket(resolveMkt, "yes");
    const r = await client.fetchMarket(resolveMkt);
    assert(r.resolved && r.winningSide === 1, "not resolved YES");
    const ata = await getAssociatedTokenAddress(USDC, kp.publicKey);
    const before = Number((await getAccount(connection, ata)).amount);
    await client.send.claimWinnings(resolveMkt);
    const after = Number((await getAccount(connection, ata)).amount);
    assert(after >= before, "USDC decreased after claim");
  });

  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log("\n=== E2E SUMMARY ===");
  results.forEach((r) => console.log(r));
  console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
