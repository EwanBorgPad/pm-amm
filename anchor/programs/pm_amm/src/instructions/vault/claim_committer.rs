//! Binary vault claim — v2 (Sprint 24): mint outcome tokens to the committer.
//!
//! Each committer receives YES tokens for their YES commit and NO tokens
//! for their NO commit, 1:1 with their USDC commit. The USDC they put in
//! is transferred from the commitment vault to the market vault as
//! collateral backing the freshly-minted supply.
//!
//! Post-resolution flow:
//!   - Winning side committers call `claim_winnings` on the market: each
//!     winning token redeems for 1 USDC (the backing transferred at claim).
//!   - Losing side tokens are worthless.
//!
//! Solvency invariant maintained:
//!   market_vault.usdc >= max(yes_supply, no_supply)
//! After all claims: market_vault.usdc = total_commits = yes_total + no_total
//! and max(yes_supply, no_supply) ≤ yes_total + no_total ✓
//!
//! v1 returned USDC 1:1 with no outcome exposure — that path is gone.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, transfer, Mint, MintTo, Token, TokenAccount, Transfer};

use crate::errors::PmAmmError;
use crate::state::{CommitPosition, CommitmentVault, Market};

#[derive(Accounts)]
pub struct ClaimCommitter<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        seeds = [CommitmentVault::SEED, vault.vault_id.to_le_bytes().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Box<Account<'info, CommitmentVault>>,

    /// PDA-owned vault collateral ATA — source of the USDC backing transfer.
    #[account(
        mut,
        seeds = [crate::instructions::vault::VAULT_COLLATERAL_SEED, vault.key().as_ref()],
        bump,
    )]
    pub vault_collateral: Box<Account<'info, TokenAccount>>,

    pub collateral_mint: Box<Account<'info, Mint>>,

    /// The launched binary market — must match `vault.market`.
    #[account(
        mut,
        constraint = market.key() == vault.market @ PmAmmError::InvalidMarket,
    )]
    pub market: Box<Account<'info, Market>>,

    /// Market's USDC vault — destination of the backing transfer.
    #[account(mut, constraint = market_vault.key() == market.vault @ PmAmmError::InvalidVault)]
    pub market_vault: Box<Account<'info, TokenAccount>>,

    #[account(mut, constraint = yes_mint.key() == market.yes_mint @ PmAmmError::InvalidWinningMint)]
    pub yes_mint: Box<Account<'info, Mint>>,

    #[account(mut, constraint = no_mint.key() == market.no_mint @ PmAmmError::InvalidWinningMint)]
    pub no_mint: Box<Account<'info, Mint>>,

    /// User's YES ATA — init if missing.
    #[account(
        init_if_needed,
        payer = signer,
        associated_token::mint = yes_mint,
        associated_token::authority = signer,
    )]
    pub user_yes: Box<Account<'info, TokenAccount>>,

    /// User's NO ATA — init if missing.
    #[account(
        init_if_needed,
        payer = signer,
        associated_token::mint = no_mint,
        associated_token::authority = signer,
    )]
    pub user_no: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [CommitPosition::SEED, vault.key().as_ref(), signer.key().as_ref()],
        bump = commit_position.bump,
        constraint = commit_position.owner == signer.key() @ PmAmmError::Unauthorized,
        constraint = commit_position.vault == vault.key() @ PmAmmError::Unauthorized,
    )]
    pub commit_position: Box<Account<'info, CommitPosition>>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ClaimCommitter>) -> Result<()> {
    let vault = &ctx.accounts.vault;
    require!(vault.launched, PmAmmError::VaultNotLaunched);

    let position = &mut ctx.accounts.commit_position;
    require!(!position.claimed, PmAmmError::AlreadyClaimed);
    let yes_amount = position.yes_amount;
    let no_amount = position.no_amount;
    let total = position.total();
    require!(total > 0, PmAmmError::NoCommitFunds);

    // Phase 1: transfer USDC from commitment_vault to market_vault. Signed
    // by the commitment vault PDA.
    let vault_id_bytes = vault.vault_id.to_le_bytes();
    let vault_bump = vault.bump;
    let vault_seeds: &[&[&[u8]]] =
        &[&[CommitmentVault::SEED, vault_id_bytes.as_ref(), &[vault_bump]]];
    let tp = ctx.accounts.token_program.key();

    transfer(
        CpiContext::new_with_signer(
            tp,
            Transfer {
                from: ctx.accounts.vault_collateral.to_account_info(),
                to: ctx.accounts.market_vault.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            vault_seeds,
        ),
        total,
    )?;

    // Phase 2: mint YES / NO tokens to the user. Signed by the market PDA.
    let market = &ctx.accounts.market;
    let market_id_bytes = market.market_id.to_le_bytes();
    let market_bump = market.bump;
    let market_seeds: &[&[&[u8]]] =
        &[&[Market::SEED, market_id_bytes.as_ref(), &[market_bump]]];
    let market_info = ctx.accounts.market.to_account_info();

    if yes_amount > 0 {
        token::mint_to(
            CpiContext::new_with_signer(
                tp,
                MintTo {
                    mint: ctx.accounts.yes_mint.to_account_info(),
                    to: ctx.accounts.user_yes.to_account_info(),
                    authority: market_info.clone(),
                },
                market_seeds,
            ),
            yes_amount,
        )?;
    }

    if no_amount > 0 {
        token::mint_to(
            CpiContext::new_with_signer(
                tp,
                MintTo {
                    mint: ctx.accounts.no_mint.to_account_info(),
                    to: ctx.accounts.user_no.to_account_info(),
                    authority: market_info,
                },
                market_seeds,
            ),
            no_amount,
        )?;
    }

    position.claimed = true;
    msg!(
        "Binary claim {}: minted {} YES + {} NO, transferred {} USDC to market_vault",
        position.owner,
        yes_amount,
        no_amount,
        total
    );
    Ok(())
}
