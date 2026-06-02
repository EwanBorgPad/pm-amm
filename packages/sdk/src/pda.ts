/**
 * Program-derived-address helpers — pure functions, each taking the program id
 * explicitly so the SDK has ONE source of truth (the app previously derived
 * PDAs from three different places: a constant, `program.idl.address`, and
 * `program.programId`).
 *
 * Seeds mirror `anchor/programs/pm_amm/src/state.rs` and the instruction
 * account structs. `PmAmmClient` exposes bound wrappers (no programId arg).
 */
import { PublicKey } from "@solana/web3.js";
import { u64SeedLE } from "./encoding";
import { SEEDS, METAPLEX_PROGRAM_ID } from "./constants";

const seed = (s: string) => Buffer.from(s);

// ----------------------------------------------------------------------------
// Binary market
// ----------------------------------------------------------------------------

export function deriveMarketPda(programId: PublicKey, marketId: number | bigint): PublicKey {
  return PublicKey.findProgramAddressSync([seed(SEEDS.MARKET), u64SeedLE(marketId)], programId)[0];
}

export function deriveYesMint(programId: PublicKey, market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([seed(SEEDS.YES_MINT), market.toBuffer()], programId)[0];
}

export function deriveNoMint(programId: PublicKey, market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([seed(SEEDS.NO_MINT), market.toBuffer()], programId)[0];
}

/** The market's USDC collateral vault token account (seed ["vault", market]). */
export function deriveMarketVault(programId: PublicKey, market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([seed(SEEDS.VAULT), market.toBuffer()], programId)[0];
}

export function deriveLpPosition(
  programId: PublicKey,
  market: PublicKey,
  owner: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [seed(SEEDS.LP), market.toBuffer(), owner.toBuffer()],
    programId,
  )[0];
}

// ----------------------------------------------------------------------------
// Multi-outcome group market
// ----------------------------------------------------------------------------

export function deriveGroupPda(programId: PublicKey, groupId: number | bigint): PublicKey {
  return PublicKey.findProgramAddressSync([seed(SEEDS.GROUP), u64SeedLE(groupId)], programId)[0];
}

// ----------------------------------------------------------------------------
// Commitment vault (binary, Sprint 22)
// ----------------------------------------------------------------------------

/** Commitment-vault account (seed ["vault", u64(vaultId)] — distinct id space
 *  from market vaults despite sharing the "vault" seed string). */
export function deriveVaultPda(programId: PublicKey, vaultId: number | bigint): PublicKey {
  return PublicKey.findProgramAddressSync([seed(SEEDS.VAULT), u64SeedLE(vaultId)], programId)[0];
}

export function deriveVaultCollateralPda(programId: PublicKey, vault: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [seed(SEEDS.VAULT_COLLATERAL), vault.toBuffer()],
    programId,
  )[0];
}

export function deriveCommitPositionPda(
  programId: PublicKey,
  vault: PublicKey,
  owner: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [seed(SEEDS.COMMIT), vault.toBuffer(), owner.toBuffer()],
    programId,
  )[0];
}

// ----------------------------------------------------------------------------
// Multi-outcome commitment vault (Sprint 23)
// ----------------------------------------------------------------------------

export function deriveVaultGroupPda(programId: PublicKey, vaultId: number | bigint): PublicKey {
  return PublicKey.findProgramAddressSync(
    [seed(SEEDS.VAULT_GROUP), u64SeedLE(vaultId)],
    programId,
  )[0];
}

export function deriveVaultGroupCollateralPda(programId: PublicKey, vault: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [seed(SEEDS.VAULT_GROUP_COLLATERAL), vault.toBuffer()],
    programId,
  )[0];
}

export function deriveCommitGroupPositionPda(
  programId: PublicKey,
  vault: PublicKey,
  owner: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [seed(SEEDS.COMMIT_GROUP), vault.toBuffer(), owner.toBuffer()],
    programId,
  )[0];
}

// ----------------------------------------------------------------------------
// Metaplex token metadata (derived under the Metaplex program, not pm-AMM)
// ----------------------------------------------------------------------------

export function deriveMetadataPda(
  mint: PublicKey,
  metaplexProgramId: PublicKey = METAPLEX_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [seed(SEEDS.METADATA), metaplexProgramId.toBuffer(), mint.toBuffer()],
    metaplexProgramId,
  )[0];
}
