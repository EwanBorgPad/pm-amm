//! Open a new multi-outcome Commitment Vault (Sprint 23).
//!
//! Authority sets the vault name, leg names, durations, and min_total. The
//! per-leg commit totals start at 0 and are filled by `vault_commit_group`
//! during the commit phase. No market is created here — that happens in
//! `launch_vault_group_market` + N × `launch_vault_group_leg` after
//! `commit_end_ts`.

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::errors::PmAmmError;
use crate::state::{
    CommitmentVaultGroup, LEG_NAME_LEN, MAX_COMMIT_DURATION_SECS, MAX_MARKET_DURATION_SECS,
    MAX_VAULT_LEGS, MIN_COMMIT_DURATION_SECS, MIN_MARKET_DURATION_SECS,
};

pub const VAULT_GROUP_COLLATERAL_SEED: &[u8] = b"vault_group_collateral";

#[derive(Accounts)]
#[instruction(vault_id: u64)]
pub struct InitializeVaultGroup<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = CommitmentVaultGroup::LEN,
        seeds = [CommitmentVaultGroup::SEED, vault_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub vault: Box<Account<'info, CommitmentVaultGroup>>,

    /// Collateral mint — any SPL mint. YES/NO mints inherit its decimals at launch.
    pub collateral_mint: Box<Account<'info, Mint>>,

    /// PDA-owned token account that aggregates all commits.
    #[account(
        init,
        payer = authority,
        token::mint = collateral_mint,
        token::authority = vault,
        seeds = [VAULT_GROUP_COLLATERAL_SEED, vault.key().as_ref()],
        bump,
    )]
    pub vault_collateral: Box<Account<'info, TokenAccount>>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<InitializeVaultGroup>,
    vault_id: u64,
    name: String,
    leg_names: Vec<String>,
    commit_duration_secs: i64,
    market_duration_secs: i64,
    min_total: u64,
) -> Result<()> {
    require!(
        !name.is_empty() && name.len() <= 64,
        PmAmmError::InvalidName
    );
    require!(
        leg_names.len() >= 2 && leg_names.len() <= MAX_VAULT_LEGS,
        PmAmmError::InvalidLegCount
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

    for ln in leg_names.iter() {
        require!(
            !ln.is_empty() && ln.len() <= LEG_NAME_LEN,
            PmAmmError::InvalidLegName
        );
    }

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let vault = &mut ctx.accounts.vault;
    vault.authority = ctx.accounts.authority.key();
    vault.vault_id = vault_id;
    vault.collateral_mint = ctx.accounts.collateral_mint.key();

    let mut name_bytes = [0u8; 64];
    name_bytes[..name.len()].copy_from_slice(name.as_bytes());
    vault.name = name_bytes;

    vault.leg_count = leg_names.len() as u8;
    let mut leg_names_buf = [[0u8; LEG_NAME_LEN]; MAX_VAULT_LEGS];
    for (i, ln) in leg_names.iter().enumerate() {
        let src = ln.as_bytes();
        leg_names_buf[i][..src.len()].copy_from_slice(src);
    }
    vault.leg_names = leg_names_buf;
    vault.leg_totals = [0u64; MAX_VAULT_LEGS];

    vault.commit_end_ts = now + commit_duration_secs;
    vault.market_end_ts = vault.commit_end_ts + market_duration_secs;
    vault.commit_count = 0;
    vault.min_total = min_total;
    vault.group_market_initialized = false;
    vault.legs_launched = 0;
    vault.group_market = Pubkey::default();
    vault.bump = ctx.bumps.vault;
    vault._reserved = [0u8; 32];

    msg!(
        "VaultGroup {} opened ({} legs): commit_end={}, market_end={}, min_total={}",
        vault_id,
        vault.leg_count,
        vault.commit_end_ts,
        vault.market_end_ts,
        min_total
    );
    Ok(())
}
