/**
 * Curated list of popular Solana tokens for the collateral picker, plus helpers.
 * Markets can use ANY SPL mint as collateral — this list just provides nice
 * symbols/logos/decimals for the common ones; unknown mints fall back to
 * on-chain decimals + a short-mint symbol (see `useTokenInfo`).
 */
export interface TokenMeta {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
}

const SOLANA_LABELS_LOGO = (mint: string): string =>
  `https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/${mint}/logo.png`;

/** Popular tokens (mainnet mints) + this fork's devnet mock USDC. */
export const TOKEN_LIST: TokenMeta[] = [
  {
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    logoURI: SOLANA_LABELS_LOGO("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  },
  {
    mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    logoURI: SOLANA_LABELS_LOGO("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),
  },
  {
    mint: "So11111111111111111111111111111111111111112",
    symbol: "SOL",
    name: "Wrapped SOL",
    decimals: 9,
    logoURI: SOLANA_LABELS_LOGO("So11111111111111111111111111111111111111112"),
  },
  {
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    symbol: "BONK",
    name: "Bonk",
    decimals: 5,
    logoURI: SOLANA_LABELS_LOGO("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"),
  },
  {
    mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    symbol: "JUP",
    name: "Jupiter",
    decimals: 6,
    logoURI: "https://static.jup.ag/jup/icon.png",
  },
  {
    // Devnet mock USDC (this fork's faucet token).
    mint: "3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ",
    symbol: "mUSDC",
    name: "Mock USDC (devnet)",
    decimals: 6,
  },
];

/** Curated metadata for a mint, or undefined if not in the list. */
export function findToken(mint: string): TokenMeta | undefined {
  return TOKEN_LIST.find((t) => t.mint === mint);
}

/** Short display form for an unknown mint: "AbCd…WxYz". */
export function shortMint(mint: string): string {
  return mint.length > 9 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint;
}
