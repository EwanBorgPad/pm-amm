//! Commit USDC on YES or NO. Anyone can call any number of times until
//! `commit_end_ts`. A single signer can also commit on both sides (their
//! CommitPosition tracks both balances independently).

use anchor_lang::prelude::*;
use anchor_spl::token::{transfer, Mint, Token, TokenAccount, Transfer};

use crate::errors::PmAmmError;
use crate::state::{CommitPosition, CommitmentVault, Side, MIN_COMMIT_USDC};

#[derive(Accounts)]
pub struct Commit<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [CommitmentVault::SEED, vault.vault_id.to_le_bytes().as_ref()],
        bump = vault.bump,
        constraint = vault.collateral_mint == collateral_mint.key() @ PmAmmError::InvalidWinningMint,
    )]
    pub vault: Box<Account<'info, CommitmentVault>>,

    pub collateral_mint: Box<Account<'info, Mint>>,

    /// Vault's PDA-owned collateral ATA — receives the transferred USDC.
    #[account(
        mut,
        seeds = [crate::instructions::vault::VAULT_COLLATERAL_SEED, vault.key().as_ref()],
        bump,
        constraint = vault_collateral.mint == collateral_mint.key(),
    )]
    pub vault_collateral: Box<Account<'info, TokenAccount>>,

    /// User's USDC source.
    #[account(
        mut,
        constraint = user_collateral.mint == collateral_mint.key(),
        constraint = user_collateral.owner == signer.key(),
    )]
    pub user_collateral: Box<Account<'info, TokenAccount>>,

    /// CommitPosition tracks this signer's commits on this vault.
    /// init_if_needed: first commit creates it, subsequent commits update.
    #[account(
        init_if_needed,
        payer = signer,
        space = CommitPosition::LEN,
        seeds = [CommitPosition::SEED, vault.key().as_ref(), signer.key().as_ref()],
        bump,
    )]
    pub commit_position: Box<Account<'info, CommitPosition>>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Commit>, side: Side, amount: u64) -> Result<()> {
    require!(amount >= MIN_COMMIT_USDC, PmAmmError::CommitTooSmall);

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let vault = &mut ctx.accounts.vault;
    require!(!vault.launched, PmAmmError::VaultAlreadyLaunched);
    require!(now < vault.commit_end_ts, PmAmmError::CommitPhaseClosed);

    // Transfer USDC: user → vault_collateral
    let tp = ctx.accounts.token_program.key();
    transfer(
        CpiContext::new(
            tp,
            Transfer {
                from: ctx.accounts.user_collateral.to_account_info(),
                to: ctx.accounts.vault_collateral.to_account_info(),
                authority: ctx.accounts.signer.to_account_info(),
            },
        ),
        amount,
    )?;

    // Update aggregates and per-user position. Initialize fields on first commit.
    let position = &mut ctx.accounts.commit_position;
    let is_new = position.owner == Pubkey::default();
    if is_new {
        position.vault = vault.key();
        position.owner = ctx.accounts.signer.key();
        position.yes_amount = 0;
        position.no_amount = 0;
        position.claimed = false;
        position.bump = ctx.bumps.commit_position;
        position._reserved = [0u8; 16];
        vault.commit_count = vault.commit_count.saturating_add(1);
    }

    match side {
        Side::Yes => {
            position.yes_amount = position
                .yes_amount
                .checked_add(amount)
                .ok_or(PmAmmError::MathOverflow)?;
            vault.yes_total = vault
                .yes_total
                .checked_add(amount)
                .ok_or(PmAmmError::MathOverflow)?;
        }
        Side::No => {
            position.no_amount = position
                .no_amount
                .checked_add(amount)
                .ok_or(PmAmmError::MathOverflow)?;
            vault.no_total = vault
                .no_total
                .checked_add(amount)
                .ok_or(PmAmmError::MathOverflow)?;
        }
    }

    msg!(
        "Commit {:?} amount={} (vault yes={} no={} count={})",
        side,
        amount,
        vault.yes_total,
        vault.no_total,
        vault.commit_count
    );
    Ok(())
}
