//! Attach an existing binary Market PDA to a GroupMarket slot.
//!
//! Constraints enforced on-chain:
//! - Authority of the group == authority of the leg market
//! - The leg market is unresolved
//! - The leg market end_ts == group end_ts (synchronous resolution)
//! - The leg market initial_price_bps ≈ 10_000 / leg_count (Σ p_i = 1 at seed)
//! - The target leg slot is empty (cannot overwrite)

use anchor_lang::prelude::*;

use crate::errors::PmAmmError;
use crate::state::{GroupMarket, Market};

#[derive(Accounts)]
#[instruction(leg_index: u8)]
pub struct AttachLegToGroup<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        constraint = group_market.authority == authority.key() @ PmAmmError::Unauthorized,
        constraint = !group_market.resolved @ PmAmmError::GroupAlreadyResolved,
    )]
    pub group_market: Box<Account<'info, GroupMarket>>,

    #[account(
        mut,
        constraint = market.authority == authority.key() @ PmAmmError::Unauthorized,
        constraint = !market.resolved @ PmAmmError::MarketAlreadyResolved,
    )]
    pub market: Box<Account<'info, Market>>,
}

pub fn handler(ctx: Context<AttachLegToGroup>, leg_index: u8) -> Result<()> {
    let group = &mut ctx.accounts.group_market;
    let market = &mut ctx.accounts.market;

    require!(
        (leg_index as usize) < group.leg_count as usize,
        PmAmmError::InvalidLegIndex
    );
    require!(
        group.legs[leg_index as usize] == Pubkey::default(),
        PmAmmError::LegAlreadyAttached
    );

    // Reject double-attachment across groups: once attached to any group,
    // a leg cannot be reattached elsewhere.
    require!(
        !market.is_attached_to_group(),
        PmAmmError::LegAlreadyAttached
    );

    // Synchronous resolution: leg end_ts must match group end_ts.
    require!(market.end_ts == group.end_ts, PmAmmError::LegEndTsMismatch);

    // Σ p_i = 1 invariant at seed: each leg must be seeded at 10_000 / N bps.
    // Allow ±1 bps tolerance for rounding (10_000 / 14 = 714 has 4 bps residual
    // across all legs that the off-chain dispatcher absorbs).
    let expected = group.expected_leg_initial_price_bps();
    let actual = market.initial_price_bps;
    require!(actual.abs_diff(expected) <= 1, PmAmmError::InvalidPrice);

    group.legs[leg_index as usize] = market.key();
    // Stamp the leg with the group it now belongs to. This forces resolution
    // through the cascade path (resolve_group_leg) — see resolve_market.rs.
    market.group = group.key();

    msg!(
        "Group {} leg {} attached: market={}, seed_bps={}",
        group.group_id,
        leg_index,
        market.key(),
        actual
    );
    Ok(())
}
