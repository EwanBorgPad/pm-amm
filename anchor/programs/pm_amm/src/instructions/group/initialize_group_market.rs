//! Create a new GroupMarket — multi-outcome wrapper over N binary markets.

use anchor_lang::prelude::*;

use crate::errors::PmAmmError;
use crate::state::{GroupMarket, MAX_LEGS, NO_WINNING_LEG};

#[derive(Accounts)]
#[instruction(group_id: u64)]
pub struct InitializeGroupMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = GroupMarket::LEN,
        seeds = [GroupMarket::SEED, group_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub group_market: Box<Account<'info, GroupMarket>>,

    pub system_program: Program<'info, System>,
}

/// Initialize an empty GroupMarket. Legs are attached separately via
/// `attach_leg_to_group` and individual binary markets are created via
/// the existing `initialize_market` instruction (with the right
/// `initial_price_bps = 10_000 / leg_count`).
pub fn handler(
    ctx: Context<InitializeGroupMarket>,
    group_id: u64,
    end_ts: i64,
    name: String,
    leg_count: u8,
) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    /// Minimum market duration in seconds (5 minutes).
    const MIN_DURATION_SECS: i64 = 300;
    /// Minimum number of legs — a 2-leg group is effectively a binary market,
    /// but we allow it for API uniformity.
    const MIN_LEG_COUNT: u8 = 2;

    require!(
        end_ts > now + MIN_DURATION_SECS,
        PmAmmError::InvalidDuration
    );
    require!(
        !name.is_empty() && name.len() <= 64,
        PmAmmError::InvalidName
    );
    require!(
        leg_count >= MIN_LEG_COUNT && (leg_count as usize) <= MAX_LEGS,
        PmAmmError::InvalidLegCount
    );

    let group = &mut ctx.accounts.group_market;
    group.authority = ctx.accounts.authority.key();
    group.group_id = group_id;
    group.start_ts = now;
    group.end_ts = end_ts;
    group.leg_count = leg_count;
    group.legs = [Pubkey::default(); MAX_LEGS];
    group.resolved = false;
    group.winning_leg = NO_WINNING_LEG;
    group.bump = ctx.bumps.group_market;

    let mut name_bytes = [0u8; 64];
    let src = name.as_bytes();
    name_bytes[..src.len()].copy_from_slice(src);
    group.name = name_bytes;
    group._reserved = [0u8; 32];

    Ok(())
}
