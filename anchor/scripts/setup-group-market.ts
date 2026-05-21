/**
 * Setup a multi-outcome GroupMarket end-to-end on the current cluster.
 *
 * 1. Creates N binary markets, each seeded at 10_000 / N bps (Σ p_i = 1 at open).
 * 2. Bootstraps each leg with a USDC deposit.
 * 3. Creates the GroupMarket wrapper.
 * 4. Attaches all N legs.
 * 5. Prints the group id + leg pubkeys so you can open /group/<id> in the UI.
 *
 * Usage:
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   pnpm exec ts-node --transpile-only -P ./tsconfig.json scripts/setup-group-market.ts \
 *     [legCount=5] [budgetPerLeg=50] [durationMin=60]
 */

import * as anchor from "@anchor-lang/core";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";

// USDC mint — env-driven so the script works against any fork.
// Set NEXT_PUBLIC_USDC_MINT in your env (or app/.env.local) to your own mint,
// e.g. one created by scripts/create-mock-usdc.ts.
const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT ||
    process.env.USDC_MINT ||
    "8m8VRDdvuxE4MQZBX8RqKMpuwqBYTQiME7n85Mw73j6A",
);
const TOKEN_METADATA_PROGRAM = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

async function main() {
  const legCount = parseInt(process.argv[2] ?? "5", 10);
  const budgetPerLegUsd = parseFloat(process.argv[3] ?? "50");
  const durationMin = parseFloat(process.argv[4] ?? "60");

  if (legCount < 2 || legCount > 32) {
    throw new Error("legCount must be between 2 and 32");
  }

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const idl = require("../../app/src/lib/pm_amm_idl.json");
  const program = new anchor.Program(idl, provider);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wallet = provider.wallet.publicKey;

  // 10_000 / N — must match GroupMarket::expected_leg_initial_price_bps
  const legBps = Math.floor(10_000 / legCount);

  console.log("=== pm-AMM GroupMarket Setup ===");
  console.log(`Cluster: ${provider.connection.rpcEndpoint}`);
  console.log(`Wallet: ${wallet.toBase58()}`);
  console.log(`Program: ${program.programId.toBase58()}`);
  console.log(`Legs: ${legCount}  ·  seed = ${legBps} bps each`);
  console.log(`Budget/leg: ${budgetPerLegUsd} USDC`);
  console.log(`Duration: ${durationMin} min\n`);

  const now = Math.floor(Date.now() / 1000);
  const endTs = now + Math.floor(durationMin * 60);
  const baseId = Date.now() % 1_000_000_000;
  const groupId = baseId;

  // ────────────────────────────────────────────────────────────
  // 1. Create the GroupMarket wrapper
  // ────────────────────────────────────────────────────────────
  const [groupPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("group"), new anchor.BN(groupId).toArrayLike(Buffer, "le", 8)],
    program.programId,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (program.methods as any)
    .initializeGroupMarket(
      new anchor.BN(groupId),
      new anchor.BN(endTs),
      `Group #${groupId}`,
      legCount,
    )
    .accounts({
      authority: wallet,
      groupMarket: groupPda,
      systemProgram: SystemProgram.programId,
    })
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ])
    .rpc();
  console.log(`Created group: ${groupPda.toBase58()} (id ${groupId})\n`);

  // ────────────────────────────────────────────────────────────
  // 2. Create each leg market + deposit + attach
  // ────────────────────────────────────────────────────────────
  const legMarketIds: number[] = [];
  for (let i = 0; i < legCount; i++) {
    const marketId = baseId + 1 + i; // unique per leg
    legMarketIds.push(marketId);
    await createAndAttachLeg(
      program,
      wallet,
      marketId,
      groupId,
      groupPda,
      endTs,
      i,
      legCount,
      legBps,
      budgetPerLegUsd,
    );
  }

  console.log("\n=== Setup complete ===");
  console.log(`Group PDA: ${groupPda.toBase58()}`);
  console.log(`Group ID:  ${groupId}`);
  console.log(`Open in UI: /group/${groupId}`);
  console.log(`Leg market IDs: ${legMarketIds.join(", ")}`);
}

// Helper kept under 70 lines (CLAUDE.md rule).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createAndAttachLeg(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  program: any,
  wallet: PublicKey,
  marketId: number,
  groupId: number,
  groupPda: PublicKey,
  endTs: number,
  legIndex: number,
  legCount: number,
  legBps: number,
  budgetUsd: number,
): Promise<void> {
  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), new anchor.BN(marketId).toArrayLike(Buffer, "le", 8)],
    program.programId,
  );
  const [yesMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("yes_mint"), marketPda.toBuffer()],
    program.programId,
  );
  const [noMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("no_mint"), marketPda.toBuffer()],
    program.programId,
  );
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), marketPda.toBuffer()],
    program.programId,
  );
  const [yesMeta] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM.toBuffer(), yesMint.toBuffer()],
    TOKEN_METADATA_PROGRAM,
  );
  const [noMeta] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM.toBuffer(), noMint.toBuffer()],
    TOKEN_METADATA_PROGRAM,
  );

  const name = `Leg ${legIndex + 1} of ${legCount}`;
  console.log(`[leg ${legIndex}] ${name} (id ${marketId}, ${legBps} bps)`);

  await program.methods
    .initializeMarket(new anchor.BN(marketId), new anchor.BN(endTs), name, legBps)
    .accounts({
      authority: wallet,
      market: marketPda,
      collateralMint: USDC_MINT,
      yesMint,
      noMint,
      vault,
      yesMetadata: yesMeta,
      noMetadata: noMeta,
      tokenMetadataProgram: TOKEN_METADATA_PROGRAM,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ])
    .rpc();

  await depositAndAttach(program, wallet, marketPda, vault, groupPda, legIndex, budgetUsd);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function depositAndAttach(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  program: any,
  wallet: PublicKey,
  marketPda: PublicKey,
  vault: PublicKey,
  groupPda: PublicKey,
  legIndex: number,
  budgetUsd: number,
): Promise<void> {
  const lamports = Math.floor(budgetUsd * 1e6);
  const userUsdc = await getAssociatedTokenAddress(USDC_MINT, wallet);
  const [lpPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("lp"), marketPda.toBuffer(), wallet.toBuffer()],
    program.programId,
  );

  await program.methods
    .depositLiquidity(new anchor.BN(lamports))
    .accounts({
      signer: wallet,
      market: marketPda,
      collateralMint: USDC_MINT,
      vault,
      userCollateral: userUsdc,
      lpPosition: lpPda,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ])
    .rpc();

  await program.methods
    .attachLegToGroup(legIndex)
    .accounts({
      authority: wallet,
      groupMarket: groupPda,
      market: marketPda,
    })
    .rpc();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
