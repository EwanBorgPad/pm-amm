import { PublicKey } from "@solana/web3.js";
import { BN } from "@anchor-lang/core";
import { PROGRAM_ID } from "./constants";

/**
 * Encode a u64 id as a little-endian 8-byte Buffer for PDA seeds.
 * Uses BN rather than Buffer.writeBigUInt64LE because the Buffer polyfill
 * shipped to the browser by Next.js doesn't expose writeBigUInt64LE
 * (it's a Node-only method).
 */
function u64SeedLE(id: number | bigint): Buffer {
  return new BN(id.toString()).toArrayLike(Buffer, "le", 8);
}

export function deriveYesMint(market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("yes_mint"), market.toBuffer()],
    PROGRAM_ID,
  )[0];
}

export function deriveNoMint(market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("no_mint"), market.toBuffer()],
    PROGRAM_ID,
  )[0];
}

export function deriveVault(market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], PROGRAM_ID)[0];
}

export function deriveLpPosition(market: PublicKey, user: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("lp"), market.toBuffer(), user.toBuffer()],
    PROGRAM_ID,
  )[0];
}

export function deriveMarketPda(marketId: number | bigint): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), u64SeedLE(marketId)],
    PROGRAM_ID,
  )[0];
}

// ============================================================================
// Multi-outcome group market PDAs (matches state.rs::GroupMarket::SEED)
// ============================================================================

export function deriveGroupPda(groupId: number | bigint): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("group"), u64SeedLE(groupId)],
    PROGRAM_ID,
  )[0];
}
