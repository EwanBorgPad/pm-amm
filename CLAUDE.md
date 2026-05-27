# PM-AMM — Paradigm Dynamic pm-AMM on Solana

## Project

Production implementation of the Paradigm pm-AMM paper (Moallemi & Robinson, Nov 2024).
Built for the $PREDICT hackathon. Deadline: April 26, 2026.

## Devnet

### This fork (Sprint 21 — multi-outcome + custom seed)
- **Program ID**: `Dxf1PDY1sQjy3qEkekiV26rDv3W6GdkQSKx6hLLf13nK`
- **USDC mock mint**: `EaMPVLBv3TjQNpzKs3oXaXL6XHJ8aVWLGXgtwunY2xGj` (mint authority = `6NG87…`)
- **Upgrade authority**: `6NG87yZrQw6zH6Au8fHbYcD7Dken5smAzisLeXazpt8E` (single-key — move to multisig before mainnet)

### Upstream (Matt's Sprint 20 — fully-backed, devnet only)
- **Program ID**: `8V872cTKfH1gC5zBvQhrQN2DXSmRNokPPjPsBE46MZNj` (Matt's deployment)
- **USDC mock mint**: `8m8VRDdvuxE4MQZBX8RqKMpuwqBYTQiME7n85Mw73j6A`
- Public IDL bundled with `mint_pair` + `swap_yes_no` — source not yet published on Matt's fork.

## Stack

- **On-chain**: Anchor (Rust), `anchor-spl`, `fixed` (I80F48)
- **Frontend**: Next.js (App Router) + TypeScript + Tailwind + shadcn/ui
- **Solana client**: `@anchor-lang/core`, `@solana/web3.js`, `@solana/wallet-adapter-*`
- **Package manager**: pnpm only
- **Versions**: always use latest stable — do not pin specific versions

## Commands

```bash
# From root — main aliases
pnpm run build         # Build program + IDL (anchor build + idl build)
pnpm run dev           # Frontend dev server (cd app && pnpm dev)
pnpm run deploy        # Deploy .so to devnet (program ID 8V872...)
pnpm run seed          # Seed devnet markets (scripts/seed-markets.ts)
pnpm run musdc         # Mint mock USDC on devnet

# Tests
pnpm run test          # Anchor integration tests on localnet (46 TS tests across
                       # pm_amm.ts + group_market.ts + access_control.ts)
pnpm run test:rust     # Rust unit tests only (60 tests: pm_math, accrual, state, group)
pnpm run test:all      # Rust + Python (pytest oracle + properties)

# Quality gates
pnpm run lint          # Prettier check + Next.js lint
pnpm run lint:fix      # Auto-fix
pnpm run type-check    # Frontend TS strict typecheck (cd app && pnpm tsc --noEmit)

# Direct (from anchor/)
cd anchor && anchor build --no-idl --ignore-keys         # builds .so (ignore declare_id/keypair mismatch)
cd anchor && cargo test --package pm_amm --lib           # all Rust unit
cd anchor && cargo test --package pm_amm --lib pm_math   # one module
cd anchor && cargo test --package pm_amm --lib -- --nocapture  # show println!

# Direct (Python oracle — no pytest dependency needed)
cd oracle && python3 test_oracle.py        # 112 tests (scipy reference)
cd oracle && python3 test_properties.py    # 24 tests (paper properties A-G)
```

### Test count (must stay green)

| Suite | Count | Run with |
|---|---|---|
| Rust unit | **60** | `pnpm run test:rust` |
| TS integration — `pm_amm.ts` (binary lifecycle) | **18** | `pnpm run test` (localnet) |
| TS integration — `group_market.ts` (5 group ix) | **22** | (same) |
| TS integration — `access_control.ts` | **6** | (same) |
| Python oracle | **112** | `python3 oracle/test_oracle.py` |
| Python properties | **24** | `python3 oracle/test_properties.py` |
| **Total (Rust + TS + Python)** | **242** | (collected manually) |

## Architecture

```
pm-amm/
  anchor/                # Anchor workspace
    programs/pm_amm/src/
      instructions/      # 10 binary + 5 group-market instructions (Sprint 21)
        group/           # initialize/attach/resolve/resolve_leg/cancel
      pm_math.rs         # Fixed-point math (phi, Phi, Phi_inv, reserves, swap)
      accrual.rs         # dC_t mechanism — LP residual redistribution
      state.rs           # Market, LpPosition, GroupMarket accounts
      errors.rs          # Error codes
      lib.rs             # Program entrypoint
    tests/               # pm_amm.ts + group_market.ts + access_control.ts
    scripts/             # Deploy + seed scripts
  app/                   # Next.js frontend
  oracle/                # Python reference oracle (scipy)
  doc/                   # Paper reference + sprint definitions
  scripts/               # check_idl_coherence.py (CI guard)
```

## Reference Paper

`doc/wp-para.md` — Paradigm pm-AMM (Moallemi & Robinson, Nov 2024)
Source of truth for ALL math. Always cross-check before implementing.

## Critical Math Invariants

- `(y-x)*Phi((y-x)/L_eff) + L_eff*phi((y-x)/L_eff) - y = 0` — dynamic invariant (paper section 8)
- `L_eff = L_0 * sqrt(T-t)` — effective liquidity (paper section 8)
- `x*(P) = L_eff * { Phi_inv(P)*P + phi(Phi_inv(P)) - Phi_inv(P) }` — eq. (5)
- `y*(P) = L_eff * { Phi_inv(P)*P + phi(Phi_inv(P)) }` — eq. (6)
- `V(P) = L_eff * phi(Phi_inv(P))` — pool value (section 7)
- `E[LVR_t] = V_0 / (2T)` — constant expected LVR (section 8)
- `E[W_T] = W_0 / 2` — terminal wealth (section 8)
- Conservation: everything goes to LPs (YES+NO tokens) or arbitrageurs (LVR)
- Vault solvency: `vault.usdc ≥ max(yes_supply, no_supply)` at all `t`, by construction of the
  curve + dC_t flow. Winners can always be paid 1 USDC per winning token. The `.min(vault.amount)`
  in `claim_winnings` is defensive coding for a case the math forbids — it should never fire.
- NEVER deviate from the paper's math spec without explicit approval

## Architecture (Sprint 21 — multi-outcome + custom seed)

This fork builds the multi-outcome extension on top of the Sprint 17/18 swap-based AMM (the
publicly-available upstream Rust source). Matt's Sprint 20 fully-backed model (`mint_pair` +
`swap_yes_no`) is documented in upstream README/IDL but the Rust source isn't published yet —
when it is, a follow-up sprint can adapt leg seeding to use `mint_pair` instead of `swap`.

- 6-direction `swap` (USDC↔YES, USDC↔NO, YES↔NO) — legacy pm-AMM model
- `Market::initial_price_bps` (range [100, 9900], 0 = legacy 50/50) — calibrates `L_0` at any seed price
- `GroupMarket` wraps N binary markets as legs of a categorical market
- 5 group instructions: `initialize_group_market`, `attach_leg_to_group`, `resolve_group`,
  `resolve_group_leg`, `cancel_group_market`
- Σ p_i invariant tracked via `GroupMarket::total_seeded_bps` (enforced ≤ 10_001 on attach,
  ≥ `10_000 - N - (10_000 % N)` on resolve — covers the exact worst-case underseed)
- `Market::group` is **write-once**: once attached, a market can only resolve via cascade
  (`resolve_group_leg`). No `detach` instruction yet.

## Current Sprint

Sprint 21 — Multi-outcome group markets + custom seed price (`doc/sprints/sprint-21-multi-outcome.md`)
ported onto upstream/main. Smoke-tested end-to-end on devnet program `Dxf1…` (binary market with
custom seed, 4-leg group, swap, expire, resolve, cascade, claim — all green).

## Rules

- EXACT formulas from the Paradigm paper
- If simplified: flag with `// SIMPLIFIED: <reason>`
- If ambiguous: choose simple + add comment
- Compute budget 400k CU on all mutative instructions
- Oracle out of scope (admin-only resolution for POC)
- Never use `rm` — use `trash` instead
- Strict TypeScript, max 70 lines per function
