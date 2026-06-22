//! Open a new Commitment Vault. Anyone can call.
//!
//! Creates the Vault PDA + a PDA-owned collateral ATA that will hold all USDC
//! committed during the phase. No market is created here — that's deferred to
//! `launch_vault_market` once the commit phase ends.

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::errors::PmAmmError;
use crate::state::{
    CommitmentVault, MAX_COMMIT_DURATION_SECS, MAX_MARKET_DURATION_SECS, MIN_COMMIT_DURATION_SECS,
    MIN_MARKET_DURATION_SECS,
};

pub const VAULT_COLLATERAL_SEED: &[u8] = b"vault_collateral";

#[derive(Accounts)]
#[instruction(vault_id: u64)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = CommitmentVault::LEN,
        seeds = [CommitmentVault::SEED, vault_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub vault: Box<Account<'info, CommitmentVault>>,

    /// Collateral mint — any SPL mint. YES/NO mints inherit its decimals at launch.
    pub collateral_mint: Box<Account<'info, Mint>>,

    /// PDA-owned token account that aggregates all commits.
    #[account(
        init,
        payer = authority,
        token::mint = collateral_mint,
        token::authority = vault,
        seeds = [VAULT_COLLATERAL_SEED, vault.key().as_ref()],
        bump,
    )]
    pub vault_collateral: Box<Account<'info, TokenAccount>>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<InitializeVault>,
    vault_id: u64,
    name: String,
    commit_duration_secs: i64,
    market_duration_secs: i64,
    min_total: u64,
) -> Result<()> {
    require!(
        !name.is_empty() && name.len() <= 64,
        PmAmmError::InvalidName
    );
    require!(
        (MIN_COMMIT_DURATION_SECS..=MAX_COMMIT_DURATION_SECS).contains(&commit_duration_secs),
        PmAmmError::InvalidCommitDuration
    );
    require!(
        (MIN_MARKET_DURATION_SECS..=MAX_MARKET_DURATION_SECS).contains(&market_duration_secs),
        PmAmmError::InvalidMarketDuration
    );
    require!(min_total > 0, PmAmmError::InvalidBudget);

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let vault = &mut ctx.accounts.vault;
    vault.authority = ctx.accounts.authority.key();
    vault.vault_id = vault_id;
    vault.collateral_mint = ctx.accounts.collateral_mint.key();

    let mut name_bytes = [0u8; 64];
    name_bytes[..name.len()].copy_from_slice(name.as_bytes());
    vault.name = name_bytes;

    vault.commit_end_ts = now + commit_duration_secs;
    vault.market_end_ts = vault.commit_end_ts + market_duration_secs;
    vault.yes_total = 0;
    vault.no_total = 0;
    vault.commit_count = 0;
    vault.min_total = min_total;
    vault.launched = false;
    vault.winning_price_bps = 0;
    vault.market = Pubkey::default();
    vault.lp_position = Pubkey::default();
    vault.bump = ctx.bumps.vault;
    vault._reserved = [0u8; 32];

    msg!(
        "Vault {} opened: commit_end={}, market_end={}, min_total={}",
        vault_id,
        vault.commit_end_ts,
        vault.market_end_ts,
        min_total
    );
    Ok(())
}
