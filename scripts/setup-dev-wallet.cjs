/**
 * DEV-ONLY: generate a throwaway devnet keypair, fund it with a little SOL for
 * gas (from ~/.config/solana/id.json), and write its secret into app/.env.local
 * as NEXT_PUBLIC_DEV_WALLET_SECRET so the headless dev-wallet adapter can drive
 * the UI in E2E. Prints only the pubkey — never the secret. Throwaway key only.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} = require("@solana/web3.js");

(async () => {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const funder = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json")))),
  );
  const dev = Keypair.generate();
  const secret = JSON.stringify(Array.from(dev.secretKey));

  // Fund 0.5 SOL for gas.
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: funder.publicKey,
      toPubkey: dev.publicKey,
      lamports: Math.floor(0.5 * LAMPORTS_PER_SOL),
    }),
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [funder]);

  // Upsert NEXT_PUBLIC_DEV_WALLET_SECRET in app/.env.local (gitignored).
  const envPath = path.join(__dirname, "..", "app", ".env.local");
  let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const line = `NEXT_PUBLIC_DEV_WALLET_SECRET=${secret}`;
  if (/^NEXT_PUBLIC_DEV_WALLET_SECRET=.*$/m.test(env)) {
    env = env.replace(/^NEXT_PUBLIC_DEV_WALLET_SECRET=.*$/m, line);
  } else {
    env = env.replace(/\s*$/, "") + `\n\n# DEV-ONLY throwaway keypair for headless UI E2E (gitignored)\n${line}\n`;
  }
  fs.writeFileSync(envPath, env);

  const bal = await connection.getBalance(dev.publicKey);
  console.log("dev wallet pubkey:", dev.publicKey.toBase58());
  console.log("funded SOL:", bal / LAMPORTS_PER_SOL, "(fund sig", sig.slice(0, 8) + "…)");
  console.log("secret written to app/.env.local as NEXT_PUBLIC_DEV_WALLET_SECRET (hidden)");
})().catch((e) => {
  console.error("FAILED:", e.message || String(e));
  process.exit(1);
});
