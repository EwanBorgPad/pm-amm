//! Commit USDC on a specific leg of a multi-outcome Commitment Vault.
//! Same model as `vault_commit` but indexed by `leg_index` (0..leg_count).

use anchor_lang::prelude::*;
use anchor_spl::token::{transfer, Mint, Token, TokenAccount, Transfer};

use crate::errors::PmAmmError;
use crate::instructions::vault::initialize_vault_group::VAULT_GROUP_COLLATERAL_SEED;
use crate::state::{CommitPositionGroup, CommitmentVaultGroup, MAX_VAULT_LEGS, MIN_COMMIT_USDC};

#[derive(Accounts)]
pub struct CommitGroup<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [CommitmentVaultGroup::SEED, vault.vault_id.to_le_bytes().as_ref()],
        bump = vault.bump,
        constraint = vault.collateral_mint == collateral_mint.key() @ PmAmmError::InvalidWinningMint,
    )]
    pub vault: Box<Account<'info, CommitmentVaultGroup>>,

    pub collateral_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        seeds = [VAULT_GROUP_COLLATERAL_SEED, vault.key().as_ref()],
        bump,
        constraint = vault_collateral.mint == collateral_mint.key(),
    )]
    pub vault_collateral: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = user_collateral.mint == collateral_mint.key(),
        constraint = user_collateral.owner == signer.key(),
    )]
    pub user_collateral: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = signer,
        space = CommitPositionGroup::LEN,
        seeds = [CommitPositionGroup::SEED, vault.key().as_ref(), signer.key().as_ref()],
        bump,
    )]
    pub commit_position: Box<Account<'info, CommitPositionGroup>>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<CommitGroup>, leg_index: u8, amount: u64) -> Result<()> {
    require!(amount >= MIN_COMMIT_USDC, PmAmmError::CommitTooSmall);

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let vault = &mut ctx.accounts.vault;
    require!(
        !vault.group_market_initialized,
        PmAmmError::VaultAlreadyLaunched
    );
    require!(now < vault.commit_end_ts, PmAmmError::CommitPhaseClosed);
    require!(
        (leg_index as usize) < vault.leg_count as usize,
        PmAmmError::VaultGroupLegOutOfBounds
    );

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

    let position = &mut ctx.accounts.commit_position;
    let is_new = position.owner == Pubkey::default();
    if is_new {
        position.vault = vault.key();
        position.owner = ctx.accounts.signer.key();
        position.leg_amounts = [0u64; MAX_VAULT_LEGS];
        position.claimed = false;
        position.bump = ctx.bumps.commit_position;
        position._reserved = [0u8; 16];
        vault.commit_count = vault.commit_count.saturating_add(1);
    }

    let i = leg_index as usize;
    position.leg_amounts[i] = position.leg_amounts[i]
        .checked_add(amount)
        .ok_or(PmAmmError::MathOverflow)?;
    vault.leg_totals[i] = vault.leg_totals[i]
        .checked_add(amount)
        .ok_or(PmAmmError::MathOverflow)?;

    msg!(
        "VaultGroup commit leg={} amount={} (leg_total={} vault_total={} count={})",
        leg_index,
        amount,
        vault.leg_totals[i],
        vault.total(),
        vault.commit_count
    );
    Ok(())
}
