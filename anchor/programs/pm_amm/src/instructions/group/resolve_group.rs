//! Resolve a GroupMarket: authority picks the winning leg index.
//! Must run after expiration and after all `leg_count` slots are attached.
//! Individual binary legs are then finalized via `resolve_group_leg`.

use anchor_lang::prelude::*;

use crate::errors::PmAmmError;
use crate::state::GroupMarket;

#[derive(Accounts)]
pub struct ResolveGroup<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        constraint = group_market.authority == authority.key() @ PmAmmError::Unauthorized,
    )]
    pub group_market: Box<Account<'info, GroupMarket>>,
}

pub fn handler(ctx: Context<ResolveGroup>, winning_leg: u8) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let group = &mut ctx.accounts.group_market;

    require!(!group.resolved, PmAmmError::GroupAlreadyResolved);
    require!(now >= group.end_ts, PmAmmError::GroupNotExpired);
    require!(group.all_legs_attached(), PmAmmError::GroupIncomplete);
    require!(
        (winning_leg as usize) < group.leg_count as usize,
        PmAmmError::InvalidLegIndex
    );

    // Σ p_i invariant: total seeded bps must be within tolerance of 10_000
    // (= 1.0). Worst-case underseed is `N * (floor(10_000/N) - 1)` =
    // `10_000 - residual - N`, where `residual = 10_000 % N` (< N). The
    // lower bound must subtract BOTH residual AND N so a valid sequence of
    // attaches at floor - 1 each can still resolve. Upper bound is the
    // per-attach cap (`<= 10_001`).
    let leg_count = group.leg_count as u32;
    require!(leg_count > 0, PmAmmError::InvalidLegCount);
    let residual = 10_000_u32 % leg_count;
    let min_sum = 10_000_u32
        .saturating_sub(leg_count)
        .saturating_sub(residual);
    require!(
        group.total_seeded_bps >= min_sum && group.total_seeded_bps <= 10_001,
        PmAmmError::InvalidPrice
    );

    group.set_winning_leg(winning_leg);

    msg!(
        "GroupMarket {} resolved: winning_leg={}",
        group.group_id,
        winning_leg
    );
    Ok(())
}
