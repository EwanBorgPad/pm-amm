/** Focused devnet test: full binary commitment-vault lifecycle via the SDK. */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const { getAssociatedTokenAddress, getAccount } = require("@solana/spl-token");
const anchor = require("@anchor-lang/core");
const { PmAmmClient } = require("../packages/sdk/dist/index.cjs");

const PROGRAM = new PublicKey("GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y");
const USDC = new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ");
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

(async () => {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const provider = new anchor.AnchorProvider(connection, new NodeWallet(kp), { commitment: "confirmed" });
  const client = PmAmmClient.fromProvider(provider, PROGRAM, USDC);

  console.log("vault: create (commit 60s, market 600s, min 1 USDC)");
  const { vaultPda } = await client.send.createVault({
    name: "E2E vault full", commitDurationSecs: 60, marketDurationSecs: 600, minTotalUsdc: 1,
  });
  const vault = new PublicKey(vaultPda);

  console.log("vault: commit 5 USDC YES + 3 USDC NO");
  await client.send.vaultCommit(vault, "yes", 5);
  await client.send.vaultCommit(vault, "no", 3);
  let v = await client.fetchVault(vault);
  assert(Number(v.yesTotal.toString()) === 5_000_000, "yesTotal");
  assert(Number(v.noTotal.toString()) === 3_000_000, "noTotal");
  console.log(`  yes=${v.yesTotal} no=${v.noTotal} count=${v.commitCount} → implied YES ${(5/8*100).toFixed(1)}%`);

  console.log("vault: waiting out the 60s commit window…");
  await sleep(63_000);

  console.log("vault: launchVaultMarket (permissionless)");
  const lr = await client.send.launchVaultMarket(vault);
  v = await client.fetchVault(vault);
  assert(v.launched && v.market.toBase58() === lr.marketPda, "launched");
  const m = await client.fetchMarket(v.market);
  assert(m.initialPriceBps === 6250, `seed ${m.initialPriceBps} != 6250 (5/8)`); // 5/(5+3)=62.5%
  console.log(`  launched market ${lr.marketPda} seeded at ${m.initialPriceBps / 100}%`);

  console.log("vault: claimCommitter (mint YES+NO 1:1, move backing USDC)");
  await client.send.claimCommitter(vault, v.market);
  const yesAta = await getAssociatedTokenAddress(client.yesMint(v.market), kp.publicKey);
  const noAta = await getAssociatedTokenAddress(client.noMint(v.market), kp.publicKey);
  const yes = Number((await getAccount(connection, yesAta)).amount);
  const no = Number((await getAccount(connection, noAta)).amount);
  assert(yes === 5_000_000, `claimed YES ${yes} != 5e6`);
  assert(no === 3_000_000, `claimed NO ${no} != 3e6`);
  console.log(`  minted ${yes / 1e6} YES + ${no / 1e6} NO to wallet ✓`);

  console.log("\n✓ FULL VAULT LIFECYCLE PASSED (create → commit → launch → claim)");
  process.exit(0);
})().catch((e) => {
  console.error("✗ FAILED:", (e.message || String(e)).slice(0, 300));
  process.exit(1);
});
