// Anchor's #[program] macro generates code that triggers these lints
// Anchor 1.0 #[program] macro generates unexpected cfgs
#![allow(unexpected_cfgs)]
// Anchor's #[program] macro and generated LUT code trigger these clippy lints
#![allow(
    clippy::diverging_sub_expression,
    clippy::too_many_arguments,
    clippy::assign_op_pattern,
    clippy::manual_range_contains,
    clippy::excessive_precision,
    clippy::unreadable_literal,
    clippy::large_const_arrays,
    clippy::wrong_self_convention
)]

//! # pm-AMM — Paradigm Dynamic AMM for Prediction Markets
//!
//! Faithful implementation of the pm-AMM paper by Moallemi & Robinson (Paradigm, Nov 2024).
//! Uses a time-decaying liquidity function `L_eff = L_0 * sqrt(T - t)` to achieve
//! uniform LVR in both price and time, with continuous LP yield via the dC_t mechanism.
//!
//! See: <https://www.paradigm.xyz/2024/11/pm-amm>

pub mod accrual;
pub mod errors;
pub mod instructions;
pub mod lut;
pub mod pm_math;
pub mod state;

use anchor_lang::prelude::*;

pub use instructions::*;
pub use state::*;

declare_id!("Dxf1PDY1sQjy3qEkekiV26rDv3W6GdkQSKx6hLLf13nK");

#[program]
pub mod pm_amm {
    use super::*;

    /// Create a new prediction market with YES/NO mints, a USDC vault,
    /// and Metaplex token metadata for wallet display.
    ///
    /// `initial_price_bps` seeds the YES price at first deposit. Pass `0` for
    /// the legacy 50/50 default. For multi-outcome groups, pass `10_000 / N`.
    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        market_id: u64,
        end_ts: i64,
        name: String,
        initial_price_bps: u16,
    ) -> Result<()> {
        instructions::initialize_market::handler(ctx, market_id, end_ts, name, initial_price_bps)
    }

    /// Deposit USDC as liquidity. First deposit bootstraps L_0 at 50/50 price.
    /// Subsequent deposits scale L_0 proportionally to preserve the current price.
    pub fn deposit_liquidity(ctx: Context<DepositLiquidity>, amount: u64) -> Result<()> {
        instructions::deposit_liquidity::handler(ctx, amount)
    }

    /// Swap between USDC, YES, and NO tokens (6 directions).
    /// Updates reserves and enforces the pm-AMM invariant.
    pub fn swap(
        ctx: Context<Swap>,
        direction: SwapDirection,
        amount_in: u64,
        min_output: u64,
    ) -> Result<()> {
        instructions::swap::handler(ctx, direction, amount_in, min_output)
    }

    /// Withdraw LP shares: auto-claims pending residuals, then mints
    /// proportional YES+NO tokens from the pool reserves.
    pub fn withdraw_liquidity(ctx: Context<WithdrawLiquidity>, shares_to_burn: u128) -> Result<()> {
        instructions::withdraw_liquidity::handler(ctx, shares_to_burn)
    }

    /// Permissionless dC_t accrual. Anyone can trigger to release tokens
    /// from the pool as L_eff decreases over time.
    pub fn accrue(ctx: Context<Accrue>) -> Result<()> {
        instructions::accrue::handler(ctx)
    }

    /// Claim pending YES+NO residuals accrued to an LP position.
    /// Allowed at any time, including after resolution.
    pub fn claim_lp_residuals(ctx: Context<ClaimLpResiduals>) -> Result<()> {
        instructions::claim_lp_residuals::handler(ctx)
    }

    /// Burn 1 YES + 1 NO to receive 1 USDC. Always valid, pre- or post-resolution.
    pub fn redeem_pair(ctx: Context<RedeemPair>, amount: u64) -> Result<()> {
        instructions::redeem_pair::handler(ctx, amount)
    }

    /// View-only: compute the optimal L_0 for a given USDC budget.
    /// Emits a `LZeroSuggestion` event. Composable via CPI for auto-LP vaults.
    pub fn suggest_l_zero(
        ctx: Context<SuggestLZero>,
        budget_usdc: u64,
        sigma_bps: u64,
    ) -> Result<()> {
        instructions::suggest_l_zero::handler(ctx, budget_usdc, sigma_bps)
    }

    /// Resolve the market after expiration. Authority-only.
    /// Triggers final accrual and sets the winning side.
    pub fn resolve_market(ctx: Context<ResolveMarket>, winning_side: Side) -> Result<()> {
        instructions::resolve_market::handler(ctx, winning_side)
    }

    /// Burn all user tokens (winning + losing), pay winning side at 1 USDC each.
    /// Only callable post-resolution. Burns both sides atomically.
    pub fn claim_winnings(ctx: Context<ClaimWinnings>, amount: u64) -> Result<()> {
        instructions::claim_winnings::handler(ctx, amount)
    }

    // ========================================================================
    // Multi-outcome group market (EXTENSION over the Paradigm paper)
    // ========================================================================

    /// Create a GroupMarket wrapping `leg_count` binary markets as a
    /// categorical (multi-outcome) prediction market. Legs are attached
    /// separately via `attach_leg_to_group` and must each be seeded at
    /// `10_000 / leg_count` bps so Σ p_i = 1 at open.
    pub fn initialize_group_market(
        ctx: Context<InitializeGroupMarket>,
        group_id: u64,
        end_ts: i64,
        name: String,
        leg_count: u8,
    ) -> Result<()> {
        instructions::group::initialize_group_market::handler(
            ctx, group_id, end_ts, name, leg_count,
        )
    }

    /// Attach an existing binary Market PDA to a leg slot of a GroupMarket.
    /// Enforces same authority, same end_ts, and seed price = 10_000/N bps.
    pub fn attach_leg_to_group(ctx: Context<AttachLegToGroup>, leg_index: u8) -> Result<()> {
        instructions::group::attach_leg_to_group::handler(ctx, leg_index)
    }

    /// Resolve a GroupMarket: authority picks the winning leg.
    /// Must run after expiration and after all legs are attached.
    pub fn resolve_group(ctx: Context<ResolveGroup>, winning_leg: u8) -> Result<()> {
        instructions::group::resolve_group::handler(ctx, winning_leg)
    }

    /// Cascade-resolve one leg of a resolved GroupMarket. Permissionless:
    /// the group's `winning_leg` is the source of truth (winning → Yes,
    /// all others → No).
    pub fn resolve_group_leg(ctx: Context<ResolveGroupLeg>, leg_index: u8) -> Result<()> {
        instructions::group::resolve_group_leg::handler(ctx, leg_index)
    }

    /// Cancel an abandoned GroupMarket past expiration. Marks it resolved with
    /// `NO_WINNING_LEG`, so attached legs can then be finalized as `Side::No`
    /// via `resolve_group_leg`. Authority-only.
    pub fn cancel_group_market(ctx: Context<CancelGroupMarket>) -> Result<()> {
        instructions::group::cancel_group_market::handler(ctx)
    }

    // ========================================================================
    // Commitment Vault (Sprint 22 — permissionless bootstrap)
    // ========================================================================

    /// Open a new Commitment Vault. Anyone can call. Aggregates crowd commits
    /// before the market exists; the launch price is computed from the
    /// commit ratio.
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        vault_id: u64,
        name: String,
        commit_duration_secs: i64,
        market_duration_secs: i64,
        min_total: u64,
    ) -> Result<()> {
        instructions::vault::initialize_vault::handler(
            ctx,
            vault_id,
            name,
            commit_duration_secs,
            market_duration_secs,
            min_total,
        )
    }

    /// Commit USDC on YES or NO. Anyone, any number of times, until
    /// commit_end_ts. Min commit: 1 USDC.
    pub fn vault_commit(ctx: Context<Commit>, side: Side, amount: u64) -> Result<()> {
        instructions::vault::commit::handler(ctx, side, amount)
    }

    /// Launch the underlying pm-AMM market once commit_end_ts has passed and
    /// total ≥ min_total. Permissionless. The caller pays the rent of the
    /// new Market + mints + vault + Metaplex metadata accounts.
    pub fn launch_vault_market(ctx: Context<LaunchVaultMarket>, market_id: u64) -> Result<()> {
        instructions::vault::launch_vault_market::handler(ctx, market_id)
    }

    /// Committer claims back their USDC after launch. (v1: returns the commit
    /// 1:1; v2 will distribute LP shares of the launched market pro-rata.)
    pub fn claim_committer(ctx: Context<ClaimCommitter>) -> Result<()> {
        instructions::vault::claim_committer::handler(ctx)
    }

    /// Refund a committer 1:1 if the vault never launched.
    pub fn refund_commit(ctx: Context<RefundCommit>) -> Result<()> {
        instructions::vault::refund_commit::handler(ctx)
    }

    // ========================================================================
    // Multi-outcome Commitment Vault (Sprint 23)
    // ========================================================================

    /// Open a multi-outcome Commitment Vault. Authority picks the leg names
    /// (2..=8). Crowd then commits per-leg with `vault_commit_group`.
    pub fn initialize_vault_group(
        ctx: Context<InitializeVaultGroup>,
        vault_id: u64,
        name: String,
        leg_names: Vec<String>,
        commit_duration_secs: i64,
        market_duration_secs: i64,
        min_total: u64,
    ) -> Result<()> {
        instructions::vault::initialize_vault_group::handler(
            ctx,
            vault_id,
            name,
            leg_names,
            commit_duration_secs,
            market_duration_secs,
            min_total,
        )
    }

    /// Commit USDC on a specific leg of a multi-outcome vault. Same rules as
    /// `vault_commit`: anyone, any number of times, until commit_end_ts.
    pub fn vault_commit_group(
        ctx: Context<CommitGroup>,
        leg_index: u8,
        amount: u64,
    ) -> Result<()> {
        instructions::vault::vault_commit_group::handler(ctx, leg_index, amount)
    }

    /// Step 1 of launch: create the wrapping GroupMarket. Permissionless.
    /// Refuses if any leg has < 100 bps share (the underlying pm-AMM floor).
    pub fn launch_vault_group_market(
        ctx: Context<LaunchVaultGroupMarket>,
        group_id: u64,
    ) -> Result<()> {
        instructions::vault::launch_vault_group_market::handler(ctx, group_id)
    }

    /// Step 2 of launch (run once per leg): create the leg's binary Market +
    /// mints + vault + Metaplex metadata, then attach it to the GroupMarket.
    /// Each leg market is seeded at `leg_totals[i] / total` bps.
    pub fn launch_vault_group_leg(
        ctx: Context<LaunchVaultGroupLeg>,
        leg_index: u8,
        market_id: u64,
    ) -> Result<()> {
        instructions::vault::launch_vault_group_leg::handler(ctx, leg_index, market_id)
    }

    /// Per-leg claim for multi-outcome vault committers (v2): mints leg
    /// YES tokens 1:1 with their commit on that leg, and transfers the
    /// backing USDC from the commitment vault to the leg's market vault.
    /// Call once per leg the committer has stake in.
    pub fn claim_committer_group(
        ctx: Context<ClaimCommitterGroup>,
        leg_index: u8,
    ) -> Result<()> {
        instructions::vault::claim_committer_group::handler(ctx, leg_index)
    }

    /// Refund a committer 1:1 if the multi-outcome vault never launched.
    pub fn refund_commit_group(ctx: Context<RefundCommitGroup>) -> Result<()> {
        instructions::vault::refund_commit_group::handler(ctx)
    }
}
