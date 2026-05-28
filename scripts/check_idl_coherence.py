#!/usr/bin/env python3
"""
Guard against IDL drift: assert that the two bundled JSON IDLs match the
on-chain Rust struct definitions in `anchor/programs/pm_amm/src/state.rs`.

We don't reparse the Rust here (that would need a full procmacro expansion).
Instead we hard-code the expected field lists — the source of truth — and
fail loudly when either IDL file diverges. When the on-chain struct changes,
the contributor must update BOTH this script AND the IDL JSONs in the same PR.

Exits 1 on any mismatch; CI fails the workflow.
"""

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Expected field names (snake_case, in declaration order) for each account.
# Update here in lockstep with anchor/programs/pm_amm/src/state.rs.
EXPECTED = {
    "Market": [
        "authority", "market_id", "collateral_mint", "yes_mint", "no_mint",
        "vault", "start_ts", "end_ts", "l_zero", "reserve_yes", "reserve_no",
        "last_accrual_ts", "cum_yes_per_share", "cum_no_per_share",
        "total_yes_distributed", "total_no_distributed", "total_lp_shares",
        "resolved", "winning_side", "bump", "name", "initial_price_bps",
        "group",
    ],
    "GroupMarket": [
        "authority", "group_id", "start_ts", "end_ts", "leg_count", "legs",
        "resolved", "winning_leg", "bump", "name", "total_seeded_bps",
        "_reserved",
    ],
    "LpPosition": [
        "owner", "market", "shares", "collateral_deposited",
        "yes_per_share_checkpoint", "no_per_share_checkpoint", "bump",
    ],
    "CommitmentVault": [
        "authority", "vault_id", "collateral_mint", "name",
        "commit_end_ts", "market_end_ts",
        "yes_total", "no_total", "commit_count", "min_total",
        "launched", "winning_price_bps", "market", "lp_position",
        "bump", "_reserved",
    ],
    "CommitPosition": [
        "vault", "owner", "yes_amount", "no_amount", "claimed", "bump", "_reserved",
    ],
}

IDL_PATHS = [
    REPO_ROOT / "idl" / "pm_amm.json",
    REPO_ROOT / "app" / "src" / "lib" / "pm_amm_idl.json",
]


def check_idl(path: Path) -> list[str]:
    errors: list[str] = []
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        return [f"{path}: cannot read/parse: {exc}"]

    types_by_name = {t["name"]: t for t in data.get("types", [])}
    for name, expected_fields in EXPECTED.items():
        if name not in types_by_name:
            errors.append(f"{path}: type {name!r} missing")
            continue
        td = types_by_name[name]
        if td.get("type", {}).get("kind") != "struct":
            errors.append(f"{path}: {name} is not a struct")
            continue
        actual = [f["name"] for f in td["type"].get("fields", [])]
        if actual != expected_fields:
            errors.append(
                f"{path}: {name} field mismatch\n"
                f"  expected: {expected_fields}\n"
                f"  actual:   {actual}"
            )
    return errors


def main() -> int:
    all_errors: list[str] = []
    for path in IDL_PATHS:
        all_errors.extend(check_idl(path))

    if all_errors:
        sys.stderr.write("IDL coherence check FAILED:\n")
        for err in all_errors:
            sys.stderr.write(f"  {err}\n")
        sys.stderr.write(
            "\nFix: either (a) regenerate the JSON with `anchor build` and "
            "commit, or (b) update the EXPECTED tables in this script to "
            "match the new struct layout (in lockstep with `state.rs`).\n"
        )
        return 1

    print(f"IDL coherence OK ({len(IDL_PATHS)} files checked).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
