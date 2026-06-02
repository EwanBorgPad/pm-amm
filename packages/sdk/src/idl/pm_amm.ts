/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/pm_amm.json`.
 */
export type PmAmm = {
  address: "GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y";
  metadata: {
    name: "pmAmm";
    version: "0.1.0";
    spec: "0.1.0";
    description: "Paradigm dynamic pm-AMM on Solana";
  };
  instructions: [
    {
      name: "accrue";
      docs: [
        "Permissionless dC_t accrual. Anyone can trigger to release tokens",
        "from the pool as L_eff decreases over time.",
      ];
      discriminator: [23, 76, 128, 149, 229, 247, 72, 228];
      accounts: [
        {
          name: "market";
          writable: true;
        },
      ];
      args: [];
    },
    {
      name: "attachLegToGroup";
      docs: [
        "Attach an existing binary Market PDA to a leg slot of a GroupMarket.",
        "Enforces same authority, same end_ts, and seed price = 10_000/N bps.",
      ];
      discriminator: [28, 153, 111, 127, 89, 110, 164, 253];
      accounts: [
        {
          name: "authority";
          signer: true;
        },
        {
          name: "groupMarket";
          writable: true;
        },
        {
          name: "market";
          writable: true;
        },
      ];
      args: [
        {
          name: "legIndex";
          type: "u8";
        },
      ];
    },
    {
      name: "cancelGroupMarket";
      docs: [
        "Cancel an abandoned GroupMarket past expiration. Marks it resolved with",
        "`NO_WINNING_LEG`, so attached legs can then be finalized as `Side::No`",
        "via `resolve_group_leg`. Authority-only.",
      ];
      discriminator: [165, 237, 140, 189, 29, 120, 203, 131];
      accounts: [
        {
          name: "authority";
          signer: true;
        },
        {
          name: "groupMarket";
          writable: true;
        },
      ];
      args: [];
    },
    {
      name: "claimCommitter";
      docs: [
        "Committer claims back their USDC after launch. (v1: returns the commit",
        "1:1; v2 will distribute LP shares of the launched market pro-rata.)",
      ];
      discriminator: [69, 50, 5, 130, 100, 35, 107, 68];
      accounts: [
        {
          name: "signer";
          writable: true;
          signer: true;
        },
        {
          name: "vault";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [118, 97, 117, 108, 116];
              },
              {
                kind: "account";
                path: "vault.vault_id";
                account: "commitmentVault";
              },
            ];
          };
        },
        {
          name: "vaultCollateral";
          docs: ["PDA-owned vault collateral ATA — source of the USDC backing transfer."];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [118, 97, 117, 108, 116, 95, 99, 111, 108, 108, 97, 116, 101, 114, 97, 108];
              },
              {
                kind: "account";
                path: "vault";
              },
            ];
          };
        },
        {
          name: "collateralMint";
        },
        {
          name: "market";
          docs: ["The launched binary market — must match `vault.market`."];
          writable: true;
        },
        {
          name: "marketVault";
          docs: ["Market's USDC vault — destination of the backing transfer."];
          writable: true;
        },
        {
          name: "yesMint";
          writable: true;
        },
        {
          name: "noMint";
          writable: true;
        },
        {
          name: "userYes";
          docs: ["User's YES ATA — init if missing."];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "account";
                path: "signer";
              },
              {
                kind: "const";
                value: [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169,
                ];
              },
              {
                kind: "account";
                path: "yesMint";
              },
            ];
            program: {
              kind: "const";
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: "userNo";
          docs: ["User's NO ATA — init if missing."];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "account";
                path: "signer";
              },
              {
                kind: "const";
                value: [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169,
                ];
              },
              {
                kind: "account";
                path: "noMint";
              },
            ];
            program: {
              kind: "const";
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: "commitPosition";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [99, 111, 109, 109, 105, 116];
              },
              {
                kind: "account";
                path: "vault";
              },
              {
                kind: "account";
                path: "signer";
              },
            ];
          };
        },
        {
          name: "associatedTokenProgram";
          address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [];
    },
    {
      name: "claimCommitterGroup";
      docs: [
        "Per-leg claim for multi-outcome vault committers (v2): mints leg",
        "YES tokens 1:1 with their commit on that leg, and transfers the",
        "backing USDC from the commitment vault to the leg's market vault.",
        "Call once per leg the committer has stake in.",
      ];
      discriminator: [167, 235, 88, 38, 127, 145, 253, 198];
      accounts: [
        {
          name: "signer";
          writable: true;
          signer: true;
        },
        {
          name: "vault";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [118, 97, 117, 108, 116, 95, 103, 114, 111, 117, 112];
              },
              {
                kind: "account";
                path: "vault.vault_id";
                account: "commitmentVaultGroup";
              },
            ];
          };
        },
        {
          name: "vaultCollateral";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  103,
                  114,
                  111,
                  117,
                  112,
                  95,
                  99,
                  111,
                  108,
                  108,
                  97,
                  116,
                  101,
                  114,
                  97,
                  108,
                ];
              },
              {
                kind: "account";
                path: "vault";
              },
            ];
          };
        },
        {
          name: "collateralMint";
        },
        {
          name: "groupMarket";
          docs: ["The wrapping GroupMarket — verified against vault.group_market."];
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 114, 111, 117, 112];
              },
              {
                kind: "account";
                path: "group_market.group_id";
                account: "groupMarket";
              },
            ];
          };
        },
        {
          name: "market";
          docs: ["Leg `leg_index`'s binary market — verified against group.legs[i]."];
          writable: true;
        },
        {
          name: "marketVault";
          docs: ["Leg market's USDC vault — destination of the backing transfer."];
          writable: true;
        },
        {
          name: "yesMint";
          writable: true;
        },
        {
          name: "userYes";
          docs: ["User's YES ATA for this leg — init if missing."];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "account";
                path: "signer";
              },
              {
                kind: "const";
                value: [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169,
                ];
              },
              {
                kind: "account";
                path: "yesMint";
              },
            ];
            program: {
              kind: "const";
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: "commitPosition";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [99, 111, 109, 109, 105, 116, 95, 103, 114, 111, 117, 112];
              },
              {
                kind: "account";
                path: "vault";
              },
              {
                kind: "account";
                path: "signer";
              },
            ];
          };
        },
        {
          name: "associatedTokenProgram";
          address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "legIndex";
          type: "u8";
        },
      ];
    },
    {
      name: "claimLpResiduals";
      docs: [
        "Claim pending YES+NO residuals accrued to an LP position.",
        "Allowed at any time, including after resolution.",
      ];
      discriminator: [245, 137, 197, 230, 204, 93, 183, 28];
      accounts: [
        {
          name: "signer";
          signer: true;
        },
        {
          name: "market";
          writable: true;
        },
        {
          name: "yesMint";
          writable: true;
          relations: ["market"];
        },
        {
          name: "noMint";
          writable: true;
          relations: ["market"];
        },
        {
          name: "lpPosition";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [108, 112];
              },
              {
                kind: "account";
                path: "market";
              },
              {
                kind: "account";
                path: "signer";
              },
            ];
          };
        },
        {
          name: "userYes";
          writable: true;
        },
        {
          name: "userNo";
          writable: true;
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
      ];
      args: [];
    },
    {
      name: "claimWinnings";
      docs: [
        "Burn all user tokens (winning + losing), pay winning side at 1 USDC each.",
        "Only callable post-resolution. Burns both sides atomically.",
      ];
      discriminator: [161, 215, 24, 59, 14, 236, 242, 221];
      accounts: [
        {
          name: "signer";
          writable: true;
          signer: true;
        },
        {
          name: "market";
        },
        {
          name: "collateralMint";
          relations: ["market"];
        },
        {
          name: "yesMint";
          writable: true;
          relations: ["market"];
        },
        {
          name: "noMint";
          writable: true;
          relations: ["market"];
        },
        {
          name: "vault";
          writable: true;
          relations: ["market"];
        },
        {
          name: "userYes";
          docs: ["User's YES token account."];
          writable: true;
        },
        {
          name: "userNo";
          docs: ["User's NO token account."];
          writable: true;
        },
        {
          name: "userCollateral";
          docs: ["User's USDC token account."];
          writable: true;
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
      ];
      args: [
        {
          name: "amount";
          type: "u64";
        },
      ];
    },
    {
      name: "depositLiquidity";
      docs: [
        "Deposit USDC as liquidity. First deposit bootstraps L_0 at 50/50 price.",
        "Subsequent deposits scale L_0 proportionally to preserve the current price.",
      ];
      discriminator: [245, 99, 59, 25, 151, 71, 233, 249];
      accounts: [
        {
          name: "signer";
          writable: true;
          signer: true;
        },
        {
          name: "market";
          writable: true;
        },
        {
          name: "collateralMint";
          relations: ["market"];
        },
        {
          name: "vault";
          writable: true;
          relations: ["market"];
        },
        {
          name: "userCollateral";
          writable: true;
        },
        {
          name: "lpPosition";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [108, 112];
              },
              {
                kind: "account";
                path: "market";
              },
              {
                kind: "account";
                path: "signer";
              },
            ];
          };
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
      ];
      args: [
        {
          name: "amount";
          type: "u64";
        },
      ];
    },
    {
      name: "initializeGroupMarket";
      docs: [
        "Create a GroupMarket wrapping `leg_count` binary markets as a",
        "categorical (multi-outcome) prediction market. Legs are attached",
        "separately via `attach_leg_to_group` and must each be seeded at",
        "`10_000 / leg_count` bps so Σ p_i = 1 at open.",
      ];
      discriminator: [117, 158, 140, 184, 36, 187, 244, 215];
      accounts: [
        {
          name: "authority";
          writable: true;
          signer: true;
        },
        {
          name: "groupMarket";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 114, 111, 117, 112];
              },
              {
                kind: "arg";
                path: "groupId";
              },
            ];
          };
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "groupId";
          type: "u64";
        },
        {
          name: "endTs";
          type: "i64";
        },
        {
          name: "name";
          type: "string";
        },
        {
          name: "legCount";
          type: "u8";
        },
      ];
    },
    {
      name: "initializeMarket";
      docs: [
        "Create a new prediction market with YES/NO mints, a USDC vault,",
        "and Metaplex token metadata for wallet display.",
        "",
        "`initial_price_bps` seeds the YES price at first deposit. Pass `0` for",
        "the legacy 50/50 default. For multi-outcome groups, pass `10_000 / N`.",
      ];
      discriminator: [35, 35, 189, 193, 155, 48, 170, 203];
      accounts: [
        {
          name: "authority";
          writable: true;
          signer: true;
        },
        {
          name: "market";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [109, 97, 114, 107, 101, 116];
              },
              {
                kind: "arg";
                path: "marketId";
              },
            ];
          };
        },
        {
          name: "collateralMint";
          docs: ["The collateral mint (USDC or mock). Must have 6 decimals."];
        },
        {
          name: "yesMint";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [121, 101, 115, 95, 109, 105, 110, 116];
              },
              {
                kind: "account";
                path: "market";
              },
            ];
          };
        },
        {
          name: "noMint";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [110, 111, 95, 109, 105, 110, 116];
              },
              {
                kind: "account";
                path: "market";
              },
            ];
          };
        },
        {
          name: "vault";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [118, 97, 117, 108, 116];
              },
              {
                kind: "account";
                path: "market";
              },
            ];
          };
        },
        {
          name: "yesMetadata";
          writable: true;
        },
        {
          name: "noMetadata";
          writable: true;
        },
        {
          name: "tokenMetadataProgram";
          address: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "rent";
          address: "SysvarRent111111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "marketId";
          type: "u64";
        },
        {
          name: "endTs";
          type: "i64";
        },
        {
          name: "name";
          type: "string";
        },
        {
          name: "initialPriceBps";
          type: "u16";
        },
      ];
    },
    {
      name: "initializeVault";
      docs: [
        "Open a new Commitment Vault. Anyone can call. Aggregates crowd commits",
        "before the market exists; the launch price is computed from the",
        "commit ratio.",
      ];
      discriminator: [48, 191, 163, 44, 71, 129, 63, 164];
      accounts: [
        {
          name: "authority";
          writable: true;
          signer: true;
        },
        {
          name: "vault";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [118, 97, 117, 108, 116];
              },
              {
                kind: "arg";
                path: "vaultId";
              },
            ];
          };
        },
        {
          name: "collateralMint";
          docs: ["USDC (or mock) mint. Must be 6 decimals."];
        },
        {
          name: "vaultCollateral";
          docs: ["PDA-owned token account that aggregates all commits."];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [118, 97, 117, 108, 116, 95, 99, 111, 108, 108, 97, 116, 101, 114, 97, 108];
              },
              {
                kind: "account";
                path: "vault";
              },
            ];
          };
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "rent";
          address: "SysvarRent111111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "vaultId";
          type: "u64";
        },
        {
          name: "name";
          type: "string";
        },
        {
          name: "commitDurationSecs";
          type: "i64";
        },
        {
          name: "marketDurationSecs";
          type: "i64";
        },
        {
          name: "minTotal";
          type: "u64";
        },
      ];
    },
    {
      name: "initializeVaultGroup";
      docs: [
        "Open a multi-outcome Commitment Vault. Authority picks the leg names",
        "(2..=8). Crowd then commits per-leg with `vault_commit_group`.",
      ];
      discriminator: [193, 241, 71, 211, 134, 166, 9, 65];
      accounts: [
        {
          name: "authority";
          writable: true;
          signer: true;
        },
        {
          name: "vault";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [118, 97, 117, 108, 116, 95, 103, 114, 111, 117, 112];
              },
              {
                kind: "arg";
                path: "vaultId";
              },
            ];
          };
        },
        {
          name: "collateralMint";
        },
        {
          name: "vaultCollateral";
          docs: ["PDA-owned token account that aggregates all commits."];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  103,
                  114,
                  111,
                  117,
                  112,
                  95,
                  99,
                  111,
                  108,
                  108,
                  97,
                  116,
                  101,
                  114,
                  97,
                  108,
                ];
              },
              {
                kind: "account";
                path: "vault";
              },
            ];
          };
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "rent";
          address: "SysvarRent111111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "vaultId";
          type: "u64";
        },
        {
          name: "name";
          type: "string";
        },
        {
          name: "legNames";
          type: {
            vec: "string";
          };
        },
        {
          name: "commitDurationSecs";
          type: "i64";
        },
        {
          name: "marketDurationSecs";
          type: "i64";
        },
        {
          name: "minTotal";
          type: "u64";
        },
      ];
    },
    {
      name: "launchVaultGroupLeg";
      docs: [
        "Step 2 of launch (run once per leg): create the leg's binary Market +",
        "mints + vault + Metaplex metadata, then attach it to the GroupMarket.",
        "Each leg market is seeded at `leg_totals[i] / total` bps.",
      ];
      discriminator: [22, 177, 160, 234, 146, 14, 138, 22];
      accounts: [
        {
          name: "payer";
          writable: true;
          signer: true;
        },
        {
          name: "vault";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [118, 97, 117, 108, 116, 95, 103, 114, 111, 117, 112];
              },
              {
                kind: "account";
                path: "vault.vault_id";
                account: "commitmentVaultGroup";
              },
            ];
          };
        },
        {
          name: "groupMarket";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 114, 111, 117, 112];
              },
              {
                kind: "account";
                path: "group_market.group_id";
                account: "groupMarket";
              },
            ];
          };
        },
        {
          name: "market";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [109, 97, 114, 107, 101, 116];
              },
              {
                kind: "arg";
                path: "marketId";
              },
            ];
          };
        },
        {
          name: "collateralMint";
        },
        {
          name: "yesMint";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [121, 101, 115, 95, 109, 105, 110, 116];
              },
              {
                kind: "account";
                path: "market";
              },
            ];
          };
        },
        {
          name: "noMint";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [110, 111, 95, 109, 105, 110, 116];
              },
              {
                kind: "account";
                path: "market";
              },
            ];
          };
        },
        {
          name: "marketVault";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [118, 97, 117, 108, 116];
              },
              {
                kind: "account";
                path: "market";
              },
            ];
          };
        },
        {
          name: "yesMetadata";
          writable: true;
        },
        {
          name: "noMetadata";
          writable: true;
        },
        {
          name: "tokenMetadataProgram";
          address: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "rent";
          address: "SysvarRent111111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "legIndex";
          type: "u8";
        },
        {
          name: "marketId";
          type: "u64";
        },
      ];
    },
    {
      name: "launchVaultGroupMarket";
      docs: [
        "Step 1 of launch: create the wrapping GroupMarket. Permissionless.",
        "Refuses if any leg has < 100 bps share (the underlying pm-AMM floor).",
      ];
      discriminator: [48, 135, 81, 146, 113, 91, 118, 148];
      accounts: [
        {
          name: "payer";
          docs: ["Permissionless caller — pays rent."];
          writable: true;
          signer: true;
        },
        {
          name: "vault";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [118, 97, 117, 108, 116, 95, 103, 114, 111, 117, 112];
              },
              {
                kind: "account";
                path: "vault.vault_id";
                account: "commitmentVaultGroup";
              },
            ];
          };
        },
        {
          name: "groupMarket";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [103, 114, 111, 117, 112];
              },
              {
                kind: "arg";
                path: "groupId";
              },
            ];
          };
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "groupId";
          type: "u64";
        },
      ];
    },
    {
      name: "launchVaultMarket";
      docs: [
        "Launch the underlying pm-AMM market once commit_end_ts has passed and",
        "total ≥ min_total. Permissionless. The caller pays the rent of the",
        "new Market + mints + vault + Metaplex metadata accounts.",
      ];
      discriminator: [1, 156, 237, 172, 168, 32, 92, 222];
      accounts: [
        {
          name: "payer";
          docs: ["Permissionless caller — pays the rent for the new Market/mints/vault."];
          writable: true;
          signer: true;
        },
        {
          name: "vault";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [118, 97, 117, 108, 116];
              },
              {
                kind: "account";
                path: "vault.vault_id";
                account: "commitmentVault";
              },
            ];
          };
        },
        {
          name: "market";
          docs: ["New Market PDA — derived from `market_id` (typically vault_id reused)."];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [109, 97, 114, 107, 101, 116];
              },
              {
                kind: "arg";
                path: "marketId";
              },
            ];
          };
        },
        {
          name: "collateralMint";
        },
        {
          name: "yesMint";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [121, 101, 115, 95, 109, 105, 110, 116];
              },
              {
                kind: "account";
                path: "market";
              },
            ];
          };
        },
        {
          name: "noMint";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [110, 111, 95, 109, 105, 110, 116];
              },
              {
                kind: "account";
                path: "market";
              },
            ];
          };
        },
        {
          name: "marketVault";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [118, 97, 117, 108, 116];
              },
              {
                kind: "account";
                path: "market";
              },
            ];
          };
        },
        {
          name: "yesMetadata";
          writable: true;
        },
        {
          name: "noMetadata";
          writable: true;
        },
        {
          name: "tokenMetadataProgram";
          address: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "rent";
          address: "SysvarRent111111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "marketId";
          type: "u64";
        },
      ];
    },
    {
      name: "redeemPair";
      docs: ["Burn 1 YES + 1 NO to receive 1 USDC. Always valid, pre- or post-resolution."];
      discriminator: [157, 102, 125, 192, 31, 48, 165, 114];
      accounts: [
        {
          name: "signer";
          writable: true;
          signer: true;
        },
        {
          name: "market";
        },
        {
          name: "collateralMint";
          relations: ["market"];
        },
        {
          name: "yesMint";
          writable: true;
          relations: ["market"];
        },
        {
          name: "noMint";
          writable: true;
          relations: ["market"];
        },
        {
          name: "vault";
          writable: true;
          relations: ["market"];
        },
        {
          name: "userYes";
          writable: true;
        },
        {
          name: "userNo";
          writable: true;
        },
        {
          name: "userCollateral";
          writable: true;
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
      ];
      args: [
        {
          name: "amount";
          type: "u64";
        },
      ];
    },
    {
      name: "refundCommit";
      docs: ["Refund a committer 1:1 if the vault never launched."];
      discriminator: [99, 40, 188, 37, 189, 16, 39, 175];
      accounts: [
        {
          name: "signer";
          signer: true;
        },
        {
          name: "vault";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [118, 97, 117, 108, 116];
              },
              {
                kind: "account";
                path: "vault.vault_id";
                account: "commitmentVault";
              },
            ];
          };
        },
        {
          name: "vaultCollateral";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [118, 97, 117, 108, 116, 95, 99, 111, 108, 108, 97, 116, 101, 114, 97, 108];
              },
              {
                kind: "account";
                path: "vault";
              },
            ];
          };
        },
        {
          name: "collateralMint";
        },
        {
          name: "userCollateral";
          writable: true;
        },
        {
          name: "commitPosition";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [99, 111, 109, 109, 105, 116];
              },
              {
                kind: "account";
                path: "vault";
              },
              {
                kind: "account";
                path: "signer";
              },
            ];
          };
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
      ];
      args: [];
    },
    {
      name: "refundCommitGroup";
      docs: ["Refund a committer 1:1 if the multi-outcome vault never launched."];
      discriminator: [176, 240, 56, 11, 1, 70, 125, 225];
      accounts: [
        {
          name: "signer";
          signer: true;
        },
        {
          name: "vault";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [118, 97, 117, 108, 116, 95, 103, 114, 111, 117, 112];
              },
              {
                kind: "account";
                path: "vault.vault_id";
                account: "commitmentVaultGroup";
              },
            ];
          };
        },
        {
          name: "vaultCollateral";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  103,
                  114,
                  111,
                  117,
                  112,
                  95,
                  99,
                  111,
                  108,
                  108,
                  97,
                  116,
                  101,
                  114,
                  97,
                  108,
                ];
              },
              {
                kind: "account";
                path: "vault";
              },
            ];
          };
        },
        {
          name: "collateralMint";
        },
        {
          name: "userCollateral";
          writable: true;
        },
        {
          name: "commitPosition";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [99, 111, 109, 109, 105, 116, 95, 103, 114, 111, 117, 112];
              },
              {
                kind: "account";
                path: "vault";
              },
              {
                kind: "account";
                path: "signer";
              },
            ];
          };
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
      ];
      args: [];
    },
    {
      name: "resolveGroup";
      docs: [
        "Resolve a GroupMarket: authority picks the winning leg.",
        "Must run after expiration and after all legs are attached.",
      ];
      discriminator: [61, 207, 24, 75, 145, 186, 16, 118];
      accounts: [
        {
          name: "authority";
          signer: true;
        },
        {
          name: "groupMarket";
          writable: true;
        },
      ];
      args: [
        {
          name: "winningLeg";
          type: "u8";
        },
      ];
    },
    {
      name: "resolveGroupLeg";
      docs: [
        "Cascade-resolve one leg of a resolved GroupMarket. Permissionless:",
        "the group's `winning_leg` is the source of truth (winning → Yes,",
        "all others → No).",
      ];
      discriminator: [177, 186, 101, 235, 171, 48, 122, 23];
      accounts: [
        {
          name: "groupMarket";
        },
        {
          name: "market";
          writable: true;
        },
      ];
      args: [
        {
          name: "legIndex";
          type: "u8";
        },
      ];
    },
    {
      name: "resolveMarket";
      docs: [
        "Resolve the market after expiration. Authority-only.",
        "Triggers final accrual and sets the winning side.",
      ];
      discriminator: [155, 23, 80, 173, 46, 74, 23, 239];
      accounts: [
        {
          name: "signer";
          signer: true;
        },
        {
          name: "market";
          writable: true;
        },
      ];
      args: [
        {
          name: "winningSide";
          type: {
            defined: {
              name: "side";
            };
          };
        },
      ];
    },
    {
      name: "suggestLZero";
      docs: [
        "View-only: compute the optimal L_0 for a given USDC budget.",
        "Emits a `LZeroSuggestion` event. Composable via CPI for auto-LP vaults.",
      ];
      discriminator: [145, 111, 214, 80, 83, 92, 179, 105];
      accounts: [
        {
          name: "market";
        },
      ];
      args: [
        {
          name: "budgetUsdc";
          type: "u64";
        },
        {
          name: "sigmaBps";
          type: "u64";
        },
      ];
    },
    {
      name: "swap";
      docs: [
        "Swap between USDC, YES, and NO tokens (6 directions).",
        "Updates reserves and enforces the pm-AMM invariant.",
      ];
      discriminator: [248, 198, 158, 145, 225, 117, 135, 200];
      accounts: [
        {
          name: "signer";
          writable: true;
          signer: true;
        },
        {
          name: "market";
          writable: true;
        },
        {
          name: "collateralMint";
          relations: ["market"];
        },
        {
          name: "yesMint";
          writable: true;
          relations: ["market"];
        },
        {
          name: "noMint";
          writable: true;
          relations: ["market"];
        },
        {
          name: "vault";
          writable: true;
          relations: ["market"];
        },
        {
          name: "userCollateral";
          writable: true;
        },
        {
          name: "userYes";
          writable: true;
        },
        {
          name: "userNo";
          writable: true;
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
      ];
      args: [
        {
          name: "direction";
          type: {
            defined: {
              name: "swapDirection";
            };
          };
        },
        {
          name: "amountIn";
          type: "u64";
        },
        {
          name: "minOutput";
          type: "u64";
        },
      ];
    },
    {
      name: "vaultCommit";
      docs: [
        "Commit USDC on YES or NO. Anyone, any number of times, until",
        "commit_end_ts. Min commit: 1 USDC.",
      ];
      discriminator: [93, 97, 93, 186, 110, 145, 241, 119];
      accounts: [
        {
          name: "signer";
          writable: true;
          signer: true;
        },
        {
          name: "vault";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [118, 97, 117, 108, 116];
              },
              {
                kind: "account";
                path: "vault.vault_id";
                account: "commitmentVault";
              },
            ];
          };
        },
        {
          name: "collateralMint";
        },
        {
          name: "vaultCollateral";
          docs: ["Vault's PDA-owned collateral ATA — receives the transferred USDC."];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [118, 97, 117, 108, 116, 95, 99, 111, 108, 108, 97, 116, 101, 114, 97, 108];
              },
              {
                kind: "account";
                path: "vault";
              },
            ];
          };
        },
        {
          name: "userCollateral";
          docs: ["User's USDC source."];
          writable: true;
        },
        {
          name: "commitPosition";
          docs: [
            "CommitPosition tracks this signer's commits on this vault.",
            "init_if_needed: first commit creates it, subsequent commits update.",
          ];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [99, 111, 109, 109, 105, 116];
              },
              {
                kind: "account";
                path: "vault";
              },
              {
                kind: "account";
                path: "signer";
              },
            ];
          };
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
      ];
      args: [
        {
          name: "side";
          type: {
            defined: {
              name: "side";
            };
          };
        },
        {
          name: "amount";
          type: "u64";
        },
      ];
    },
    {
      name: "vaultCommitGroup";
      docs: [
        "Commit USDC on a specific leg of a multi-outcome vault. Same rules as",
        "`vault_commit`: anyone, any number of times, until commit_end_ts.",
      ];
      discriminator: [148, 85, 199, 203, 20, 165, 174, 124];
      accounts: [
        {
          name: "signer";
          writable: true;
          signer: true;
        },
        {
          name: "vault";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [118, 97, 117, 108, 116, 95, 103, 114, 111, 117, 112];
              },
              {
                kind: "account";
                path: "vault.vault_id";
                account: "commitmentVaultGroup";
              },
            ];
          };
        },
        {
          name: "collateralMint";
        },
        {
          name: "vaultCollateral";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  103,
                  114,
                  111,
                  117,
                  112,
                  95,
                  99,
                  111,
                  108,
                  108,
                  97,
                  116,
                  101,
                  114,
                  97,
                  108,
                ];
              },
              {
                kind: "account";
                path: "vault";
              },
            ];
          };
        },
        {
          name: "userCollateral";
          writable: true;
        },
        {
          name: "commitPosition";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [99, 111, 109, 109, 105, 116, 95, 103, 114, 111, 117, 112];
              },
              {
                kind: "account";
                path: "vault";
              },
              {
                kind: "account";
                path: "signer";
              },
            ];
          };
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
      ];
      args: [
        {
          name: "legIndex";
          type: "u8";
        },
        {
          name: "amount";
          type: "u64";
        },
      ];
    },
    {
      name: "withdrawLiquidity";
      docs: [
        "Withdraw LP shares: auto-claims pending residuals, then mints",
        "proportional YES+NO tokens from the pool reserves.",
      ];
      discriminator: [149, 158, 33, 185, 47, 243, 253, 31];
      accounts: [
        {
          name: "signer";
          writable: true;
          signer: true;
        },
        {
          name: "market";
          writable: true;
        },
        {
          name: "collateralMint";
          relations: ["market"];
        },
        {
          name: "yesMint";
          writable: true;
          relations: ["market"];
        },
        {
          name: "noMint";
          writable: true;
          relations: ["market"];
        },
        {
          name: "lpPosition";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [108, 112];
              },
              {
                kind: "account";
                path: "market";
              },
              {
                kind: "account";
                path: "signer";
              },
            ];
          };
        },
        {
          name: "userYes";
          writable: true;
        },
        {
          name: "userNo";
          writable: true;
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
      ];
      args: [
        {
          name: "sharesToBurn";
          type: "u128";
        },
      ];
    },
  ];
  accounts: [
    {
      name: "commitPosition";
      discriminator: [144, 59, 6, 201, 179, 120, 138, 51];
    },
    {
      name: "commitPositionGroup";
      discriminator: [72, 88, 193, 73, 54, 37, 222, 238];
    },
    {
      name: "commitmentVault";
      discriminator: [14, 195, 87, 111, 213, 201, 5, 129];
    },
    {
      name: "commitmentVaultGroup";
      discriminator: [54, 104, 214, 215, 55, 178, 183, 152];
    },
    {
      name: "groupMarket";
      discriminator: [64, 120, 105, 242, 92, 182, 3, 113];
    },
    {
      name: "lpPosition";
      discriminator: [105, 241, 37, 200, 224, 2, 252, 90];
    },
    {
      name: "market";
      discriminator: [219, 190, 213, 55, 0, 227, 198, 154];
    },
  ];
  events: [
    {
      name: "lZeroSuggestion";
      discriminator: [177, 83, 48, 170, 82, 64, 221, 54];
    },
  ];
  errors: [
    {
      code: 6000;
      name: "marketAlreadyResolved";
      msg: "Market already resolved";
    },
    {
      code: 6001;
      name: "marketNotResolved";
      msg: "Market not yet resolved";
    },
    {
      code: 6002;
      name: "marketExpired";
      msg: "Market has expired";
    },
    {
      code: 6003;
      name: "marketNotExpired";
      msg: "Market has not expired yet";
    },
    {
      code: 6004;
      name: "insufficientLiquidity";
      msg: "Insufficient liquidity or balance";
    },
    {
      code: 6005;
      name: "insufficientOutput";
      msg: "Swap output below minimum";
    },
    {
      code: 6006;
      name: "insufficientBalance";
      msg: "Insufficient user token balance";
    },
    {
      code: 6007;
      name: "slippageExceeded";
      msg: "Slippage tolerance exceeded";
    },
    {
      code: 6008;
      name: "unauthorized";
      msg: "unauthorized";
    },
    {
      code: 6009;
      name: "invalidPrice";
      msg: "Invalid price: must be in (0, 1)";
    },
    {
      code: 6010;
      name: "mathOverflow";
      msg: "Math overflow";
    },
    {
      code: 6011;
      name: "noResidualsToClaim";
      msg: "No residuals to claim";
    },
    {
      code: 6012;
      name: "invalidDuration";
      msg: "Invalid duration";
    },
    {
      code: 6013;
      name: "invalidBudget";
      msg: "Invalid budget or amount";
    },
    {
      code: 6014;
      name: "invalidWinningMint";
      msg: "Invalid winning mint: does not match resolved side";
    },
    {
      code: 6015;
      name: "insufficientVault";
      msg: "Insufficient vault balance";
    },
    {
      code: 6016;
      name: "invalidName";
      msg: "Invalid name: must be 1-64 bytes";
    },
    {
      code: 6017;
      name: "invalidLegCount";
      msg: "Invalid leg count: must be between 2 and MAX_LEGS";
    },
    {
      code: 6018;
      name: "invalidLegIndex";
      msg: "Invalid leg index: out of bounds for this group";
    },
    {
      code: 6019;
      name: "legAlreadyAttached";
      msg: "Leg slot already attached";
    },
    {
      code: 6020;
      name: "legMismatch";
      msg: "Leg market does not match the slot stored on the group";
    },
    {
      code: 6021;
      name: "groupAlreadyResolved";
      msg: "Group market already resolved";
    },
    {
      code: 6022;
      name: "groupNotResolved";
      msg: "Group market not yet resolved";
    },
    {
      code: 6023;
      name: "groupNotExpired";
      msg: "Group market not yet expired";
    },
    {
      code: 6024;
      name: "groupIncomplete";
      msg: "Group market has missing legs (must attach all N legs first)";
    },
    {
      code: 6025;
      name: "legEndTsMismatch";
      msg: "Leg market end_ts does not match group end_ts";
    },
    {
      code: 6026;
      name: "legMustCascadeResolve";
      msg: "Leg attached to a group must resolve via resolve_group_leg";
    },
    {
      code: 6027;
      name: "groupCancelTooEarly";
      msg: "Group can only be cancelled after expiration";
    },
    {
      code: 6028;
      name: "vaultAlreadyLaunched";
      msg: "Vault is already launched";
    },
    {
      code: 6029;
      name: "vaultNotLaunched";
      msg: "Vault is not yet launched";
    },
    {
      code: 6030;
      name: "commitPhaseClosed";
      msg: "Vault commit phase has not started or already ended";
    },
    {
      code: 6031;
      name: "commitPhaseNotEnded";
      msg: "Vault commit phase has not yet ended";
    },
    {
      code: 6032;
      name: "commitTooSmall";
      msg: "Commit amount below MIN_COMMIT_USDC";
    },
    {
      code: 6033;
      name: "vaultBelowMinTotal";
      msg: "Vault total below min_total threshold";
    },
    {
      code: 6034;
      name: "invalidCommitDuration";
      msg: "Invalid commit duration: must be 1 min ≤ d ≤ 7 days";
    },
    {
      code: 6035;
      name: "invalidMarketDuration";
      msg: "Invalid market duration: must be 5 min ≤ d ≤ 30 days";
    },
    {
      code: 6036;
      name: "alreadyClaimed";
      msg: "Commit position already claimed";
    },
    {
      code: 6037;
      name: "refundNotAvailable";
      msg: "Refund only available if vault is unlaunched and either commit ended below threshold OR commit ended without launch";
    },
    {
      code: 6038;
      name: "noCommitFunds";
      msg: "Commit position has no funds to claim or refund";
    },
    {
      code: 6039;
      name: "vaultGroupLegOutOfBounds";
      msg: "Vault group leg index out of bounds (>= leg_count)";
    },
    {
      code: 6040;
      name: "vaultGroupLegAlreadyLaunched";
      msg: "Vault group leg already launched";
    },
    {
      code: 6041;
      name: "vaultGroupNotAllLegsLaunched";
      msg: "Vault group: not all legs launched yet";
    },
    {
      code: 6042;
      name: "vaultGroupInsufficientLegShare";
      msg: "Vault group leg has insufficient share (< 100 bps after rounding)";
    },
    {
      code: 6043;
      name: "vaultGroupNotInitialized";
      msg: "Vault group: group market not yet created";
    },
    {
      code: 6044;
      name: "invalidLegName";
      msg: "Invalid leg name: must be 1-32 bytes";
    },
    {
      code: 6045;
      name: "invalidMarket";
      msg: "Market account does not match the one stored on the vault";
    },
    {
      code: 6046;
      name: "invalidVault";
      msg: "Market vault token account does not match market.vault";
    },
  ];
  types: [
    {
      name: "commitPosition";
      type: {
        kind: "struct";
        fields: [
          {
            name: "vault";
            type: "pubkey";
          },
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "yesAmount";
            type: "u64";
          },
          {
            name: "noAmount";
            type: "u64";
          },
          {
            name: "claimed";
            type: "bool";
          },
          {
            name: "bump";
            type: "u8";
          },
          {
            name: "reserved";
            type: {
              array: ["u8", 16];
            };
          },
        ];
      };
    },
    {
      name: "commitPositionGroup";
      type: {
        kind: "struct";
        fields: [
          {
            name: "vault";
            type: "pubkey";
          },
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "legAmounts";
            type: {
              array: ["u64", 8];
            };
          },
          {
            name: "claimed";
            type: "bool";
          },
          {
            name: "bump";
            type: "u8";
          },
          {
            name: "reserved";
            type: {
              array: ["u8", 16];
            };
          },
        ];
      };
    },
    {
      name: "commitmentVault";
      type: {
        kind: "struct";
        fields: [
          {
            name: "authority";
            type: "pubkey";
          },
          {
            name: "vaultId";
            type: "u64";
          },
          {
            name: "collateralMint";
            type: "pubkey";
          },
          {
            name: "name";
            docs: ["UTF-8 zero-padded vault name (becomes the launched market's name)."];
            type: {
              array: ["u8", 64];
            };
          },
          {
            name: "commitEndTs";
            docs: [
              "When the commit phase ends. After this, no more commits, launch",
              "becomes available, refund becomes available.",
            ];
            type: "i64";
          },
          {
            name: "marketEndTs";
            docs: ["Duration of the launched market (added to launch time to get end_ts)."];
            type: "i64";
          },
          {
            name: "yesTotal";
            type: "u64";
          },
          {
            name: "noTotal";
            type: "u64";
          },
          {
            name: "commitCount";
            type: "u32";
          },
          {
            name: "minTotal";
            docs: ["Below this threshold, launch is refused → committers must refund."];
            type: "u64";
          },
          {
            name: "launched";
            type: "bool";
          },
          {
            name: "winningPriceBps";
            docs: [
              "Set at launch to the initial_price_bps computed from the commit ratio.",
              "Kept for transparency post-launch.",
            ];
            type: "u16";
          },
          {
            name: "market";
            docs: ["The launched Market PDA. `Pubkey::default()` pre-launch."];
            type: "pubkey";
          },
          {
            name: "lpPosition";
            docs: [
              'The LpPosition PDA owned by the vault (seeds [b"lp", market, vault]).',
              "Holds the LP shares minted at launch; claim_committer distributes them",
              "pro-rata. `Pubkey::default()` pre-launch.",
            ];
            type: "pubkey";
          },
          {
            name: "bump";
            type: "u8";
          },
          {
            name: "reserved";
            type: {
              array: ["u8", 32];
            };
          },
        ];
      };
    },
    {
      name: "commitmentVaultGroup";
      type: {
        kind: "struct";
        fields: [
          {
            name: "authority";
            type: "pubkey";
          },
          {
            name: "vaultId";
            type: "u64";
          },
          {
            name: "collateralMint";
            type: "pubkey";
          },
          {
            name: "name";
            docs: ["UTF-8 zero-padded vault name (becomes the launched GroupMarket name)."];
            type: {
              array: ["u8", 64];
            };
          },
          {
            name: "legCount";
            docs: ["2..=MAX_VAULT_LEGS."];
            type: "u8";
          },
          {
            name: "legNames";
            docs: [
              'Per-leg human-readable label (e.g. "Trump", "Biden", "Other"). Used to',
              "derive the launched market names. UTF-8, zero-padded, max 32 bytes.",
            ];
            type: {
              array: [
                {
                  array: ["u8", 32];
                },
                8,
              ];
            };
          },
          {
            name: "legTotals";
            docs: ["Per-leg committed USDC totals (raw u64, 6 decimals)."];
            type: {
              array: ["u64", 8];
            };
          },
          {
            name: "commitEndTs";
            type: "i64";
          },
          {
            name: "marketEndTs";
            type: "i64";
          },
          {
            name: "commitCount";
            type: "u32";
          },
          {
            name: "minTotal";
            type: "u64";
          },
          {
            name: "groupMarketInitialized";
            docs: ["True iff the wrapping GroupMarket account has been created."];
            type: "bool";
          },
          {
            name: "legsLaunched";
            docs: [
              "Number of legs whose underlying Market has been launched + attached.",
              "Once `legs_launched == leg_count` the vault is fully launched and",
              "`claim_committer_group` / `refund_commit_group` is gated accordingly.",
            ];
            type: "u8";
          },
          {
            name: "groupMarket";
            docs: ["GroupMarket PDA. `Pubkey::default()` until launch_vault_group_market."];
            type: "pubkey";
          },
          {
            name: "bump";
            type: "u8";
          },
          {
            name: "reserved";
            type: {
              array: ["u8", 32];
            };
          },
        ];
      };
    },
    {
      name: "groupMarket";
      type: {
        kind: "struct";
        fields: [
          {
            name: "authority";
            type: "pubkey";
          },
          {
            name: "groupId";
            type: "u64";
          },
          {
            name: "startTs";
            type: "i64";
          },
          {
            name: "endTs";
            type: "i64";
          },
          {
            name: "legCount";
            docs: ["Actual number of legs (≤ MAX_LEGS)."];
            type: "u8";
          },
          {
            name: "legs";
            docs: [
              "Pubkeys of attached binary Market PDAs. Slots [0..leg_count) must be",
              "populated before resolution. Pubkey::default() = empty slot.",
            ];
            type: {
              array: ["pubkey", 32];
            };
          },
          {
            name: "resolved";
            type: "bool";
          },
          {
            name: "winningLeg";
            docs: ["Winning leg index (0..leg_count). NO_WINNING_LEG (0xFF) = unresolved."];
            type: "u8";
          },
          {
            name: "bump";
            type: "u8";
          },
          {
            name: "name";
            docs: ["Human-readable group name (UTF-8, zero-padded)."];
            type: {
              array: ["u8", 64];
            };
          },
          {
            name: "totalSeededBps";
            docs: [
              "Cumulative bps seeded across all attached legs. Incremented by",
              "`attach_leg_to_group`, checked by `resolve_group` so Σ p_i ≈ 1 at",
              "settlement (paper invariant for categorical markets).",
            ];
            type: "u32";
          },
          {
            name: "reserved";
            docs: ["Reserved for future expansion."];
            type: {
              array: ["u8", 28];
            };
          },
        ];
      };
    },
    {
      name: "lZeroSuggestion";
      type: {
        kind: "struct";
        fields: [
          {
            name: "market";
            type: "pubkey";
          },
          {
            name: "suggestedLZero";
            type: "u128";
          },
          {
            name: "estimatedPoolValue";
            type: "u64";
          },
          {
            name: "estimatedDailyLvr";
            type: "u64";
          },
          {
            name: "warningHighSigma";
            type: "bool";
          },
          {
            name: "warningShortDuration";
            type: "bool";
          },
        ];
      };
    },
    {
      name: "lpPosition";
      type: {
        kind: "struct";
        fields: [
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "market";
            type: "pubkey";
          },
          {
            name: "shares";
            type: "u128";
          },
          {
            name: "collateralDeposited";
            type: "u64";
          },
          {
            name: "yesPerShareCheckpoint";
            type: "u128";
          },
          {
            name: "noPerShareCheckpoint";
            type: "u128";
          },
          {
            name: "bump";
            type: "u8";
          },
        ];
      };
    },
    {
      name: "market";
      type: {
        kind: "struct";
        fields: [
          {
            name: "authority";
            type: "pubkey";
          },
          {
            name: "marketId";
            type: "u64";
          },
          {
            name: "collateralMint";
            type: "pubkey";
          },
          {
            name: "yesMint";
            type: "pubkey";
          },
          {
            name: "noMint";
            type: "pubkey";
          },
          {
            name: "vault";
            type: "pubkey";
          },
          {
            name: "startTs";
            type: "i64";
          },
          {
            name: "endTs";
            type: "i64";
          },
          {
            name: "lZero";
            type: "u128";
          },
          {
            name: "reserveYes";
            type: "u128";
          },
          {
            name: "reserveNo";
            type: "u128";
          },
          {
            name: "lastAccrualTs";
            type: "i64";
          },
          {
            name: "cumYesPerShare";
            type: "u128";
          },
          {
            name: "cumNoPerShare";
            type: "u128";
          },
          {
            name: "totalYesDistributed";
            type: "u64";
          },
          {
            name: "totalNoDistributed";
            type: "u64";
          },
          {
            name: "totalLpShares";
            type: "u128";
          },
          {
            name: "resolved";
            type: "bool";
          },
          {
            name: "winningSide";
            type: "u8";
          },
          {
            name: "bump";
            type: "u8";
          },
          {
            name: "name";
            type: {
              array: ["u8", 64];
            };
          },
          {
            name: "initialPriceBps";
            type: "u16";
          },
          {
            name: "group";
            type: "pubkey";
          },
        ];
      };
    },
    {
      name: "side";
      type: {
        kind: "enum";
        variants: [
          {
            name: "yes";
          },
          {
            name: "no";
          },
        ];
      };
    },
    {
      name: "swapDirection";
      docs: ["Direction of a swap. Six combinations covering all USDC/YES/NO pairs."];
      type: {
        kind: "enum";
        variants: [
          {
            name: "usdcToYes";
          },
          {
            name: "usdcToNo";
          },
          {
            name: "yesToUsdc";
          },
          {
            name: "noToUsdc";
          },
          {
            name: "yesToNo";
          },
          {
            name: "noToYes";
          },
        ];
      };
    },
  ];
};
