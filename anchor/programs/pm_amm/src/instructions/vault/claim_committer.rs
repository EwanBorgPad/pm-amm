//! Binary vault claim — option C (committers = LPs), audit #6.
//!
//! The Paradigm pm-AMM is an LP-vs-traders AMM: there is no self-funded
//! "bettor" whose losing stake could strand. A commitment vault is just a way
//! to CROWD-BOOTSTRAP that AMM, so committers are LPs. `launch_vault_market`
//! deposits the whole committed pot as liquidity (fully collateralized via the
//! max-reserve calibration, fix #1) and sets `total_lp_shares = total commit`.
//! This instruction hands each committer their pro-rata slice as a real
//! `LpPosition` (1 USDC committed = 1 LP share).
//!
//! Checkpoints are 0 (the launch baseline), so a committer earns their share of
//! all `dC_t` residuals accrued since launch — their capital was in the pool
//! from the start. The accumulator is normalized by `total_lp_shares` (set to
//! the full committed total at launch), so unclaimed slices stay correctly
//! accounted until their owner materializes this position.
//!
//! After claiming, a committer is a normal LP: `claim_lp_residuals`,
//! `withdraw_liquidity` (YES+NO out), `redeem_pair`, and post-resolution
//! `claim_winnings` on whatever they hold. Nothing is stranded; the winning
//! side is always fully backed (fix #1).
//!
//! Pre-launch the recovery path is `refund_commit`; once launched it's this.

use anchor_lang::prelude::*;
use fixed::types::I80F48;

use crate::errors::PmAmmError;
use crate::state::{CommitPosition, CommitmentVault, LpPosition, Market};

#[derive(Accounts)]
pub struct ClaimCommitter<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        seeds = [CommitmentVault::SEED, vault.vault_id.to_le_bytes().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Box<Account<'info, CommitmentVault>>,

    /// The launched binary market — must match `vault.market`.
    #[account(constraint = market.key() == vault.market @ PmAmmError::InvalidMarket)]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [CommitPosition::SEED, vault.key().as_ref(), signer.key().as_ref()],
        bump = commit_position.bump,
        constraint = commit_position.owner == signer.key() @ PmAmmError::Unauthorized,
        constraint = commit_position.vault == vault.key() @ PmAmmError::Unauthorized,
    )]
    pub commit_position: Box<Account<'info, CommitPosition>>,

    /// The committer's LP position — created here with their pro-rata shares.
    /// `init` (not `init_if_needed`): a committer who already opened a separate
    /// LpPosition on this market must use `deposit_liquidity` instead.
    #[account(
        init,
        payer = signer,
        space = LpPosition::LEN,
        seeds = [LpPosition::SEED, market.key().as_ref(), signer.key().as_ref()],
        bump,
    )]
    pub lp_position: Box<Account<'info, LpPosition>>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ClaimCommitter>) -> Result<()> {
    let vault = &ctx.accounts.vault;
    require!(vault.launched, PmAmmError::VaultNotLaunched);

    let market = &ctx.accounts.market;
    // The market was bootstrapped with liquidity at launch.
    require!(
        market.total_lp_shares > 0,
        PmAmmError::InsufficientLiquidity
    );

    let position = &mut ctx.accounts.commit_position;
    require!(!position.claimed, PmAmmError::AlreadyClaimed);
    let total = position.total();
    require!(total > 0, PmAmmError::NoCommitFunds);

    // 1 USDC committed == 1 LP share (launch set total_lp_shares = total commit).
    // Checkpoint 0 = launch baseline → earns dC_t residuals from launch onward.
    let lp = &mut ctx.accounts.lp_position;
    lp.owner = ctx.accounts.signer.key();
    lp.market = market.key();
    lp.bump = ctx.bumps.lp_position;
    lp.shares = I80F48::from_num(total).to_bits() as u128;
    lp.collateral_deposited = total;
    lp.yes_per_share_checkpoint = 0;
    lp.no_per_share_checkpoint = 0;

    position.claimed = true;
    msg!(
        "Vault LP claim {}: {} LP shares (1 USDC = 1 share)",
        position.owner,
        total
    );
    Ok(())
}
