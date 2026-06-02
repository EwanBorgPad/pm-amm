/**
 * @pm-amm/sdk — TypeScript SDK for the pm-AMM Solana program.
 *
 * Public surface (filled out across the SDK build phases):
 *   - `PmAmmClient`        — bound to a deployment {connection, programId, collateralMint}
 *   - PDA derivations      — pure `derive*(programId, …)` helpers
 *   - reads                — typed account fetchers
 *   - instruction builders — composable `TransactionInstruction` factories (26 ix)
 *   - send / flows         — convenience wrappers + multi-tx orchestrations
 *   - math                 — pure float-64 pricing/LP helpers (also at `@pm-amm/sdk/math`)
 *   - types / constants / IDL
 */

export * from "./math";
export * from "./constants";
export * from "./encoding";
export * from "./pda";
export * from "./types/accounts";
export * from "./types/args";
export * from "./ix";
export * from "./errors";
export { PmAmmClient, type PmAmmConfig } from "./client";
export { type SendApi } from "./send";
export { type FlowsApi, type GroupCreateResult, type ClaimableLeg } from "./flows";
