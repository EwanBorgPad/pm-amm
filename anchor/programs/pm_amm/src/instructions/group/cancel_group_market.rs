//! Cancel an abandoned GroupMarket so attached legs can be finalized.
//!
//! Recovery path for the partial-failure case in `runCreateGroup` (UI-side):
//! the authority creates a group + attaches some legs, then bails out before
//! attaching the remaining slots. Without this instruction the partially-
//! attached legs would deadlock — `resolve_market` rejects them (cascade
//! enforcement) and `resolve_group` refuses to run on an incomplete group.
//!
//! Cancel marks the group as resolved with the `NO_WINNING_LEG` sentinel.
//! `resolve_group_leg` then treats every attached leg as a loser (Side::No),
//! which is the conservative outcome — bettors who took the "no" side of
//! each leg get paid out as if the leg failed to win.

use anchor_lang::prelude::*;

use crate::errors::PmAmmError;
use crate::state::{GroupMarket, NO_WINNING_LEG};

#[derive(Accounts)]
pub struct CancelGroupMarket<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        constraint = group_market.authority == authority.key() @ PmAmmError::Unauthorized,
    )]
    pub group_market: Box<Account<'info, GroupMarket>>,
}

pub fn handler(ctx: Context<CancelGroupMarket>) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let group = &mut ctx.accounts.group_market;

    require!(!group.resolved, PmAmmError::GroupAlreadyResolved);
    // Only cancel past expiration — prevents the authority from rugging a
    // live group by cancelling it before trades have run their course.
    require!(now >= group.end_ts, PmAmmError::GroupCancelTooEarly);

    group.resolved = true;
    group.winning_leg = NO_WINNING_LEG;

    msg!(
        "GroupMarket {} cancelled (no winner): all attached legs will resolve to Side::No",
        group.group_id
    );
    Ok(())
}
