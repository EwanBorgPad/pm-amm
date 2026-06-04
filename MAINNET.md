# Mainnet-beta deployment guide

This is a **trust-based POC going live with real money**. The following risks are
**knowingly accepted** by the operator (they are NOT fixed):

1. **Centralized resolution** — whoever holds resolution authority picks the
   winning side and can drain via `claim_winnings`. No oracle, no timelock, no
   dispute, no permissionless fallback (audit findings #2/#3).
2. **Single-key upgrade authority** — that key can replace the program and drain
   every vault. No multisig.
3. **No third-party security audit.**
4. **Multi-outcome Σ pᵢ = 1** is only enforced at seed and at resolution; between
   trades it is left to arbitrage.

The program itself is **collateral-agnostic** (it never mints USDC, only the
program-owned YES/NO tokens), so moving to real USDC needs **no on-chain code
change** — only configuration + a deploy.

---

## 1. Build the program

```bash
pnpm run build          # produces anchor/target/deploy/pm_amm.so (+ IDL/types)
pnpm run test:rust      # 73 unit tests must be green
```

## 2. Create + fund the mainnet authority key

Generate a **fresh, dedicated** keypair (do NOT reuse the devnet key). Keep its
secret safe — it controls every vault.

```bash
solana-keygen new -o ~/.config/solana/pm-amm-mainnet.json
solana-keygen pubkey ~/.config/solana/pm-amm-mainnet.json   # note the address
# Fund it with ~10 SOL of REAL SOL (program account + upgrade buffer for a ~1.3 MB .so).
```

## 3. Deploy to mainnet (spends real SOL)

The program keeps the **same ID as devnet** (`GV1F…`) — `declare_id!` is compiled
in and clusters are isolated. The program-id keypair is already at
`anchor/target/deploy/pm_amm-keypair.json`.

```bash
MAINNET_RPC_URL="https://your-dedicated-mainnet-rpc" \
MAINNET_AUTHORITY_KEYPAIR="$HOME/.config/solana/pm-amm-mainnet.json" \
pnpm run deploy:mainnet
```

The script prints the program ID, authority, and balance, then asks you to type
`DEPLOY MAINNET` to confirm. Afterwards, verify the authority:

```bash
solana program show GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y --url "$MAINNET_RPC_URL"
```

## 4. Point the front at mainnet (Vercel Production env)

Set these in the Vercel project (see `app/.env.mainnet.example`):

| Var | Value |
|---|---|
| `NEXT_PUBLIC_SOLANA_CLUSTER` | `mainnet-beta` |
| `NEXT_PUBLIC_PROGRAM_ID` | `GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y` |
| `NEXT_PUBLIC_USDC_MINT` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| `NEXT_PUBLIC_RPC_URL` | your dedicated mainnet RPC |

**Do NOT set `MINT_AUTHORITY_KEY`** — the faucet is hard-disabled on mainnet (the
button is hidden and the API returns 503). Real USDC is not mintable.

Redeploy the front. The first swap on any market will create the protocol-DAO and
creator fee ATAs automatically.

## 5. Smoke-test with tiny amounts first

Before announcing: create one market, deposit a few real USDC, do a small swap
(check the 2% fee lands at the DAO + creator), resolve, and claim — all with
amounts you can afford to lose. Then verify vault solvency on-chain.

---

## What stays solid

The pm-AMM engine: paper-faithful math, the audit-#1 full-collateralization fix
(+ on-chain solvency guard on every swap), vault liveness (#4/#5), committers=LPs
(#6), and 266 tests. **Within honest operation, funds are mechanically safe.** The
gap is purely the trust/governance layer enumerated at the top.
