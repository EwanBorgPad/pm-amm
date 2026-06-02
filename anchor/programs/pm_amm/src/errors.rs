//! Error codes for pm-AMM program.

use anchor_lang::prelude::*;

#[error_code]
pub enum PmAmmError {
    #[msg("Market already resolved")]
    MarketAlreadyResolved,
    #[msg("Market not yet resolved")]
    MarketNotResolved,
    #[msg("Market has expired")]
    MarketExpired,
    #[msg("Market has not expired yet")]
    MarketNotExpired,
    #[msg("Insufficient liquidity or balance")]
    InsufficientLiquidity,
    #[msg("Swap output below minimum")]
    InsufficientOutput,
    #[msg("Insufficient user token balance")]
    InsufficientBalance,
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid price: must be in (0, 1)")]
    InvalidPrice,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("No residuals to claim")]
    NoResidualsToClaim,
    #[msg("Invalid duration")]
    InvalidDuration,
    #[msg("Invalid budget or amount")]
    InvalidBudget,
    #[msg("Invalid winning mint: does not match resolved side")]
    InvalidWinningMint,
    #[msg("Insufficient vault balance")]
    InsufficientVault,
    #[msg("Invalid name: must be 1-64 bytes")]
    InvalidName,
    #[msg("Invalid leg count: must be between 2 and MAX_LEGS")]
    InvalidLegCount,
    #[msg("Invalid leg index: out of bounds for this group")]
    InvalidLegIndex,
    #[msg("Leg slot already attached")]
    LegAlreadyAttached,
    #[msg("Leg market does not match the slot stored on the group")]
    LegMismatch,
    #[msg("Group market already resolved")]
    GroupAlreadyResolved,
    #[msg("Group market not yet resolved")]
    GroupNotResolved,
    #[msg("Group market not yet expired")]
    GroupNotExpired,
    #[msg("Group market has missing legs (must attach all N legs first)")]
    GroupIncomplete,
    #[msg("Leg market end_ts does not match group end_ts")]
    LegEndTsMismatch,
    #[msg("Leg attached to a group must resolve via resolve_group_leg")]
    LegMustCascadeResolve,
    #[msg("Group can only be cancelled after expiration")]
    GroupCancelTooEarly,
    // ----- Commitment Vault (Sprint 22) -----
    #[msg("Vault is already launched")]
    VaultAlreadyLaunched,
    #[msg("Vault is not yet launched")]
    VaultNotLaunched,
    #[msg("Vault commit phase has not started or already ended")]
    CommitPhaseClosed,
    #[msg("Vault commit phase has not yet ended")]
    CommitPhaseNotEnded,
    #[msg("Commit amount below MIN_COMMIT_USDC")]
    CommitTooSmall,
    #[msg("Vault total below min_total threshold")]
    VaultBelowMinTotal,
    #[msg("Invalid commit duration: must be 1 min ≤ d ≤ 7 days")]
    InvalidCommitDuration,
    #[msg("Invalid market duration: must be 5 min ≤ d ≤ 30 days")]
    InvalidMarketDuration,
    #[msg("Commit position already claimed")]
    AlreadyClaimed,
    #[msg("Refund only available if vault is unlaunched and either commit ended below threshold OR commit ended without launch")]
    RefundNotAvailable,
    #[msg("Commit position has no funds to claim or refund")]
    NoCommitFunds,
    // ----- Multi-outcome Commitment Vault (Sprint 23) -----
    #[msg("Vault group leg index out of bounds (>= leg_count)")]
    VaultGroupLegOutOfBounds,
    #[msg("Vault group leg already launched")]
    VaultGroupLegAlreadyLaunched,
    #[msg("Vault group: not all legs launched yet")]
    VaultGroupNotAllLegsLaunched,
    #[msg("Vault group leg has insufficient share (< 100 bps after rounding)")]
    VaultGroupInsufficientLegShare,
    #[msg("Vault group: group market not yet created")]
    VaultGroupNotInitialized,
    #[msg("Invalid leg name: must be 1-32 bytes")]
    InvalidLegName,
    #[msg("Market account does not match the one stored on the vault")]
    InvalidMarket,
    #[msg("Market vault token account does not match market.vault")]
    InvalidVault,
}
