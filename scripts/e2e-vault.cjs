/**
 * Full binary commitment-vault lifecycle on devnet (option C: committers = LPs).
 *
 * Proves audit #6 end-to-end against the LIVE program:
 *   create -> commit -> launch (deposits the pot as liquidity) ->
 *   claim (materializes the committer's LP position) ->
 *   withdraw (LP pulls YES+NO back) -> SOLVENCY check.
 *
 * Surfpool/localnet can't clock-warp, so the full cycle can only be exercised
 * on a real validator with a real commit-window wait — hence this devnet e2e.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const { getAssociatedTokenAddress, getAccount, getMint } = require("@solana/spl-token");
const anchor = require("@anchor-lang/core");
const { PmAmmClient } = require("../packages/sdk/dist/index.cjs");

const PROGRAM = new PublicKey("GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y");
const USDC = new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ");
const Q48 = 2 ** 48; // I80F48 fractional scale
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kp = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json")))),
);
class NodeWallet {
  constructor(p) { this.payer = p; }
  get publicKey() { return this.payer.publicKey; }
  async signTransaction(tx) { tx.partialSign(this.payer); return tx; }
  async signAllTransactions(txs) { txs.forEach((t) => t.partialSign(this.payer)); return txs; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const bal = async (conn, ata) => {
  try { return Number((await getAccount(conn, ata)).amount); } catch { return 0; }
};

(async () => {
  const rpc = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
  const connection = new Connection(rpc, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new NodeWallet(kp), { commitment: "confirmed" });
  const client = PmAmmClient.fromProvider(provider, PROGRAM, USDC);

  console.log("1. create vault (commit 60s, market 600s, min 1 USDC)");
  const { vaultPda } = await client.send.createVault({
    name: "E2E vault LP", commitDurationSecs: 60, marketDurationSecs: 600, minTotalUsdc: 1,
  });
  const vault = new PublicKey(vaultPda);

  console.log("2. commit 5 USDC YES + 3 USDC NO  (total 8, implied YES 62.5%)");
  await client.send.vaultCommit(vault, "yes", 5);
  await client.send.vaultCommit(vault, "no", 3);
  let v = await client.fetchVault(vault);
  assert(Number(v.yesTotal.toString()) === 5_000_000, "yesTotal");
  assert(Number(v.noTotal.toString()) === 3_000_000, "noTotal");

  console.log("3. wait out the 60s commit window…");
  await sleep(63_000);

  console.log("4. launchVaultMarket — deposits the 8-USDC pot as liquidity");
  const lr = await client.send.launchVaultMarket(vault);
  v = await client.fetchVault(vault);
  assert(v.launched && v.market.toBase58() === lr.marketPda, "launched");
  const market = v.market;
  const m = await client.fetchMarket(market);
  assert(m.initialPriceBps === 6250, `seed ${m.initialPriceBps} != 6250`);
  assert(m.lZero.toString() !== "0", "l_zero must be > 0 (liquidity bootstrapped)");
  assert(m.totalLpShares.toString() !== "0", "total_lp_shares must be > 0");
  const mvault = client.marketVault(market);
  const mvUsdc = await bal(connection, mvault);
  assert(mvUsdc === 8_000_000, `market_vault funded ${mvUsdc} != 8e6`);
  console.log(`   seeded ${m.initialPriceBps / 100}%, market_vault=${mvUsdc / 1e6} USDC, l_zero>0 ✓`);

  console.log("5. claimCommitter — materialize the committer's LP position");
  await client.send.claimCommitter(vault, market);
  const lp = await client.fetchLpPosition(market, kp.publicKey);
  assert(lp, "LpPosition must exist after claim");
  const sharesFixed = Number(lp.shares.toString()) / Q48;
  assert(Math.abs(sharesFixed - 8_000_000) < 2, `LP shares ${sharesFixed} != 8e6 (1 USDC = 1 share)`);
  console.log(`   LP position created: ${(sharesFixed / 1e6).toFixed(3)} shares (= 8 USDC committed) ✓`);

  console.log("6. withdrawLiquidity — LP pulls YES+NO back from the pool");
  await client.send.withdrawLiquidity(market, new anchor.BN(lp.shares.toString()));
  const yesAta = await getAssociatedTokenAddress(client.yesMint(market), kp.publicKey);
  const noAta = await getAssociatedTokenAddress(client.noMint(market), kp.publicKey);
  const yes = await bal(connection, yesAta);
  const no = await bal(connection, noAta);
  assert(yes > 0 && no > 0, `withdrew YES=${yes} NO=${no}, both must be > 0`);
  console.log(`   withdrew ${(yes / 1e6).toFixed(3)} YES + ${(no / 1e6).toFixed(3)} NO ✓`);

  console.log("7. SOLVENCY — market_vault >= max(yes_supply, no_supply)");
  const yesSupply = Number((await getMint(connection, client.yesMint(market))).supply);
  const noSupply = Number((await getMint(connection, client.noMint(market))).supply);
  const vaultUsdc = await bal(connection, mvault);
  const maxSupply = Math.max(yesSupply, noSupply);
  assert(
    vaultUsdc >= maxSupply,
    `INSOLVENT: market_vault ${vaultUsdc} < max supply ${maxSupply}`,
  );
  console.log(
    `   market_vault=${(vaultUsdc / 1e6).toFixed(3)} USDC >= max(yes ${(yesSupply / 1e6).toFixed(3)}, ` +
      `no ${(noSupply / 1e6).toFixed(3)}) ✓  — winning side always fully backed`,
  );

  console.log("\n✓ FULL VAULT-LP LIFECYCLE PASSED (create → commit → launch → claim LP → withdraw, solvent)");
  process.exit(0);
})().catch((e) => {
  console.error("✗ FAILED:", (e.message || String(e)).slice(0, 400));
  process.exit(1);
});
