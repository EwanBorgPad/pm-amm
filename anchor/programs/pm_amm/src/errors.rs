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
}
