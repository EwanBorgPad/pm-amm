//! Multi-outcome vault: claim back committer's USDC after the vault is fully
//! launched (all N legs created + attached).
//!
//! v1 simplified design — same as binary `claim_committer`: returns the
//! committer's total commit 1:1. v2 will distribute LP shares of each leg
//! market pro-rata.

use anchor_lang::prelude::*;
use anchor_spl::token::{transfer, Mint, Token, TokenAccount, Transfer};

use crate::errors::PmAmmError;
use crate::instructions::vault::initialize_vault_group::VAULT_GROUP_COLLATERAL_SEED;
use crate::state::{CommitPositionGroup, CommitmentVaultGroup};

#[derive(Accounts)]
pub struct ClaimCommitterGroup<'info> {
    pub signer: Signer<'info>,

    #[account(
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

pub fn handler(ctx: Context<ClaimCommitterGroup>) -> Result<()> {
    let vault = &ctx.accounts.vault;
    require!(
        vault.legs_launched == vault.leg_count,
        PmAmmError::VaultGroupNotAllLegsLaunched
    );

    let position = &mut ctx.accounts.commit_position;
    require!(!position.claimed, PmAmmError::AlreadyClaimed);
    let total_commit = position.total();
    require!(total_commit > 0, PmAmmError::NoCommitFunds);

    let vault_id_bytes = vault.vault_id.to_le_bytes();
    let bump = vault.bump;
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

    position.claimed = true;
    msg!(
        "Claim committer group {}: {} USDC returned",
        position.owner,
        total_commit
    );
    Ok(())
}
