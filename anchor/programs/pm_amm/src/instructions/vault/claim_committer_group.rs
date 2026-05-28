//! Multi-outcome vault claim — v2 (Sprint 24): mint leg YES tokens.
//!
//! Per-leg claim: each call mints YES tokens of leg `leg_index` to the
//! committer for their share of that leg, 1:1 with the USDC they committed.
//! The corresponding USDC is transferred from the commitment vault to the
//! leg's market vault as backing.
//!
//! Users with N legs committed call this N times. We chose this over a
//! single "claim all" instruction to keep account count and compute budget
//! comfortably under their per-tx limits (one leg launch creates a Market
//! + 2 mints + a vault + 2 metadata accounts, so claiming all 8 in one tx
//! would balloon to 40+ accounts).
//!
//! Resolution flow: after `resolve_group` + cascade, the winning leg's
//! YES tokens redeem for 1 USDC each via `claim_winnings`; losing legs'
//! YES tokens are worthless. So "I bet on leg i" exposure is exactly
//! "I hold leg-i YES tokens" — a clean parimutuel position.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, transfer, Mint, MintTo, Token, TokenAccount, Transfer};

use crate::errors::PmAmmError;
use crate::instructions::vault::initialize_vault_group::VAULT_GROUP_COLLATERAL_SEED;
use crate::state::{CommitPositionGroup, CommitmentVaultGroup, GroupMarket, Market};

#[derive(Accounts)]
#[instruction(leg_index: u8)]
pub struct ClaimCommitterGroup<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        seeds = [CommitmentVaultGroup::SEED, vault.vault_id.to_le_bytes().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Box<Account<'info, CommitmentVaultGroup>>,

    #[account(
        mut,
        seeds = [VAULT_GROUP_COLLATERAL_SEED, vault.key().as_ref()],
        bump,
    )]
    pub vault_collateral: Box<Account<'info, TokenAccount>>,

    pub collateral_mint: Box<Account<'info, Mint>>,

    /// The wrapping GroupMarket — verified against vault.group_market.
    #[account(
        seeds = [GroupMarket::SEED, group_market.group_id.to_le_bytes().as_ref()],
        bump = group_market.bump,
        constraint = group_market.key() == vault.group_market @ PmAmmError::Unauthorized,
    )]
    pub group_market: Box<Account<'info, GroupMarket>>,

    /// Leg `leg_index`'s binary market — verified against group.legs[i].
    #[account(mut)]
    pub market: Box<Account<'info, Market>>,

    /// Leg market's USDC vault — destination of the backing transfer.
    #[account(mut, constraint = market_vault.key() == market.vault @ PmAmmError::InvalidVault)]
    pub market_vault: Box<Account<'info, TokenAccount>>,

    #[account(mut, constraint = yes_mint.key() == market.yes_mint @ PmAmmError::InvalidWinningMint)]
    pub yes_mint: Box<Account<'info, Mint>>,

    /// User's YES ATA for this leg — init if missing.
    #[account(
        init_if_needed,
        payer = signer,
        associated_token::mint = yes_mint,
        associated_token::authority = signer,
    )]
    pub user_yes: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [CommitPositionGroup::SEED, vault.key().as_ref(), signer.key().as_ref()],
        bump = commit_position.bump,
        constraint = commit_position.owner == signer.key() @ PmAmmError::Unauthorized,
        constraint = commit_position.vault == vault.key() @ PmAmmError::Unauthorized,
    )]
    pub commit_position: Box<Account<'info, CommitPositionGroup>>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ClaimCommitterGroup>, leg_index: u8) -> Result<()> {
    let vault = &ctx.accounts.vault;
    let position = &mut ctx.accounts.commit_position;

    // Refund and claim are mutually exclusive paths.
    require!(!position.claimed, PmAmmError::AlreadyClaimed);
    require!(
        (leg_index as usize) < vault.leg_count as usize,
        PmAmmError::VaultGroupLegOutOfBounds
    );

    let leg = leg_index as usize;
    let amount = position.leg_amounts[leg];
    require!(amount > 0, PmAmmError::NoCommitFunds);

    // The passed leg market must match the group's `legs[leg_index]`.
    let group = &ctx.accounts.group_market;
    let expected_leg = group.legs[leg];
    require!(
        expected_leg != Pubkey::default(),
        PmAmmError::VaultGroupNotAllLegsLaunched
    );
    require!(
        ctx.accounts.market.key() == expected_leg,
        PmAmmError::LegMismatch
    );

    // Phase 1: USDC commitment_vault → leg market_vault (vault PDA signs).
    let vault_id_bytes = vault.vault_id.to_le_bytes();
    let vault_bump = vault.bump;
    let vault_seeds: &[&[&[u8]]] =
        &[&[CommitmentVaultGroup::SEED, vault_id_bytes.as_ref(), &[vault_bump]]];
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
        amount,
    )?;

    // Phase 2: mint leg YES tokens to user (leg market PDA signs).
    let market = &ctx.accounts.market;
    let market_id_bytes = market.market_id.to_le_bytes();
    let market_bump = market.bump;
    let market_seeds: &[&[&[u8]]] =
        &[&[Market::SEED, market_id_bytes.as_ref(), &[market_bump]]];

    token::mint_to(
        CpiContext::new_with_signer(
            tp,
            MintTo {
                mint: ctx.accounts.yes_mint.to_account_info(),
                to: ctx.accounts.user_yes.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            market_seeds,
        ),
        amount,
    )?;

    // Mark this leg as claimed by zeroing its amount. The position struct
    // is "fully claimed" when all leg_amounts are 0; that's also the state
    // a never-committed leg has, but new commits can't happen post-launch
    // (`vault_commit_group` rejects after `group_market_initialized`).
    position.leg_amounts[leg] = 0;

    msg!(
        "Multi claim {}: leg {} → minted {} YES, transferred {} USDC",
        position.owner,
        leg_index,
        amount,
        amount
    );
    Ok(())
}
