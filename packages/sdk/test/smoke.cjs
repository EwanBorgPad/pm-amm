/**
 * SDK smoke test — no network, no SOL spent. Verifies the three things most
 * likely to break: the per-deployment address override, PDA parity between the
 * client and the pure helpers, and that an ix builder emits an instruction
 * bound to the right program id.
 *
 * Runs against the CJS build (`dist/index.cjs`) so plain Node can execute it;
 * the Next app consumes the ESM build through its bundler.
 *
 *   node packages/sdk/test/smoke.cjs   (build the SDK first)
 */
const assert = require("node:assert");
const { Connection, Keypair } = require("@solana/web3.js");
const { PmAmmClient, deriveMarketPda, phi } = require("../dist/index.cjs");

(async () => {
  const programId = Keypair.generate().publicKey;
  const usdc = Keypair.generate().publicKey;
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const client = PmAmmClient.readOnly(connection, programId, usdc);

  // 1. The bundled IDL address is overridden with this deployment's program id.
  assert.ok(client.program.programId.equals(programId), "program.programId == programId");
  assert.ok(client.programId.equals(programId), "client.programId == programId");

  // 2. PDA parity: bound helper === pure function.
  const marketId = 123456;
  assert.ok(
    client.marketPda(marketId).equals(deriveMarketPda(programId, marketId)),
    "marketPda parity",
  );

  // 3. An instruction builder emits an instruction bound to the program id.
  const ix = await client.ix.initializeMarket({
    authority: Keypair.generate().publicKey,
    marketId,
    endTs: 9_999_999_999,
    name: "Smoke market",
    initialPriceBps: 5000,
  });
  assert.ok(ix.programId.equals(programId), "ix.programId == programId");
  assert.ok(ix.keys.length > 0, "ix has account metas");

  // 4. Pure math export works.
  assert.ok(Math.abs(phi(0) - 0.3989422804) < 1e-6, "phi(0)");

  console.log("✓ SDK smoke test passed");
  console.log("  programId :", programId.toBase58());
  console.log("  marketPda :", client.marketPda(marketId).toBase58());
  console.log("  init ix accounts:", ix.keys.length);
})().catch((e) => {
  console.error("✗ smoke test failed:", e);
  process.exit(1);
});
