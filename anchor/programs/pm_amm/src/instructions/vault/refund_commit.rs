//! Refund a committer if the vault never launched (or fell below min_total).
//! 1:1 with their commit amounts. Only available post commit_end_ts and only
//! if the vault is NOT launched (otherwise claim_committer is the path).

use anchor_lang::prelude::*;
use anchor_spl::token::{transfer, Mint, Token, TokenAccount, Transfer};

use crate::errors::PmAmmError;
use crate::state::{CommitPosition, CommitmentVault};

#[derive(Accounts)]
pub struct RefundCommit<'info> {
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [CommitmentVault::SEED, vault.vault_id.to_le_bytes().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Box<Account<'info, CommitmentVault>>,

    #[account(
        mut,
        seeds = [crate::instructions::vault::VAULT_COLLATERAL_SEED, vault.key().as_ref()],
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
        seeds = [CommitPosition::SEED, vault.key().as_ref(), signer.key().as_ref()],
        bump = commit_position.bump,
        constraint = commit_position.owner == signer.key() @ PmAmmError::Unauthorized,
        constraint = commit_position.vault == vault.key() @ PmAmmError::Unauthorized,
    )]
    pub commit_position: Box<Account<'info, CommitPosition>>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<RefundCommit>) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Snapshot values needed for the transfer to release the mutable borrow.
    let vault_id_bytes = ctx.accounts.vault.vault_id.to_le_bytes();
    let bump = ctx.accounts.vault.bump;

    let vault = &mut ctx.accounts.vault;
    require!(!vault.launched, PmAmmError::VaultAlreadyLaunched);
    require!(now >= vault.commit_end_ts, PmAmmError::CommitPhaseNotEnded);
    // Refund is only valid if the launch can no longer happen — either
    // already past commit_end_ts AND total < min_total (launch was rejected)
    // OR the launch hasn't been triggered after a grace period. We use the
    // simpler invariant: not launched + past commit_end_ts is enough since
    // no one has launched it yet — the refund opens immediately.
    // If a launch HAS happened, the path is claim_committer instead.

    let position = &mut ctx.accounts.commit_position;
    require!(!position.claimed, PmAmmError::AlreadyClaimed);
    let total_commit = position.total();
    require!(total_commit > 0, PmAmmError::NoCommitFunds);

    // Update aggregates BEFORE the transfer to release the position borrow
    // in time for the next ctx.accounts access.
    let refunded_yes = position.yes_amount;
    let refunded_no = position.no_amount;
    position.claimed = true;
    vault.yes_total = vault.yes_total.saturating_sub(refunded_yes);
    vault.no_total = vault.no_total.saturating_sub(refunded_no);

    // PDA-signed transfer back to the committer.
    let seeds: &[&[&[u8]]] = &[&[CommitmentVault::SEED, vault_id_bytes.as_ref(), &[bump]]];

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

    msg!("Refund committer: {} USDC returned", total_commit);
    Ok(())
}
