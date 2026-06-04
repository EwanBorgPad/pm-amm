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
# Optional MAINNET_MAX_LEN: tighter programdata allocation = ~half the rent
# (~9 SOL instead of ~18 for this binary). Trade-off: an upgrade that GROWS the
# .so past this size needs `solana program extend` first. Unquoted on purpose so
# it word-splits to 0 or 2 args (works on bash 3.2 under `set -u`).
MAXLEN_FLAG=""
if [ -n "${MAINNET_MAX_LEN:-}" ]; then
  MAXLEN_FLAG="--max-len ${MAINNET_MAX_LEN}"
  echo " max-len:           ${MAINNET_MAX_LEN} bytes (tighter rent, limited upgrade headroom)"
else
  echo " max-len:           default (2x program size — full upgrade headroom, ~2x rent)"
fi
# Priority fee (micro-lamports/CU): mainnet writes need this to land under
# congestion — without it the deploy fails with "Max retries exceeded".
PRIORITY_FEE="${MAINNET_PRIORITY_FEE:-200000}"
echo " priority fee:      ${PRIORITY_FEE} micro-lamports/CU"
echo "──────────────────────────────────────────────"
read -r -p "Type 'DEPLOY MAINNET' to confirm: " CONFIRM
[ "$CONFIRM" = "DEPLOY MAINNET" ] || { echo "Aborted."; exit 1; }

# --use-rpc + priority fee + extra sign attempts: required for the writes to land
# on a congested mainnet (without them the deploy fails with "Max retries
# exceeded"). If it still fails mid-write, the CLI prints a buffer address + a
# `solana program close <buffer>` command to reclaim the SOL; rerun with that
# buffer keypair via `--buffer` to resume only the missing chunks (no extra rent).
solana program deploy "$SO" \
  --program-id "$PROGRAM_KP" \
  --keypair "$MAINNET_AUTHORITY_KEYPAIR" \
  --upgrade-authority "$MAINNET_AUTHORITY_KEYPAIR" \
  $MAXLEN_FLAG \
  --use-rpc \
  --with-compute-unit-price "$PRIORITY_FEE" \
  --max-sign-attempts 80 \
  --url "$MAINNET_RPC_URL"

echo
echo "Deployed. Verify the upgrade authority:"
echo "  solana program show $PROGRAM_ID --url \"$MAINNET_RPC_URL\""
echo
echo "Next: set the Vercel production env vars (see app/.env.mainnet.example) and"
echo "redeploy the front. Do NOT set MINT_AUTHORITY_KEY on mainnet."
