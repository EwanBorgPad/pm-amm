//! On-chain state for pm-AMM: Market and LpPosition accounts.
//!
//! All fixed-point fields use Q64.64 encoding (stored as `u128`, converted via
//! `I80F48` helpers). See the Paradigm pm-AMM paper for formula references.

use anchor_lang::prelude::*;
use fixed::types::I80F48;

// ============================================================================
// Side enum
// ============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Yes,
    No,
}

// ============================================================================
// Market — PDA seeds: [b"market", market_id.to_le_bytes()]
// ============================================================================

#[account]
pub struct Market {
    pub authority: Pubkey,
    pub market_id: u64,
    pub collateral_mint: Pubkey, // USDC
    pub yes_mint: Pubkey,
    pub no_mint: Pubkey,
    pub vault: Pubkey, // single USDC vault

    pub start_ts: i64,
    pub end_ts: i64, // T (expiration)

    // AMM params — Q64.64 stored as u128
    pub l_zero: u128,      // L_0 constant
    pub reserve_yes: u128, // x (YES reserve)
    pub reserve_no: u128,  // y (NO reserve)

    // Accrual dC_t — per-share accumulators (Q64.64)
    pub last_accrual_ts: i64,
    pub cum_yes_per_share: u128, // cumulative YES released per LP share
    pub cum_no_per_share: u128,  // cumulative NO released per LP share

    // Stats
    pub total_yes_distributed: u64, // total YES tokens distributed to LPs
    pub total_no_distributed: u64,  // total NO tokens distributed to LPs

    // LP accounting
    pub total_lp_shares: u128,

    // Resolution
    pub resolved: bool,
    pub winning_side: u8, // 0 = unresolved, 1 = Yes, 2 = No

    pub bump: u8,

    // Market name (UTF-8, zero-padded)
    pub name: [u8; 64],

    // EXTENSION over the paper: initial YES price in basis points.
    // 5000 = 50%, range [100, 9900]. Used at first deposit to seed reserves.
    // 0 = legacy default (50%). The per-leg math stays paper-exact; only the
    // calibration point moves.
    pub initial_price_bps: u16,

    // EXTENSION over the paper: GroupMarket PDA this leg is attached to.
    // Pubkey::default() = standalone binary market. Set by attach_leg_to_group;
    // checked by resolve_market to force the cascade path (resolve_group_leg)
    // on attached legs.
    //
    // WRITE-ONCE BY DESIGN: there is no `detach_leg_from_group` instruction.
    // A market is "consumed" by the first group it joins — even after that
    // group resolves or is cancelled, the market cannot be reattached to a
    // new group. This keeps the cascade guard (`resolve_market` rejecting
    // attached legs) tamper-proof: once a leg has been committed to a group,
    // its outcome is settled exclusively by that group's `winning_leg`.
    // If reuse is needed later, a `detach_leg_from_group` instruction
    // gated on (group.resolved || group.winning_leg == NO_WINNING_LEG)
    // would be the right shape — left out for the hackathon scope.
    pub group: Pubkey,
}

impl Market {
    pub const SEED: &'static [u8] = b"market";

    /// Space: 8 discriminator + fields + padding.
    /// Total stays at 443 bytes — `initial_price_bps` (2) + `group` (32) fit
    /// in the previously-reserved 64-byte tail, leaving 30 bytes of padding
    /// for future expansion.
    pub const LEN: usize = 8 // discriminator
        + 32 // authority
        + 8  // market_id
        + 32 // collateral_mint
        + 32 // yes_mint
        + 32 // no_mint
        + 32 // vault
        + 8  // start_ts
        + 8  // end_ts
        + 16 // l_zero
        + 16 // reserve_yes
        + 16 // reserve_no
        + 8  // last_accrual_ts
        + 16 // cum_yes_per_share
        + 16 // cum_no_per_share
        + 8  // total_yes_distributed
        + 8  // total_no_distributed
        + 16 // total_lp_shares
        + 1  // resolved
        + 1  // winning_side
        + 1  // bump
        + 64 // name
        + 2  // initial_price_bps (EXTENSION)
        + 32 // group (EXTENSION)
        + 30; // padding (was 64 — 2 + 32 consumed by extensions)

    // --- Q64.64 helpers ---

    pub fn l_zero_fixed(&self) -> I80F48 {
        I80F48::from_bits(self.l_zero as i128)
    }
    pub fn set_l_zero_fixed(&mut self, v: I80F48) {
        self.l_zero = v.to_bits() as u128;
    }

    pub fn reserve_yes_fixed(&self) -> I80F48 {
        I80F48::from_bits(self.reserve_yes as i128)
    }
    pub fn set_reserve_yes_fixed(&mut self, v: I80F48) {
        self.reserve_yes = v.to_bits() as u128;
    }

    pub fn reserve_no_fixed(&self) -> I80F48 {
        I80F48::from_bits(self.reserve_no as i128)
    }
    pub fn set_reserve_no_fixed(&mut self, v: I80F48) {
        self.reserve_no = v.to_bits() as u128;
    }

    pub fn cum_yes_per_share_fixed(&self) -> I80F48 {
        I80F48::from_bits(self.cum_yes_per_share as i128)
    }
    pub fn set_cum_yes_per_share_fixed(&mut self, v: I80F48) {
        self.cum_yes_per_share = v.to_bits() as u128;
    }

    pub fn cum_no_per_share_fixed(&self) -> I80F48 {
        I80F48::from_bits(self.cum_no_per_share as i128)
    }
    pub fn set_cum_no_per_share_fixed(&mut self, v: I80F48) {
        self.cum_no_per_share = v.to_bits() as u128;
    }

    pub fn total_lp_shares_fixed(&self) -> I80F48 {
        I80F48::from_bits(self.total_lp_shares as i128)
    }
    pub fn set_total_lp_shares_fixed(&mut self, v: I80F48) {
        self.total_lp_shares = v.to_bits() as u128;
    }

    /// Return the market name as a UTF-8 string (trailing zeros trimmed).
    pub fn name_str(&self) -> &str {
        let len = self
            .name
            .iter()
            .position(|&b| b == 0)
            .unwrap_or(self.name.len());
        core::str::from_utf8(&self.name[..len]).unwrap_or("")
    }

    /// L_eff = L_0 * sqrt(T - t). Paper section 8.
    pub fn l_effective(&self, now: i64) -> Result<I80F48> {
        crate::pm_math::l_effective(self.l_zero_fixed(), self.end_ts - now)
    }

    /// Resolved initial YES price as I80F48 fraction.
    /// 0 (legacy / unset) maps to 0.5. Otherwise basis points / 10_000.
    pub fn initial_price_fixed(&self) -> I80F48 {
        let bps = if self.initial_price_bps == 0 {
            5000u32
        } else {
            self.initial_price_bps as u32
        };
        I80F48::from_num(bps) / I80F48::from_num(10_000u32)
    }

    /// True iff this market is attached to a GroupMarket (cascade-resolved).
    /// Standalone binary markets have `group == Pubkey::default()`.
    pub fn is_attached_to_group(&self) -> bool {
        self.group != Pubkey::default()
    }

    /// Return the resolved winning side, or None if not yet resolved.
    pub fn get_winning_side(&self) -> Option<Side> {
        match self.winning_side {
            1 => Some(Side::Yes),
            2 => Some(Side::No),
            _ => None,
        }
    }

    /// Set the winning side (1 = YES, 2 = NO).
    pub fn set_winning_side(&mut self, side: Side) {
        self.winning_side = match side {
            Side::Yes => 1,
            Side::No => 2,
        };
    }
}

// ============================================================================
// LpPosition — PDA seeds: [b"lp", market.key(), owner.key()]
// ============================================================================

#[account]
pub struct LpPosition {
    pub owner: Pubkey,
    pub market: Pubkey,
    pub shares: u128,
    pub collateral_deposited: u64,
    pub yes_per_share_checkpoint: u128,
    pub no_per_share_checkpoint: u128,
    pub bump: u8,
}

impl LpPosition {
    pub const SEED: &'static [u8] = b"lp";
    pub const LEN: usize = 8 + 32 + 32 + 16 + 8 + 16 + 16 + 1 + 16;
}

// ============================================================================
// GroupMarket — multi-outcome wrapper over N binary markets.
// PDA seeds: [b"group", group_id.to_le_bytes()]
//
// EXTENSION over the Paradigm paper: the paper derives the binary pm-AMM only.
// We compose N binary markets as legs of a categorical market. Σ p_i = 1 is
// enforced at seed (each leg starts at 10_000 / N bps); maintaining Σ ≈ 1
// between trades is the responsibility of an off-chain rebalance daemon
// (out of scope for this program — see issue tracker for the on-chain
// dispatcher follow-up).
// ============================================================================

/// Maximum legs per group account. 32 covers most realistic events (sports
/// brackets, elections). Each Pubkey is 32 bytes → 1 KB for the array alone.
pub const MAX_LEGS: usize = 32;

/// Sentinel for `winning_leg` when the group is not yet resolved.
pub const NO_WINNING_LEG: u8 = u8::MAX;

#[account]
pub struct GroupMarket {
    pub authority: Pubkey,
    pub group_id: u64,

    pub start_ts: i64,
    pub end_ts: i64,

    /// Actual number of legs (≤ MAX_LEGS).
    pub leg_count: u8,

    /// Pubkeys of attached binary Market PDAs. Slots [0..leg_count) must be
    /// populated before resolution. Pubkey::default() = empty slot.
    pub legs: [Pubkey; MAX_LEGS],

    pub resolved: bool,
    /// Winning leg index (0..leg_count). NO_WINNING_LEG (0xFF) = unresolved.
    pub winning_leg: u8,
    pub bump: u8,

    /// Human-readable group name (UTF-8, zero-padded).
    pub name: [u8; 64],

    /// Cumulative bps seeded across all attached legs. Incremented by
    /// `attach_leg_to_group`, checked by `resolve_group` so Σ p_i ≈ 1 at
    /// settlement (paper invariant for categorical markets).
    pub total_seeded_bps: u32,

    /// Reserved for future expansion.
    pub _reserved: [u8; 28],
}

impl GroupMarket {
    pub const SEED: &'static [u8] = b"group";

    /// Space: 8 discriminator + fields.
    pub const LEN: usize = 8 // discriminator
        + 32 // authority
        + 8  // group_id
        + 8  // start_ts
        + 8  // end_ts
        + 1  // leg_count
        + 32 * MAX_LEGS // legs
        + 1  // resolved
        + 1  // winning_leg
        + 1  // bump
        + 64 // name
        + 4  // total_seeded_bps
        + 28; // reserved

    /// Return the group name as a UTF-8 string (trailing zeros trimmed).
    pub fn name_str(&self) -> &str {
        let len = self
            .name
            .iter()
            .position(|&b| b == 0)
            .unwrap_or(self.name.len());
        core::str::from_utf8(&self.name[..len]).unwrap_or("")
    }

    /// Return the resolved winning leg index, or None if not yet resolved.
    pub fn get_winning_leg(&self) -> Option<u8> {
        if self.resolved && self.winning_leg < self.leg_count {
            Some(self.winning_leg)
        } else {
            None
        }
    }

    /// Mark the group resolved with the given winning leg.
    /// Caller is responsible for validating the leg index.
    pub fn set_winning_leg(&mut self, leg: u8) {
        self.winning_leg = leg;
        self.resolved = true;
    }

    /// True if slot `idx` holds a non-default Pubkey.
    pub fn is_leg_attached(&self, idx: usize) -> bool {
        idx < self.leg_count as usize && self.legs[idx] != Pubkey::default()
    }

    /// True iff all `leg_count` slots are attached.
    pub fn all_legs_attached(&self) -> bool {
        (0..self.leg_count as usize).all(|i| self.legs[i] != Pubkey::default())
    }

    /// Expected initial_price_bps for each leg so that Σ p_i = 1 at seed.
    /// Rounded down: residual goes to slot 0 conceptually but each leg uses
    /// the same value here (off-chain dispatcher can compensate by ±1 bps).
    pub fn expected_leg_initial_price_bps(&self) -> u16 {
        if self.leg_count == 0 {
            return 0;
        }
        (10_000u32 / self.leg_count as u32) as u16
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_q64_roundtrip() {
        let mut market = Market {
            authority: Pubkey::default(),
            market_id: 0,
            collateral_mint: Pubkey::default(),
            yes_mint: Pubkey::default(),
            no_mint: Pubkey::default(),
            vault: Pubkey::default(),
            start_ts: 0,
            end_ts: 0,
            l_zero: 0,
            reserve_yes: 0,
            reserve_no: 0,
            last_accrual_ts: 0,
            cum_yes_per_share: 0,
            cum_no_per_share: 0,
            total_yes_distributed: 0,
            total_no_distributed: 0,
            total_lp_shares: 0,
            resolved: false,
            winning_side: 0,
            bump: 0,
            name: [0u8; 64],
            initial_price_bps: 0,
            group: Pubkey::default(),
        };

        // Test various values round-trip through u128 storage
        for val in [0.0, 1.0, 398.942, 1000.0, 0.001, 123456.789] {
            let fixed_val = I80F48::from_num(val);
            market.set_l_zero_fixed(fixed_val);
            let got = market.l_zero_fixed();
            assert_eq!(got, fixed_val, "Q64.64 roundtrip failed for {val}");
        }

        // Test reserves
        let x = I80F48::from_num(1328.895);
        let y = I80F48::from_num(47.343);
        market.set_reserve_yes_fixed(x);
        market.set_reserve_no_fixed(y);
        assert_eq!(market.reserve_yes_fixed(), x);
        assert_eq!(market.reserve_no_fixed(), y);

        // Test cum_per_share
        let c = I80F48::from_num(0.000001);
        market.set_cum_yes_per_share_fixed(c);
        assert_eq!(market.cum_yes_per_share_fixed(), c);
    }

    #[test]
    fn test_market_len_is_443() {
        // Locks the on-chain layout. Anyone changing Market fields must update
        // LEN explicitly — silent layout drift would break existing accounts
        // and the dataSize filter the frontend uses.
        assert_eq!(Market::LEN, 443);
    }

    #[test]
    fn test_initial_price_fixed() {
        let mut market = Market {
            authority: Pubkey::default(),
            market_id: 0,
            collateral_mint: Pubkey::default(),
            yes_mint: Pubkey::default(),
            no_mint: Pubkey::default(),
            vault: Pubkey::default(),
            start_ts: 0,
            end_ts: 0,
            l_zero: 0,
            reserve_yes: 0,
            reserve_no: 0,
            last_accrual_ts: 0,
            cum_yes_per_share: 0,
            cum_no_per_share: 0,
            total_yes_distributed: 0,
            total_no_distributed: 0,
            total_lp_shares: 0,
            resolved: false,
            winning_side: 0,
            bump: 0,
            name: [0u8; 64],
            initial_price_bps: 0,
            group: Pubkey::default(),
        };
        // 0 maps to 0.5 (legacy)
        let v0: f64 = market.initial_price_fixed().to_num();
        assert!((v0 - 0.5).abs() < 1e-12, "0 bps -> 0.5, got {v0}");
        // 1000 bps -> 0.10
        market.initial_price_bps = 1000;
        let v_lo: f64 = market.initial_price_fixed().to_num();
        assert!((v_lo - 0.1).abs() < 1e-12);
        // 9000 bps -> 0.90
        market.initial_price_bps = 9000;
        let v_hi: f64 = market.initial_price_fixed().to_num();
        assert!((v_hi - 0.9).abs() < 1e-12);
        // 714 bps -> 0.0714 (useful for 14-leg multi-outcome seed)
        market.initial_price_bps = 714;
        let v_14: f64 = market.initial_price_fixed().to_num();
        assert!((v_14 - 0.0714).abs() < 1e-12);
    }

    #[test]
    fn test_is_attached_to_group() {
        let mut market = Market {
            authority: Pubkey::default(),
            market_id: 0,
            collateral_mint: Pubkey::default(),
            yes_mint: Pubkey::default(),
            no_mint: Pubkey::default(),
            vault: Pubkey::default(),
            start_ts: 0,
            end_ts: 0,
            l_zero: 0,
            reserve_yes: 0,
            reserve_no: 0,
            last_accrual_ts: 0,
            cum_yes_per_share: 0,
            cum_no_per_share: 0,
            total_yes_distributed: 0,
            total_no_distributed: 0,
            total_lp_shares: 0,
            resolved: false,
            winning_side: 0,
            bump: 0,
            name: [0u8; 64],
            initial_price_bps: 0,
            group: Pubkey::default(),
        };
        assert!(!market.is_attached_to_group(), "default = standalone");
        market.group = Pubkey::new_unique();
        assert!(market.is_attached_to_group(), "non-default = attached");
    }

    #[test]
    fn test_winning_side() {
        let mut market = Market {
            authority: Pubkey::default(),
            market_id: 0,
            collateral_mint: Pubkey::default(),
            yes_mint: Pubkey::default(),
            no_mint: Pubkey::default(),
            vault: Pubkey::default(),
            start_ts: 0,
            end_ts: 0,
            l_zero: 0,
            reserve_yes: 0,
            reserve_no: 0,
            last_accrual_ts: 0,
            cum_yes_per_share: 0,
            cum_no_per_share: 0,
            total_yes_distributed: 0,
            total_no_distributed: 0,
            total_lp_shares: 0,
            resolved: false,
            winning_side: 0,
            bump: 0,
            name: [0u8; 64],
            initial_price_bps: 0,
            group: Pubkey::default(),
        };

        assert_eq!(market.get_winning_side(), None);
        market.set_winning_side(Side::Yes);
        assert_eq!(market.get_winning_side(), Some(Side::Yes));
        market.set_winning_side(Side::No);
        assert_eq!(market.get_winning_side(), Some(Side::No));
    }

    // ========================================================================
    // GroupMarket tests (EXTENSION)
    // ========================================================================

    fn make_empty_group(leg_count: u8) -> GroupMarket {
        GroupMarket {
            authority: Pubkey::default(),
            group_id: 0,
            start_ts: 0,
            end_ts: 0,
            leg_count,
            legs: [Pubkey::default(); MAX_LEGS],
            resolved: false,
            winning_leg: NO_WINNING_LEG,
            bump: 0,
            name: [0u8; 64],
            total_seeded_bps: 0,
            _reserved: [0u8; 28],
        }
    }

    #[test]
    fn test_group_market_len_under_account_limit() {
        // Solana max account size before resize is 10240 bytes for a freshly
        // init'd account. Our GroupMarket must fit comfortably.
        const SOLANA_INIT_LIMIT: usize = 10_240;
        const _: () = assert!(GroupMarket::LEN < SOLANA_INIT_LIMIT);
    }

    #[test]
    fn test_group_get_set_winning_leg() {
        let mut g = make_empty_group(5);
        assert_eq!(g.get_winning_leg(), None);
        g.set_winning_leg(2);
        assert_eq!(g.get_winning_leg(), Some(2));
        assert!(g.resolved);
        let mut g2 = make_empty_group(3);
        g2.set_winning_leg(5); // > leg_count
        assert_eq!(g2.get_winning_leg(), None);
    }

    #[test]
    fn test_group_leg_attachment() {
        let mut g = make_empty_group(3);
        assert!(!g.is_leg_attached(0));
        assert!(!g.all_legs_attached());
        g.legs[0] = Pubkey::new_unique();
        g.legs[1] = Pubkey::new_unique();
        assert!(g.is_leg_attached(0));
        assert!(g.is_leg_attached(1));
        assert!(!g.is_leg_attached(2));
        assert!(!g.all_legs_attached());
        g.legs[2] = Pubkey::new_unique();
        assert!(g.all_legs_attached());
        assert!(!g.is_leg_attached(5));
    }

    #[test]
    fn test_group_expected_leg_bps() {
        assert_eq!(make_empty_group(2).expected_leg_initial_price_bps(), 5000);
        assert_eq!(make_empty_group(4).expected_leg_initial_price_bps(), 2500);
        assert_eq!(make_empty_group(14).expected_leg_initial_price_bps(), 714);
        assert_eq!(make_empty_group(3).expected_leg_initial_price_bps(), 3333);
        assert_eq!(make_empty_group(0).expected_leg_initial_price_bps(), 0);
    }

    #[test]
    fn test_group_resolve_min_sum_formula() {
        // resolve_group computes:
        //   min_sum = 10_000 - leg_count - (10_000 % leg_count)
        // This MUST equal the worst-case underseed N*(floor(10_000/N) - 1),
        // otherwise valid sequences of attaches at `floor - 1` each would
        // pass the per-leg ±1 bps check but jail the group at resolve time.
        for n in 2u32..=MAX_LEGS as u32 {
            let floor_per_leg = 10_000_u32 / n;
            let worst_case_underseed = n * (floor_per_leg - 1);
            let residual = 10_000_u32 % n;
            let min_sum = 10_000_u32.saturating_sub(n).saturating_sub(residual);
            assert_eq!(
                min_sum, worst_case_underseed,
                "min_sum mismatch for N={n}: formula={min_sum} worst={worst_case_underseed}"
            );
            // And the upper cap (10_001) must be binding for every N — proof
            // that an attacker pushing every leg to `floor + 1` would exceed
            // 10_001 if the cap didn't exist.
            let worst_case_overseed = n * (floor_per_leg + 1);
            assert!(
                worst_case_overseed > 10_001,
                "per-attach cap is redundant for N={n}: worst_case_overseed={worst_case_overseed}"
            );
        }
    }
}
