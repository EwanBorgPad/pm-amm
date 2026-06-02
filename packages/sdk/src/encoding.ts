/**
 * Low-level encoding helpers shared by PDA derivation and account decoding.
 * Browser-safe: no Node-only Buffer methods.
 */
import { BN } from "@anchor-lang/core";

/**
 * Encode a u64 id as a little-endian 8-byte Buffer for PDA seeds.
 *
 * Uses BN rather than `Buffer.writeBigUInt64LE` because the Buffer polyfill
 * shipped to browsers by bundlers (Next.js, Vite, …) doesn't expose
 * `writeBigUInt64LE` — it's a Node-only method.
 */
export function u64SeedLE(id: number | bigint): Buffer {
  return new BN(id.toString()).toArrayLike(Buffer, "le", 8);
}

/** Decode a fixed-size `[u8; N]` name field into UTF-8, stripping trailing zeros. */
export function decodeName(nameBytes: number[] | undefined): string {
  const arr = nameBytes ?? [];
  const end = arr.indexOf(0);
  return new TextDecoder().decode(new Uint8Array(end >= 0 ? arr.slice(0, end) : arr));
}

/**
 * Generate a 48-bit random id (fits in a JS `number`, unpredictable).
 * Used for market / vault / group ids to avoid front-running by id guessing.
 * Works in the browser and in Node 18+ (global Web Crypto `crypto`).
 */
export function randomU48(): number {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let n = 0;
  for (let i = 0; i < 6; i++) n = n * 256 + bytes[i];
  return n;
}
