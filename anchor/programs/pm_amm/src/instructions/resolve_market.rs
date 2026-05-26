//! Resolve a market after expiration. Authority only.
//! Sets winning side, triggers final accrual to release all remaining reserves.

use anchor_lang::prelude::*;

use crate::accrual;
use crate::errors::PmAmmError;
use crate::state::{Market, Side};

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    pub signer: Signer<'info>,

    #[account(
        mut,
        constraint = market.authority == signer.key() @ PmAmmError::Unauthorized,
    )]
    pub market: Box<Account<'info, Market>>,
}

/// Set the winning side after market expiration (authority only).
///
/// Rejects legs attached to a GroupMarket — those MUST resolve through the
/// cascade (`resolve_group_leg`) so the group's `winning_leg` is the single
/// source of truth. Use `cancel_group_market` first if the group is abandoned.
pub fn handler(ctx: Context<ResolveMarket>, winning_side: Side) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let market = &mut ctx.accounts.market;

    require!(!market.resolved, PmAmmError::MarketAlreadyResolved);
    require!(now >= market.end_ts, PmAmmError::MarketNotExpired);
    require!(
        !market.is_attached_to_group(),
        PmAmmError::LegMustCascadeResolve
    );

    // Final accrual — releases all remaining reserves to LPs
    accrual::accrue_first(market, now)?;

    market.resolved = true;
    market.set_winning_side(winning_side);

    msg!(
        "Market {} resolved: winning_side={:?}",
        market.market_id,
        winning_side
    );

    Ok(())
}
