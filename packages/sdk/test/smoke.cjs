/**
 * SDK test suite — no network, no SOL spent. Locks the contract the frontend
 * (and external integrators) rely on:
 *   1. per-deployment address override
 *   2. PDA parity: every bound client helper === the pure derive*(programId, …)
 *   3. instruction builders emit instructions bound to the program id
 *   4. pure math sanity
 *
 * Runs against the CJS build (`dist/index.cjs`) so plain Node can execute it.
 *   node packages/sdk/test/smoke.cjs   (build the SDK first)
 */
const assert = require("node:assert");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const sdk = require("../dist/index.cjs");
const {
  PmAmmClient,
  deriveMarketPda,
  deriveYesMint,
  deriveNoMint,
  deriveMarketVault,
  deriveLpPosition,
  deriveGroupPda,
  deriveVaultPda,
  deriveVaultCollateralPda,
  deriveCommitPositionPda,
  deriveVaultGroupPda,
  deriveVaultGroupCollateralPda,
  deriveCommitGroupPositionPda,
  deriveMetadataPda,
  phi,
  capitalPhi,
  priceFromReserves,
  poolValue,
  formatUsdc,
  expectedLegSeedBps,
} = sdk;

let passed = 0;
const eq = (a, b, msg) => {
  assert.ok(a.equals(b), msg);
  passed++;
};

(async () => {
  const programId = Keypair.generate().publicKey;
  const usdc = Keypair.generate().publicKey;
  const owner = Keypair.generate().publicKey;
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const client = PmAmmClient.readOnly(connection, programId, usdc);

  // 1. address override
  assert.ok(client.program.programId.equals(programId), "program.programId override");
  passed++;

  // 2. PDA parity — bound client helpers === pure functions
  const id = 123456;
  const market = client.marketPda(id);
  eq(market, deriveMarketPda(programId, id), "marketPda");
  eq(client.yesMint(market), deriveYesMint(programId, market), "yesMint");
  eq(client.noMint(market), deriveNoMint(programId, market), "noMint");
  eq(client.marketVault(market), deriveMarketVault(programId, market), "marketVault");
  eq(client.lpPosition(market, owner), deriveLpPosition(programId, market, owner), "lpPosition");
  eq(client.groupPda(id), deriveGroupPda(programId, id), "groupPda");
  eq(client.vaultPda(id), deriveVaultPda(programId, id), "vaultPda");
  const vault = client.vaultPda(id);
  eq(client.vaultCollateral(vault), deriveVaultCollateralPda(programId, vault), "vaultCollateral");
  eq(client.commitPosition(vault, owner), deriveCommitPositionPda(programId, vault, owner), "commitPosition");
  eq(client.vaultGroupPda(id), deriveVaultGroupPda(programId, id), "vaultGroupPda");
  const vg = client.vaultGroupPda(id);
  eq(client.vaultGroupCollateral(vg), deriveVaultGroupCollateralPda(programId, vg), "vaultGroupCollateral");
  eq(client.commitGroupPosition(vg, owner), deriveCommitGroupPositionPda(programId, vg, owner), "commitGroupPosition");
  eq(client.metadataPda(client.yesMint(market)), deriveMetadataPda(client.yesMint(market)), "metadataPda");

  // 3. instruction builders — one per category; all bound to the program id
  const builders = [
    ["initializeMarket", () => client.ix.initializeMarket({ authority: owner, marketId: id, endTs: 9_999_999_999, name: "M", initialPriceBps: 5000 })],
    ["swap", () => client.ix.swap({ signer: owner, market, direction: "usdcToYes", amountIn: 1_000_000, minOutput: 0 })],
    ["depositLiquidity", () => client.ix.depositLiquidity({ signer: owner, market, amount: 1_000_000 })],
    ["resolveMarket", () => client.ix.resolveMarket({ signer: owner, market, side: "yes" })],
    ["initializeGroupMarket", () => client.ix.initializeGroupMarket({ authority: owner, groupId: id, endTs: 9_999_999_999, name: "G", legCount: 3 })],
    ["initializeVault", () => client.ix.initializeVault({ authority: owner, vaultId: id, name: "V", commitDurationSecs: 3600, marketDurationSecs: 86400, minTotal: 50_000_000 })],
    ["vaultCommit", () => client.ix.vaultCommit({ signer: owner, vault, side: "yes", amount: 5_000_000 })],
    ["initializeVaultGroup", () => client.ix.initializeVaultGroup({ authority: owner, vaultId: id, name: "VG", legNames: ["a", "b"], commitDurationSecs: 3600, marketDurationSecs: 86400, minTotal: 50_000_000 })],
  ];
  for (const [name, build] of builders) {
    const ix = await build();
    assert.ok(ix.programId.equals(programId), `ix.${name}.programId`);
    assert.ok(ix.keys.length > 0, `ix.${name} has accounts`);
    passed++;
  }

  // 4. math sanity
  assert.ok(Math.abs(phi(0) - 0.3989422804) < 1e-6, "phi(0)");
  assert.ok(Math.abs(capitalPhi(0) - 0.5) < 1e-6, "capitalPhi(0)");
  assert.ok(Math.abs(priceFromReserves(100, 100, 50) - 0.5) < 1e-6, "priceFromReserves symmetric");
  assert.ok(poolValue(0.5, 100) > 0, "poolValue positive");
  assert.strictEqual(formatUsdc(1_000_000), "1.00", "formatUsdc");
  assert.strictEqual(expectedLegSeedBps(4), 2500, "expectedLegSeedBps(4)");
  passed += 6;

  console.log(`✓ SDK test suite passed — ${passed} assertions`);
  console.log("  programId :", programId.toBase58());
})().catch((e) => {
  console.error("✗ SDK test failed:", e);
  process.exit(1);
});
