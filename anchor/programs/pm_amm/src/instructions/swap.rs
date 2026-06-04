//! Swap between USDC, YES, and NO tokens — with a protocol trading fee.
//!
//! A 2% fee (`SWAP_FEE_BPS`) is taken on the USDC leg of every swap and split
//! 50/50 between the protocol DAO (`PROTOCOL_DAO`) and the market creator
//! (`market.authority`):
//!   - USDC-in  (UsdcToYes/UsdcToNo): fee is skimmed off the input; only the net
//!     trades on the curve and backs the vault.
//!   - USDC-out (YesToUsdc/NoToUsdc): fee is skimmed off the curve's USDC output;
//!     the vault still pays the full gross out (user net + fee), so solvency is
//!     unchanged.
//!   - YES<->NO: no USDC leg, no fee.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};
use fixed::types::I80F48;

use crate::accrual;
use crate::errors::PmAmmError;
use crate::pm_math::{self, SwapSide};
use crate::state::Market;

/// Protocol trading fee in basis points (2%). Split 50/50 DAO / creator.
pub const SWAP_FEE_BPS: u64 = 200;

/// Protocol DAO (Combinator Predict) — receives 50% of the swap fee.
pub const PROTOCOL_DAO: Pubkey = pubkey!("HKLjYENZaFghSp2TM5VJad32wVu7d2XCMJZqKGTQ3ZeL");

/// `amount * SWAP_FEE_BPS / 10_000` in u128 to avoid overflow.
#[inline(always)]
fn fee_of(amount: u64) -> u64 {
    ((amount as u128) * (SWAP_FEE_BPS as u128) / 10_000u128) as u64
}

/// Direction of a swap. Six combinations covering all USDC/YES/NO pairs.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub enum SwapDirection {
    /// Buy YES tokens with USDC (mint YES, deposit USDC).
    UsdcToYes,
    /// Buy NO tokens with USDC (mint NO, deposit USDC).
    UsdcToNo,
    /// Sell YES tokens for USDC (burn YES, withdraw USDC).
    YesToUsdc,
    /// Sell NO tokens for USDC (burn NO, withdraw USDC).
    NoToUsdc,
    /// Convert YES to NO (burn YES, mint NO).
    YesToNo,
    /// Convert NO to YES (burn NO, mint YES).
    NoToYes,
}

impl SwapDirection {
    fn to_sides(&self) -> (SwapSide, SwapSide) {
        match self {
            Self::UsdcToYes => (SwapSide::Usdc, SwapSide::Yes),
            Self::UsdcToNo => (SwapSide::Usdc, SwapSide::No),
            Self::YesToUsdc => (SwapSide::Yes, SwapSide::Usdc),
            Self::NoToUsdc => (SwapSide::No, SwapSide::Usdc),
            Self::YesToNo => (SwapSide::Yes, SwapSide::No),
            Self::NoToYes => (SwapSide::No, SwapSide::Yes),
        }
    }
    fn is_usdc_in(&self) -> bool {
        matches!(self, Self::UsdcToYes | Self::UsdcToNo)
    }
    fn is_usdc_out(&self) -> bool {
        matches!(self, Self::YesToUsdc | Self::NoToUsdc)
    }
}

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        has_one = yes_mint,
        has_one = no_mint,
        has_one = vault,
        has_one = collateral_mint,
    )]
    pub market: Box<Account<'info, Market>>,

    pub collateral_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub yes_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub no_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub vault: Box<Account<'info, TokenAccount>>,

    #[account(mut, constraint = user_collateral.mint == market.collateral_mint, constraint = user_collateral.owner == signer.key())]
    pub user_collateral: Box<Account<'info, TokenAccount>>,
    #[account(mut, constraint = user_yes.mint == market.yes_mint, constraint = user_yes.owner == signer.key())]
    pub user_yes: Box<Account<'info, TokenAccount>>,
    #[account(mut, constraint = user_no.mint == market.no_mint, constraint = user_no.owner == signer.key())]
    pub user_no: Box<Account<'info, TokenAccount>>,

    /// Protocol DAO's USDC ATA — receives 50% of the swap fee.
    #[account(
        mut,
        constraint = dao_usdc.mint == market.collateral_mint @ PmAmmError::InvalidVault,
        constraint = dao_usdc.owner == PROTOCOL_DAO @ PmAmmError::Unauthorized,
    )]
    pub dao_usdc: Box<Account<'info, TokenAccount>>,
    /// Market creator's USDC ATA — receives 50% of the swap fee. OPTIONAL: pass
    /// `None` when the swapper IS the creator (they keep their fee share), which
    /// also avoids a duplicate-mutable-account error with `user_collateral`.
    /// Validated in the handler when present (owner == market.authority).
    #[account(mut)]
    pub creator_usdc: Option<Box<Account<'info, TokenAccount>>>,

    pub token_program: Program<'info, Token>,
}

/// Swap between USDC, YES, and NO tokens (6 directions), with a 2% USDC-leg fee.
pub fn handler(
    ctx: Context<Swap>,
    direction: SwapDirection,
    amount_in: u64,
    min_output: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    require!(amount_in > 0, PmAmmError::InvalidBudget);

    // Fee on the USDC input (USDC-in directions). The net amount trades + backs.
    let fee_in = if direction.is_usdc_in() {
        fee_of(amount_in)
    } else {
        0
    };
    let swap_in = amount_in.saturating_sub(fee_in); // net USDC traded / tokens burned
    require!(swap_in > 0, PmAmmError::InvalidBudget);

    // --- Phase 1: compute + update market ---
    let output_u64: u64;
    let fee_out: u64;
    let market_id_bytes: [u8; 8];
    let bump: u8;
    {
        let market = &mut ctx.accounts.market;
        require!(!market.resolved, PmAmmError::MarketAlreadyResolved);
        require!(market.l_zero > 0, PmAmmError::InsufficientLiquidity);
        accrual::accrue_first(market, now)?;

        let time_remaining = market.end_ts - now;
        require!(time_remaining > 0, PmAmmError::MarketExpired);

        let l_eff = market.l_effective(now)?;
        let (side_in, side_out) = direction.to_sides();
        let result = pm_math::compute_swap_output(
            market.reserve_yes_fixed(),
            market.reserve_no_fixed(),
            l_eff,
            I80F48::from_num(swap_in),
            side_in,
            side_out,
        )?;

        output_u64 = result.output.max(I80F48::ZERO).to_num::<u64>();
        require!(output_u64 > 0, PmAmmError::InsufficientOutput);

        // Fee on the USDC output (USDC-out directions). The user receives net.
        fee_out = if direction.is_usdc_out() {
            fee_of(output_u64)
        } else {
            0
        };
        let user_receives = output_u64.saturating_sub(fee_out);
        require!(user_receives >= min_output, PmAmmError::SlippageExceeded);

        // USDC-out: the vault must cover the FULL gross output (user net + fee).
        if direction.is_usdc_out() {
            require!(
                ctx.accounts.vault.amount >= output_u64,
                PmAmmError::InsufficientVault
            );
        }

        // SOLVENCY GUARD (fix #1): after this trade the vault must still cover
        // max over YES/NO of (circulating supply + remaining reserve). The fee
        // never touches the YES/NO supply; on USDC-in only the NET enters the
        // vault, on USDC-out the full gross leaves it.
        {
            let ys = ctx.accounts.yes_mint.supply;
            let ns = ctx.accounts.no_mint.supply;
            let v = ctx.accounts.vault.amount;
            let rx = result.x_new.max(I80F48::ZERO).to_num::<u64>();
            let ry = result.y_new.max(I80F48::ZERO).to_num::<u64>();
            let (post_ys, post_ns, post_vault) = match direction {
                SwapDirection::UsdcToYes => {
                    (ys.saturating_add(output_u64), ns, v.saturating_add(swap_in))
                }
                SwapDirection::UsdcToNo => {
                    (ys, ns.saturating_add(output_u64), v.saturating_add(swap_in))
                }
                SwapDirection::YesToUsdc => (
                    ys.saturating_sub(amount_in),
                    ns,
                    v.saturating_sub(output_u64),
                ),
                SwapDirection::NoToUsdc => (
                    ys,
                    ns.saturating_sub(amount_in),
                    v.saturating_sub(output_u64),
                ),
                SwapDirection::YesToNo => (
                    ys.saturating_sub(amount_in),
                    ns.saturating_add(output_u64),
                    v,
                ),
                SwapDirection::NoToYes => (
                    ys.saturating_add(output_u64),
                    ns.saturating_sub(amount_in),
                    v,
                ),
            };
            let obligation = post_ys.saturating_add(rx).max(post_ns.saturating_add(ry));
            require!(post_vault >= obligation, PmAmmError::InsufficientVault);
        }

        market_id_bytes = market.market_id.to_le_bytes();
        bump = market.bump;
        market.set_reserve_yes_fixed(result.x_new);
        market.set_reserve_no_fixed(result.y_new);
    }

    // --- Phase 2: CPI ---
    let seeds: &[&[&[u8]]] = &[&[Market::SEED, market_id_bytes.as_ref(), &[bump]]];
    let tp = ctx.accounts.token_program.key();
    let market_info = ctx.accounts.market.to_account_info();

    // Total fee (only one of fee_in / fee_out is non-zero) split 50/50.
    let total_fee = fee_in + fee_out;
    let dao_cut = total_fee / 2;
    let creator_cut = total_fee - dao_cut;

    // Validate the optional creator fee account (absent => swapper is the
    // creator, who keeps their own share).
    if let Some(creator) = ctx.accounts.creator_usdc.as_ref() {
        require!(
            creator.owner == ctx.accounts.market.authority,
            PmAmmError::Unauthorized
        );
        require!(
            creator.mint == ctx.accounts.market.collateral_mint,
            PmAmmError::InvalidVault
        );
    }

    match direction {
        SwapDirection::UsdcToYes | SwapDirection::UsdcToNo => {
            // Net USDC → vault (backing); fee → DAO + creator (user signs).
            token::transfer(
                CpiContext::new(
                    tp,
                    Transfer {
                        from: ctx.accounts.user_collateral.to_account_info(),
                        to: ctx.accounts.vault.to_account_info(),
                        authority: ctx.accounts.signer.to_account_info(),
                    },
                ),
                swap_in,
            )?;
            if dao_cut > 0 {
                token::transfer(
                    CpiContext::new(
                        tp,
                        Transfer {
                            from: ctx.accounts.user_collateral.to_account_info(),
                            to: ctx.accounts.dao_usdc.to_account_info(),
                            authority: ctx.accounts.signer.to_account_info(),
                        },
                    ),
                    dao_cut,
                )?;
            }
            if creator_cut > 0 {
                if let Some(creator) = ctx.accounts.creator_usdc.as_ref() {
                    token::transfer(
                        CpiContext::new(
                            tp,
                            Transfer {
                                from: ctx.accounts.user_collateral.to_account_info(),
                                to: creator.to_account_info(),
                                authority: ctx.accounts.signer.to_account_info(),
                            },
                        ),
                        creator_cut,
                    )?;
                }
                // else: swapper IS the creator → they keep creator_cut
                // (only swap_in + dao_cut left their account).
            }
            let mint_ai = if matches!(direction, SwapDirection::UsdcToYes) {
                ctx.accounts.yes_mint.to_account_info()
            } else {
                ctx.accounts.no_mint.to_account_info()
            };
            let to_ai = if matches!(direction, SwapDirection::UsdcToYes) {
                ctx.accounts.user_yes.to_account_info()
            } else {
                ctx.accounts.user_no.to_account_info()
            };
            token::mint_to(
                CpiContext::new_with_signer(
                    tp,
                    MintTo {
                        mint: mint_ai,
                        to: to_ai,
                        authority: market_info,
                    },
                    seeds,
                ),
                output_u64,
            )?;
        }
        SwapDirection::YesToUsdc | SwapDirection::NoToUsdc => {
            let burn_mint = if matches!(direction, SwapDirection::YesToUsdc) {
                ctx.accounts.yes_mint.to_account_info()
            } else {
                ctx.accounts.no_mint.to_account_info()
            };
            let burn_from = if matches!(direction, SwapDirection::YesToUsdc) {
                ctx.accounts.user_yes.to_account_info()
            } else {
                ctx.accounts.user_no.to_account_info()
            };
            token::burn(
                CpiContext::new(
                    tp,
                    Burn {
                        mint: burn_mint,
                        from: burn_from,
                        authority: ctx.accounts.signer.to_account_info(),
                    },
                ),
                amount_in,
            )?;
            // Net USDC → user; fee → DAO + creator (vault PDA signs). When the
            // swapper IS the creator (creator_usdc = None), fold creator_cut
            // back into their payout.
            let creator_present = ctx.accounts.creator_usdc.is_some();
            let to_user =
                output_u64.saturating_sub(fee_out) + if creator_present { 0 } else { creator_cut };
            token::transfer(
                CpiContext::new_with_signer(
                    tp,
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.user_collateral.to_account_info(),
                        authority: market_info.clone(),
                    },
                    seeds,
                ),
                to_user,
            )?;
            if dao_cut > 0 {
                token::transfer(
                    CpiContext::new_with_signer(
                        tp,
                        Transfer {
                            from: ctx.accounts.vault.to_account_info(),
                            to: ctx.accounts.dao_usdc.to_account_info(),
                            authority: market_info.clone(),
                        },
                        seeds,
                    ),
                    dao_cut,
                )?;
            }
            if creator_cut > 0 {
                if let Some(creator) = ctx.accounts.creator_usdc.as_ref() {
                    token::transfer(
                        CpiContext::new_with_signer(
                            tp,
                            Transfer {
                                from: ctx.accounts.vault.to_account_info(),
                                to: creator.to_account_info(),
                                authority: market_info,
                            },
                            seeds,
                        ),
                        creator_cut,
                    )?;
                }
            }
        }
        SwapDirection::YesToNo => {
            token::burn(
                CpiContext::new(
                    tp,
                    Burn {
                        mint: ctx.accounts.yes_mint.to_account_info(),
                        from: ctx.accounts.user_yes.to_account_info(),
                        authority: ctx.accounts.signer.to_account_info(),
                    },
                ),
                amount_in,
            )?;
            token::mint_to(
                CpiContext::new_with_signer(
                    tp,
                    MintTo {
                        mint: ctx.accounts.no_mint.to_account_info(),
                        to: ctx.accounts.user_no.to_account_info(),
                        authority: market_info,
                    },
                    seeds,
                ),
                output_u64,
            )?;
        }
        SwapDirection::NoToYes => {
            token::burn(
                CpiContext::new(
                    tp,
                    Burn {
                        mint: ctx.accounts.no_mint.to_account_info(),
                        from: ctx.accounts.user_no.to_account_info(),
                        authority: ctx.accounts.signer.to_account_info(),
                    },
                ),
                amount_in,
            )?;
            token::mint_to(
                CpiContext::new_with_signer(
                    tp,
                    MintTo {
                        mint: ctx.accounts.yes_mint.to_account_info(),
                        to: ctx.accounts.user_yes.to_account_info(),
                        authority: market_info,
                    },
                    seeds,
                ),
                output_u64,
            )?;
        }
    }

    Ok(())
}
