#!/usr/bin/env bash
#
# Deploy pm-AMM to MAINNET-BETA. THIS SPENDS REAL SOL. Run from the repo root:
#   MAINNET_RPC_URL=... MAINNET_AUTHORITY_KEYPAIR=... bash anchor/scripts/deploy-mainnet.sh
#
# The program keeps the SAME ID as devnet (GV1F…): declare_id! is compiled into
# the .so, and clusters are isolated, so reusing the ID is safe and avoids a
# dedicated mainnet rebuild.
#
# Required env vars:
#   MAINNET_RPC_URL            — your mainnet RPC endpoint (NOT the rate-limited public one)
#   MAINNET_AUTHORITY_KEYPAIR  — path to the FUNDED deployer keypair (also becomes the
#                                upgrade authority). Generate a fresh, dedicated one:
#                                  solana-keygen new -o ~/.config/solana/pm-amm-mainnet.json
#                                then fund it with ~10 SOL.
set -euo pipefail

: "${MAINNET_RPC_URL:?set MAINNET_RPC_URL to your mainnet RPC endpoint}"
: "${MAINNET_AUTHORITY_KEYPAIR:?set MAINNET_AUTHORITY_KEYPAIR to the funded deployer keypair path}"

SO="anchor/target/deploy/pm_amm.so"
PROGRAM_KP="anchor/target/deploy/pm_amm-keypair.json"

[ -f "$SO" ] || { echo "ERROR: missing $SO — run 'pnpm run build' first."; exit 1; }
[ -f "$PROGRAM_KP" ] || { echo "ERROR: missing $PROGRAM_KP (program-id keypair)."; exit 1; }
[ -f "$MAINNET_AUTHORITY_KEYPAIR" ] || { echo "ERROR: missing keypair $MAINNET_AUTHORITY_KEYPAIR"; exit 1; }

AUTH_PUBKEY=$(solana-keygen pubkey "$MAINNET_AUTHORITY_KEYPAIR")
PROGRAM_ID=$(solana-keygen pubkey "$PROGRAM_KP")
BAL=$(solana balance "$AUTH_PUBKEY" --url "$MAINNET_RPC_URL" 2>/dev/null || echo "unknown")

echo "──────────────────────────────────────────────"
echo " MAINNET-BETA deploy (REAL SOL)"
echo " Program ID:        $PROGRAM_ID"
echo " Upgrade authority: $AUTH_PUBKEY"
echo " Authority balance: $BAL"
echo " RPC:               $MAINNET_RPC_URL"
echo " .so size:          $(wc -c < "$SO") bytes"
echo "──────────────────────────────────────────────"
read -r -p "Type 'DEPLOY MAINNET' to confirm: " CONFIRM
[ "$CONFIRM" = "DEPLOY MAINNET" ] || { echo "Aborted."; exit 1; }

solana program deploy "$SO" \
  --program-id "$PROGRAM_KP" \
  --keypair "$MAINNET_AUTHORITY_KEYPAIR" \
  --upgrade-authority "$MAINNET_AUTHORITY_KEYPAIR" \
  --url "$MAINNET_RPC_URL"

echo
echo "Deployed. Verify the upgrade authority:"
echo "  solana program show $PROGRAM_ID --url \"$MAINNET_RPC_URL\""
echo
echo "Next: set the Vercel production env vars (see app/.env.mainnet.example) and"
echo "redeploy the front. Do NOT set MINT_AUTHORITY_KEY on mainnet."
