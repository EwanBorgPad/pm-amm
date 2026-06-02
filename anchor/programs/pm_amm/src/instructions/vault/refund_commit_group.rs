//! Multi-outcome vault refund: pre-launch fallback when the vault couldn't
//! launch (either below `min_total` or at least one leg below 100 bps share).
//!
//! Available iff `now >= commit_end_ts` AND `!group_market_initialized`. Once
//! the GroupMarket is created, `claim_committer_group` is the only path.

use anchor_lang::prelude::*;
use anchor_spl::token::{transfer, Mint, Token, TokenAccount, Transfer};

use crate::errors::PmAmmError;
use crate::instructions::vault::initialize_vault_group::VAULT_GROUP_COLLATERAL_SEED;
use crate::state::{CommitPositionGroup, CommitmentVaultGroup, MAX_VAULT_LEGS};

#[derive(Accounts)]
pub struct RefundCommitGroup<'info> {
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [CommitmentVaultGroup::SEED, vault.vault_id.to_le_bytes().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Box<Account<'info, CommitmentVaultGroup>>,

    #[account(
        mut,
        seeds = [VAULT_GROUP_COLLATERAL_SEED, vault.key().as_ref()],
        bump,
    )]
    pub vault_collateral: Box<Account<'info, TokenAccount>>,

    pub collateral_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        constraint = user_collateral.mint == vault.collateral_mint,
        constraint = user_collateral.owner == signer.key(),
    )]
    pub user_collateral: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [CommitPositionGroup::SEED, vault.key().as_ref(), signer.key().as_ref()],
        bump = commit_position.bump,
        constraint = commit_position.owner == signer.key() @ PmAmmError::Unauthorized,
        constraint = commit_position.vault == vault.key() @ PmAmmError::Unauthorized,
    )]
    pub commit_position: Box<Account<'info, CommitPositionGroup>>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<RefundCommitGroup>) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let vault_id_bytes = ctx.accounts.vault.vault_id.to_le_bytes();
    let bump = ctx.accounts.vault.bump;

    let vault = &mut ctx.accounts.vault;
    require!(
        !vault.group_market_initialized,
        PmAmmError::VaultAlreadyLaunched
    );
    require!(now >= vault.commit_end_ts, PmAmmError::CommitPhaseNotEnded);

    let position = &mut ctx.accounts.commit_position;
    require!(!position.claimed, PmAmmError::AlreadyClaimed);
    let total_commit = position.total();
    require!(total_commit > 0, PmAmmError::NoCommitFunds);

    // Decrement aggregates by the per-leg amounts before zeroing the position.
    for i in 0..MAX_VAULT_LEGS {
        let amt = position.leg_amounts[i];
        if amt > 0 {
            vault.leg_totals[i] = vault.leg_totals[i].saturating_sub(amt);
        }
    }
    position.claimed = true;

    let seeds: &[&[&[u8]]] = &[&[CommitmentVaultGroup::SEED, vault_id_bytes.as_ref(), &[bump]]];

    let tp = ctx.accounts.token_program.key();
    transfer(
        CpiContext::new_with_signer(
            tp,
            Transfer {
                from: ctx.accounts.vault_collateral.to_account_info(),
                to: ctx.accounts.user_collateral.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            seeds,
        ),
        total_commit,
    )?;

    msg!("Refund committer group: {} USDC returned", total_commit);
    Ok(())
}
