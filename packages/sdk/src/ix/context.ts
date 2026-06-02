/**
 * Shared context passed to every instruction builder: the typed Anchor program
 * plus the per-deployment ids the builders need to derive PDAs and fill the
 * fixed program accounts.
 */
import { BN, type Program } from "@anchor-lang/core";
import type { PublicKey } from "@solana/web3.js";
import type { PmAmm } from "../idl/pm_amm";

export interface IxContext {
  program: Program<PmAmm>;
  programId: PublicKey;
  collateralMint: PublicKey;
  metaplexProgramId: PublicKey;
}

/** Normalize any numeric id/amount into a BN (BN.toString() round-trips cleanly). */
export function bn(x: BN | number | bigint): BN {
  return new BN(x.toString());
}
