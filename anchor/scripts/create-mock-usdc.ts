/**
 * Create your own mock USDC mint on the current cluster and mint a starting
 * balance to your wallet. Useful when you don't have access to Mattdgn's
 * MINT_AUTHORITY_KEY (e.g. when running the multi-outcome fork on devnet).
 *
 * Usage:
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   pnpm exec ts-node --transpile-only -P ./tsconfig.json scripts/create-mock-usdc.ts [amount=10000]
 *
 * After running:
 *   1. Copy the printed mint address.
 *   2. Set NEXT_PUBLIC_USDC_MINT=<address> in app/.env.local.
 *   3. Restart `pnpm dev`.
 */

import * as anchor from "@anchor-lang/core";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

async function main() {
  const amountUsd = parseFloat(process.argv[2] ?? "10000");
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payer = (provider.wallet as any).payer;
  const wallet = provider.wallet.publicKey;

  console.log("=== Create Mock USDC ===");
  console.log(`Cluster: ${provider.connection.rpcEndpoint}`);
  console.log(`Wallet:  ${wallet.toBase58()}`);
  console.log(`Amount:  ${amountUsd} USDC\n`);

  // 1. Create mint (decimals = 6, like real USDC)
  const mint = await createMint(provider.connection, payer, wallet, null, 6);
  console.log(`Mint created: ${mint.toBase58()}`);

  // 2. Create ATA + mint initial supply to wallet
  const ata = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    mint,
    wallet,
  );
  const lamports = Math.floor(amountUsd * 1e6);
  await mintTo(provider.connection, payer, mint, ata.address, payer, lamports);
  console.log(`Minted ${amountUsd} USDC to ${ata.address.toBase58()}\n`);

  console.log("=== Next steps ===");
  console.log(`Set in app/.env.local:`);
  console.log(`  NEXT_PUBLIC_USDC_MINT=${mint.toBase58()}`);
  console.log(
    `Then restart \`pnpm dev\` so the new constant is picked up by the client.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
