import { NextResponse } from "next/server";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  createMintToInstruction,
} from "@solana/spl-token";

const AMOUNT = 1000_000_000; // 1000 mUSDC

export async function POST(req: Request) {
  // Hard-disable on mainnet: real USDC has no mint authority, so the faucet is
  // meaningless there (and we must never wire a mint authority for real funds).
  if (process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "mainnet-beta") {
    return NextResponse.json(
      { error: "Faucet disabled on mainnet (real USDC is not mintable)" },
      { status: 503 },
    );
  }
  const keyB64 = process.env.MINT_AUTHORITY_KEY;
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
  // Read the USDC mint from env so the faucet matches the fork's deployment.
  // Falls back to Matt's devnet mint if the env var is unset, for back-compat.
  const usdcMintStr =
    process.env.NEXT_PUBLIC_USDC_MINT || "3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ";
  const USDC_MINT = new PublicKey(usdcMintStr);

  if (!keyB64) {
    return NextResponse.json({ error: "Faucet not configured" }, { status: 503 });
  }

  const { wallet } = (await req.json()) as { wallet: string };
  if (!wallet) {
    return NextResponse.json({ error: "Missing wallet" }, { status: 400 });
  }

  try {
    const recipient = new PublicKey(wallet);
    const authority = Keypair.fromSecretKey(Buffer.from(keyB64, "base64"));
    const connection = new Connection(rpcUrl, "confirmed");

    const ata = await getAssociatedTokenAddress(USDC_MINT, recipient);
    const tx = new Transaction();

    // Create ATA if needed
    const ataInfo = await connection.getAccountInfo(ata);
    if (!ataInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(authority.publicKey, ata, recipient, USDC_MINT),
      );
    }

    // Mint 1000 mUSDC
    tx.add(createMintToInstruction(USDC_MINT, ata, authority.publicKey, AMOUNT));

    tx.feePayer = authority.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(authority);

    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(sig, "confirmed");

    return NextResponse.json({ ok: true, signature: sig, amount: AMOUNT / 1e6 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg.slice(0, 200) }, { status: 500 });
  }
}
