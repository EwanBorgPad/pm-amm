# PM-AMM — Paradigm Dynamic pm-AMM on Solana

## Project

Production implementation of the Paradigm pm-AMM paper (Moallemi & Robinson, Nov 2024).
Built for the $PREDICT hackathon. Deadline: April 26, 2026.

## Devnet

- **Program ID**: `8V872cTKfH1gC5zBvQhrQN2DXSmRNokPPjPsBE46MZNj`
- **Explorer**: https://explorer.solana.com/address/8V872cTKfH1gC5zBvQhrQN2DXSmRNokPPjPsBE46MZNj?cluster=devnet
- **USDC mock mint**: `8m8VRDdvuxE4MQZBX8RqKMpuwqBYTQiME7n85Mw73j6A`

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
pnpm run test          # Anchor integration tests on localnet (18 TS tests)
pnpm run test:rust     # Rust unit tests only (62 tests: pm_math, accrual, state)
pnpm run test:all      # Rust + Python (pytest oracle + properties)

# Quality gates
pnpm run lint          # Prettier check + Next.js lint
pnpm run lint:fix      # Auto-fix
pnpm run type-check    # Frontend TS strict typecheck (cd app && pnpm tsc --noEmit)

# Direct (from anchor/)
cd anchor && anchor build --no-idl -- --tools-version v1.52
cd anchor && cargo test --package pm_amm                 # all Rust unit
cd anchor && cargo test --package pm_amm pm_math         # one module
cd anchor && cargo test --package pm_amm -- --nocapture  # show println!

# Direct (Python oracle — no pytest dependency needed)
cd oracle && python3 test_oracle.py        # 112 tests (scipy reference)
cd oracle && python3 test_properties.py    # 24 tests (paper properties A-G)
```

### Test count (must stay green)

| Suite | Count | Run with |
|---|---|---|
| Rust unit | **62** | `pnpm run test:rust` |
| TS integration | **18** | `pnpm run test` (localnet required) |
| Python oracle | **112** | `python3 oracle/test_oracle.py` |
| Python properties | **24** | `python3 oracle/test_properties.py` |
| **Total** | **216** | `pnpm run test:all` (skips TS) |

## Architecture

```
pm-amm/
  anchor/                # Anchor workspace
    programs/pm_amm/src/
      instructions/      # 11 Anchor instructions (Sprint 20: + mint_pair, swap → swap_yes_no)
      pm_math.rs         # Fixed-point math (phi, Phi, Phi_inv, reserves, swap)
      accrual.rs         # dC_t mechanism — LP residual redistribution
      state.rs           # Market, LpPosition accounts
      errors.rs          # Error codes
      lib.rs             # Program entrypoint
    tests/               # TypeScript integration tests
    scripts/             # Deploy + seed scripts
  app/                   # Next.js frontend
  oracle/                # Python reference oracle (scipy)
  doc/                   # Paper reference
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
- **Sprint 20 invariant**: `vault.usdc == yes_mint.supply == no_mint.supply` (fully-backed outcome tokens, Polymarket-style). Any instruction touching vault/supplies must preserve this.
- NEVER deviate from the paper's math spec without explicit approval

## Architecture (Sprint 20 — fully-backed)

- `swap_yes_no` is **pure YES↔NO** on the pm-AMM curve (no vault, no mint/burn). 2 directions only.
- USDC↔YES/NO trades are built client-side as atomic ix combos:
  - **BUY** = `mint_pair(δ)` (USDC → δ YES + δ NO) + `swap_yes_no` (swap the unwanted side)
  - **SELL** = `swap_yes_no` (rebalance to a pair) + `redeem_pair(δ)` (δ YES + δ NO → USDC)
- Pool reserves live in `pool_yes`/`pool_no` ATAs owned by the Market PDA.

## Current Sprint

Sprint 20 — Fully-Backed Outcome Tokens (`doc/sprints/sprint-20-fully-backed-architecture.md`) — supersedes Sprint 18. **Deployed on devnet 27 avr 2026** (slot 458322526).

## Rules

- EXACT formulas from the Paradigm paper
- If simplified: flag with `// SIMPLIFIED: <reason>`
- If ambiguous: choose simple + add comment
- Compute budget 400k CU on all mutative instructions
- Oracle out of scope (admin-only resolution for POC)
- Never use `rm` — use `trash` instead
- Strict TypeScript, max 70 lines per function
