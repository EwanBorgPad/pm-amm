//! Claim the committer's pro-rata share of the vault's aggregated USDC.
//!
//! v1 simplified design: the committer receives their commit value back
//! from the vault's collateral ATA (1:1 with what they put in). They then
//! call the normal `deposit_liquidity` and/or `swap` on the launched market
//! independently if they want LP exposure / outcome tokens. This keeps the
//! sprint scope tight; v2 will distribute LP shares directly so committers
//! become LPs automatically.
//!
//! Why this is still useful in v1:
//!   - The vault's existence already did the price discovery on-chain (the
//!     launched market's `initial_price_bps` is the crowd's signal).
//!   - Permissionless launch + crowd-discovered seed price is the key
//!     novelty here. Distributing LP shares pro-rata is an optimization
//!     that doesn't affect the price-discovery property.

use anchor_lang::prelude::*;
use anchor_spl::token::{transfer, Mint, Token, TokenAccount, Transfer};

use crate::errors::PmAmmError;
use crate::state::{CommitPosition, CommitmentVault};

#[derive(Accounts)]
pub struct ClaimCommitter<'info> {
    pub signer: Signer<'info>,

    #[account(
        seeds = [CommitmentVault::SEED, vault.vault_id.to_le_bytes().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Box<Account<'info, CommitmentVault>>,

    /// PDA-owned vault collateral ATA.
    #[account(
        mut,
        seeds = [crate::instructions::vault::VAULT_COLLATERAL_SEED, vault.key().as_ref()],
        bump,
    )]
    pub vault_collateral: Box<Account<'info, TokenAccount>>,

    pub collateral_mint: Box<Account<'info, Mint>>,

    /// The committer's USDC ATA (must exist; the caller creates it client-side
    /// if needed).
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

pub fn handler(ctx: Context<ClaimCommitter>) -> Result<()> {
    let vault = &ctx.accounts.vault;
    require!(vault.launched, PmAmmError::VaultNotLaunched);

    let position = &mut ctx.accounts.commit_position;
    require!(!position.claimed, PmAmmError::AlreadyClaimed);
    let total_commit = position.total();
    require!(total_commit > 0, PmAmmError::NoCommitFunds);

    // Sign the transfer as the Vault PDA.
    let vault_id_bytes = vault.vault_id.to_le_bytes();
    let bump = vault.bump;
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

    position.claimed = true;
    msg!(
        "Claim committer {}: {} USDC returned (yes={} no={})",
        position.owner,
        total_commit,
        position.yes_amount,
        position.no_amount
    );
    Ok(())
}
