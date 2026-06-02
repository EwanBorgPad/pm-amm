//! Step 1 of the multi-outcome vault launch: create the wrapping GroupMarket.
//!
//! Permissionless caller pays the rent for the GroupMarket account. The
//! GroupMarket's authority is set to `vault.authority` (the human who opened
//! the vault) so they can later call `resolve_group` / `cancel_group_market`
//! — the vault PDA itself can't sign as authority since no off-chain key
//! controls it. The leg-launch binding in `launch_vault_group_leg` uses
//! `vault.group_market` as the source of truth instead.

use anchor_lang::prelude::*;

use crate::errors::PmAmmError;
use crate::state::{CommitmentVaultGroup, GroupMarket, MAX_LEGS, NO_WINNING_LEG};

#[derive(Accounts)]
#[instruction(group_id: u64)]
pub struct LaunchVaultGroupMarket<'info> {
    /// Permissionless caller — pays rent.
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [CommitmentVaultGroup::SEED, vault.vault_id.to_le_bytes().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Box<Account<'info, CommitmentVaultGroup>>,

    #[account(
        init,
        payer = payer,
        space = GroupMarket::LEN,
        seeds = [GroupMarket::SEED, group_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub group_market: Box<Account<'info, GroupMarket>>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<LaunchVaultGroupMarket>, group_id: u64) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let vault = &mut ctx.accounts.vault;
    require!(
        !vault.group_market_initialized,
        PmAmmError::VaultAlreadyLaunched
    );
    require!(now >= vault.commit_end_ts, PmAmmError::CommitPhaseNotEnded);
    require!(
        vault.total() >= vault.min_total,
        PmAmmError::VaultBelowMinTotal
    );
    // Every leg must end up with ≥ 100 bps share (initialize_market floor).
    // If any leg is under-committed, jail the launch — refund path opens.
    require!(
        vault.all_legs_above_min_share(),
        PmAmmError::VaultGroupInsufficientLegShare
    );

    let group = &mut ctx.accounts.group_market;
    // Authority = vault.authority (human creator) so they can call
    // resolve_group / cancel_group_market after expiration. The vault PDA
    // itself has no off-chain signer — using it as authority would brick
    // resolution and freeze committer funds forever.
    group.authority = vault.authority;
    group.group_id = group_id;
    group.start_ts = now;
    group.end_ts = vault.market_end_ts;
    group.leg_count = vault.leg_count;
    group.legs = [Pubkey::default(); MAX_LEGS];
    group.resolved = false;
    group.winning_leg = NO_WINNING_LEG;
    group.bump = ctx.bumps.group_market;

    let mut name_bytes = [0u8; 64];
    name_bytes[..vault.name.len().min(64)].copy_from_slice(&vault.name);
    group.name = name_bytes;
    group.total_seeded_bps = 0;
    group._reserved = [0u8; 28];

    vault.group_market_initialized = true;
    vault.group_market = group.key();

    msg!(
        "VaultGroup {}: GroupMarket {} initialized ({} legs), now launch each leg",
        vault.vault_id,
        group_id,
        vault.leg_count
    );
    Ok(())
}
