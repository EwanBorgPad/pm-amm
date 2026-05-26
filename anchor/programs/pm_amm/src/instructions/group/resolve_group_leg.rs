//! Cascade-resolve one binary leg in accordance with the GroupMarket's
//! `winning_leg`. Permissionless once the group is resolved — anyone can
//! finalize the individual legs. The group's `winning_leg` is the only
//! source of truth for which leg gets `Side::Yes`; all others get `Side::No`.
//!
//! Security: the binary `resolve_market` instruction stays available to the
//! authority for free-standing markets. For legs attached to a group, the
//! authority can still call `resolve_market` directly, so this cascade
//! handler doesn't strictly *force* the cascade — it only enables a
//! permissionless, group-consistent path.

use anchor_lang::prelude::*;

use crate::accrual;
use crate::errors::PmAmmError;
use crate::state::{GroupMarket, Market, Side, NO_WINNING_LEG};

#[derive(Accounts)]
#[instruction(leg_index: u8)]
pub struct ResolveGroupLeg<'info> {
    pub group_market: Box<Account<'info, GroupMarket>>,

    #[account(mut)]
    pub market: Box<Account<'info, Market>>,
}

pub fn handler(ctx: Context<ResolveGroupLeg>, leg_index: u8) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let group = &ctx.accounts.group_market;
    let market = &mut ctx.accounts.market;

    require!(group.resolved, PmAmmError::GroupNotResolved);
    require!(!market.resolved, PmAmmError::MarketAlreadyResolved);
    require!(now >= market.end_ts, PmAmmError::MarketNotExpired);
    require!(
        (leg_index as usize) < group.leg_count as usize,
        PmAmmError::InvalidLegIndex
    );
    require!(
        group.legs[leg_index as usize] == market.key(),
        PmAmmError::LegMismatch
    );

    // Defensive: a resolved group must carry either a valid leg index or the
    // cancel sentinel. Any other value would cause the cascade below to fall
    // through to Side::No silently for every leg — guard at the boundary.
    require!(
        group.winning_leg == NO_WINNING_LEG
            || (group.winning_leg as usize) < group.leg_count as usize,
        PmAmmError::InvalidLegIndex
    );

    // Cascade: only the winning leg gets Side::Yes; all others get Side::No.
    // NO_WINNING_LEG (group cancellation path) maps every leg to Side::No.
    let side = if leg_index == group.winning_leg {
        Side::Yes
    } else {
        Side::No
    };

    // Final accrual — releases all remaining reserves to LPs of this leg.
    accrual::accrue_first(market, now)?;
    market.resolved = true;
    market.set_winning_side(side);

    msg!("Group leg {} resolved with side={:?}", leg_index, side);
    Ok(())
}
