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

    group.set_winning_leg(winning_leg);

    msg!(
        "GroupMarket {} resolved: winning_leg={}",
        group.group_id,
        winning_leg
    );
    Ok(())
}
