#!/usr/bin/env node
/**
 * Sync the Anchor-generated IDL + TS types from `anchor/target` into the
 * places that consume them:
 *   - idl/pm_amm.json                       (repo-root canonical copy)
 *   - packages/sdk/src/idl/pm_amm.json      (SDK runtime IDL — bundled by tsup)
 *   - packages/sdk/src/idl/pm_amm.ts        (SDK Program<PmAmm> type)
 *
 * Run after every `anchor build` / `anchor idl build` (and after a program-id
 * change) so the SDK and the on-chain program never drift.
 *
 * Usage:  node scripts/sync-idl.mjs        (from repo root, or via `pnpm run sync:idl`)
 */
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const copies = [
  ["anchor/target/idl/pm_amm.json", "idl/pm_amm.json"],
  ["anchor/target/idl/pm_amm.json", "packages/sdk/src/idl/pm_amm.json"],
  ["anchor/target/types/pm_amm.ts", "packages/sdk/src/idl/pm_amm.ts"],
];

let copied = 0;
for (const [from, to] of copies) {
  const src = resolve(root, from);
  const dst = resolve(root, to);
  if (!existsSync(src)) {
    console.error(`! source missing, skipping: ${from}`);
    continue;
  }
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  console.log(`✓ ${from} → ${to}`);
  copied++;
}

console.log(`\nsync-idl: ${copied}/${copies.length} files copied.`);
if (copied === 0) process.exit(1);
