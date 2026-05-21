//! Multi-outcome group market instructions.
//!
//! A GroupMarket wraps N independent binary pm-AMM markets as legs of a
//! categorical (multi-outcome) prediction market. The on-chain code enforces:
//!
//! - same authority owns the group and all legs
//! - synchronous expiration (every leg.end_ts == group.end_ts)
//! - seed-time Σ p_i = 1 (each leg.initial_price_bps == 10_000 / leg_count)
//! - cascade resolution: winning leg → Side::Yes, others → Side::No
//!
//! EXTENSION over the Paradigm pm-AMM paper (which derives only the binary
//! case). The math of each leg is paper-exact; the composition is new and
//! deliberately conservative — see issue tracker for the on-chain dispatcher
//! follow-up that would also handle inter-tick rebalancing atomically.

pub mod attach_leg_to_group;
pub mod cancel_group_market;
pub mod initialize_group_market;
pub mod resolve_group;
pub mod resolve_group_leg;

// Anchor's `#[program]` macro looks up `__client_accounts_*` modules via the
// re-exported namespace, so the glob form is required. Each submodule also
// defines a `handler` fn — they collide in the glob but are only ever called
// fully qualified from `lib.rs`, so the ambiguity is benign.
#[allow(ambiguous_glob_reexports)]
pub use attach_leg_to_group::*;
#[allow(ambiguous_glob_reexports)]
pub use cancel_group_market::*;
#[allow(ambiguous_glob_reexports)]
pub use initialize_group_market::*;
#[allow(ambiguous_glob_reexports)]
pub use resolve_group::*;
#[allow(ambiguous_glob_reexports)]
pub use resolve_group_leg::*;
