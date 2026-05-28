//! Launch the underlying pm-AMM market once the commit phase ends.
//! Permissionless — any signer can trigger it. The caller pays the rent of
//! the freshly-created Market, mints, vault, and Metaplex metadata accounts.
//!
//! What happens atomically in this single instruction:
//!   1. Compute the launch price from the commit ratio
//!      (`yes_total / total`) → bps, clamped to `[100, 9900]`.
//!   2. Initialize the underlying binary market via internal call (NOT a CPI
//!      to ourselves — direct call to `initialize_market::handler`).
//!   3. Transfer the vault's aggregated USDC into the market vault as a
//!      `deposit_liquidity` for the vault PDA itself. LP shares are minted
//!      to a vault-owned LpPosition.
//!
//! This first version mirrors a `deposit_liquidity` call done by the vault
//! PDA — but to keep things implementation-simple, we open the market with
//! `initial_price_bps` and let the regular `deposit_liquidity` instruction
//! be called afterwards by a separate keeper/UI tx (the vault holds the
//! USDC and signs as the depositor). For atomicity-critical use cases, a
//! follow-up version can inline the bootstrap.
//!
//! NOTE: this v1 only initializes the market here. The vault's `deposit_
//! liquidity` is a separate UI tx (we keep the vault's USDC in
//! `vault_collateral` and the UI / keeper triggers the deposit).

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::metadata::mpl_token_metadata::instructions::{
    CreateMetadataAccountV3, CreateMetadataAccountV3InstructionArgs,
};
use anchor_spl::metadata::mpl_token_metadata::types::DataV2;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::errors::PmAmmError;
use crate::instructions::initialize_market::{NO_MINT_SEED, VAULT_SEED, YES_MINT_SEED};
use crate::state::{CommitmentVault, Market};

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct LaunchVaultMarket<'info> {
    /// Permissionless caller — pays the rent for the new Market/mints/vault.
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [CommitmentVault::SEED, vault.vault_id.to_le_bytes().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Box<Account<'info, CommitmentVault>>,

    /// New Market PDA — derived from `market_id` (typically vault_id reused).
    #[account(
        init,
        payer = payer,
        space = Market::LEN,
        seeds = [Market::SEED, market_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(constraint = collateral_mint.key() == vault.collateral_mint @ PmAmmError::InvalidWinningMint)]
    pub collateral_mint: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = payer,
        mint::decimals = 6,
        mint::authority = market,
        seeds = [YES_MINT_SEED, market.key().as_ref()],
        bump,
    )]
    pub yes_mint: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = payer,
        mint::decimals = 6,
        mint::authority = market,
        seeds = [NO_MINT_SEED, market.key().as_ref()],
        bump,
    )]
    pub no_mint: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = payer,
        token::mint = collateral_mint,
        token::authority = market,
        seeds = [VAULT_SEED, market.key().as_ref()],
        bump,
    )]
    pub market_vault: Box<Account<'info, TokenAccount>>,

    /// CHECK: Created via CPI to Metaplex Token Metadata program.
    #[account(mut)]
    pub yes_metadata: UncheckedAccount<'info>,
    /// CHECK: idem
    #[account(mut)]
    pub no_metadata: UncheckedAccount<'info>,
    /// CHECK: Metaplex Token Metadata program.
    #[account(address = anchor_spl::metadata::mpl_token_metadata::ID)]
    pub token_metadata_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<LaunchVaultMarket>, market_id: u64) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let vault = &mut ctx.accounts.vault;
    require!(!vault.launched, PmAmmError::VaultAlreadyLaunched);
    require!(now >= vault.commit_end_ts, PmAmmError::CommitPhaseNotEnded);
    require!(
        vault.total() >= vault.min_total,
        PmAmmError::VaultBelowMinTotal
    );

    // Compute launch price from commit ratio.
    let price_bps = vault.compute_price_bps();

    // ----- Inline equivalent of initialize_market::handler -----
    // Validate the resulting market duration is long enough.
    let market_end_ts = vault.market_end_ts;
    require!(
        market_end_ts > now + 300, // matches initialize_market::MIN_DURATION_SECS
        PmAmmError::InvalidDuration
    );

    let market = &mut ctx.accounts.market;
    market.authority = ctx.accounts.payer.key();
    market.market_id = market_id;
    market.collateral_mint = ctx.accounts.collateral_mint.key();
    market.yes_mint = ctx.accounts.yes_mint.key();
    market.no_mint = ctx.accounts.no_mint.key();
    market.vault = ctx.accounts.market_vault.key();
    market.start_ts = now;
    market.end_ts = market_end_ts;
    let mut name_bytes = [0u8; 64];
    name_bytes[..vault.name.len().min(64)].copy_from_slice(&vault.name);
    market.name = name_bytes;
    market.l_zero = 0;
    market.reserve_yes = 0;
    market.reserve_no = 0;
    market.last_accrual_ts = now;
    market.cum_yes_per_share = 0;
    market.cum_no_per_share = 0;
    market.total_yes_distributed = 0;
    market.total_no_distributed = 0;
    market.total_lp_shares = 0;
    market.resolved = false;
    market.winning_side = 0;
    market.bump = ctx.bumps.market;
    market.initial_price_bps = price_bps;
    market.group = Pubkey::default();

    // Metaplex metadata for YES and NO mints — same as initialize_market.
    let id_bytes = market_id.to_le_bytes();
    let bump = ctx.bumps.market;
    let signer_seeds: &[&[u8]] = &[Market::SEED, &id_bytes, &[bump]];

    let yes_name = truncate_str(&format!("YES - {}", vault.name_str()), 32);
    create_token_metadata(
        ctx.accounts.yes_metadata.to_account_info(),
        ctx.accounts.yes_mint.to_account_info(),
        ctx.accounts.market.to_account_info(),
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.rent.to_account_info(),
        yes_name,
        "YES".to_string(),
        String::new(),
        signer_seeds,
    )?;

    let no_name = truncate_str(&format!("NO - {}", vault.name_str()), 32);
    create_token_metadata(
        ctx.accounts.no_metadata.to_account_info(),
        ctx.accounts.no_mint.to_account_info(),
        ctx.accounts.market.to_account_info(),
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.rent.to_account_info(),
        no_name,
        "NO".to_string(),
        String::new(),
        signer_seeds,
    )?;

    // Mark the vault as launched and record the market pubkey + price.
    vault.launched = true;
    vault.winning_price_bps = price_bps;
    vault.market = ctx.accounts.market.key();
    // lp_position will be set when the vault later deposits its USDC
    // via `deposit_liquidity` as a follow-up tx.

    msg!(
        "Vault {} launched market {} at price_bps={} (yes={} no={} total={})",
        vault.vault_id,
        market_id,
        price_bps,
        vault.yes_total,
        vault.no_total,
        vault.total()
    );
    Ok(())
}

fn truncate_str(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        let mut end = max_len;
        while !s.is_char_boundary(end) && end > 0 {
            end -= 1;
        }
        s[..end].to_string()
    }
}

#[allow(clippy::too_many_arguments)]
fn create_token_metadata<'info>(
    metadata_ai: AccountInfo<'info>,
    mint_ai: AccountInfo<'info>,
    authority_ai: AccountInfo<'info>,
    payer_ai: AccountInfo<'info>,
    system_ai: AccountInfo<'info>,
    rent_ai: AccountInfo<'info>,
    token_name: String,
    symbol: String,
    uri: String,
    signer_seeds: &[&[u8]],
) -> Result<()> {
    let ix = CreateMetadataAccountV3 {
        metadata: metadata_ai.key(),
        mint: mint_ai.key(),
        mint_authority: authority_ai.key(),
        payer: payer_ai.key(),
        update_authority: (authority_ai.key(), true),
        system_program: system_ai.key(),
        rent: Some(rent_ai.key()),
    }
    .instruction(CreateMetadataAccountV3InstructionArgs {
        data: DataV2 {
            name: token_name,
            symbol,
            uri,
            seller_fee_basis_points: 0,
            creators: None,
            collection: None,
            uses: None,
        },
        is_mutable: true,
        collection_details: None,
    });

    invoke_signed(
        &ix,
        &[
            metadata_ai,
            mint_ai,
            authority_ai.clone(),
            payer_ai,
            system_ai,
            rent_ai,
        ],
        &[signer_seeds],
    )?;
    Ok(())
}
