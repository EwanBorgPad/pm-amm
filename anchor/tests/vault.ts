/**
 * Integration tests for the Commitment Vault (Sprint 22).
 *
 * Covers `initialize_vault`, `vault_commit`, and `refund_commit` end-to-end
 * on localnet. The launch + claim happy path requires expiring the commit
 * phase (`commit_end_ts` passes), which surfpool doesn't clock-warp, so we
 * exercise the pre-deadline reject branches for those.
 */

import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PmAmm } from "../target/types/pm_amm";
import {
  PublicKey,
  SystemProgram,
  Keypair,
  type Connection,
  type Signer,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAccount, mintTo } from "@solana/spl-token";
import { assert } from "chai";

const VAULT_SEED = Buffer.from("vault");
const VAULT_COLLATERAL_SEED = Buffer.from("vault_collateral");
const COMMIT_SEED = Buffer.from("commit");

function deriveVaultPda(vaultId: anchor.BN, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, vaultId.toArrayLike(Buffer, "le", 8)],
    programId,
  )[0];
}

function deriveVaultCollateralPda(vault: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [VAULT_COLLATERAL_SEED, vault.toBuffer()],
    programId,
  )[0];
}

function deriveCommitPositionPda(
  vault: PublicKey,
  owner: PublicKey,
  programId: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [COMMIT_SEED, vault.toBuffer(), owner.toBuffer()],
    programId,
  )[0];
}

async function createTokenAccount(
  connection: Connection,
  payer: Signer,
  mint: PublicKey,
  owner: PublicKey,
): Promise<PublicKey> {
  const kp = Keypair.generate();
  return createAccount(connection, payer, mint, owner, kp);
}

describe("commitment_vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.pmAmm as Program<PmAmm>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = program.methods as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accs = program.account as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payer = (provider.wallet as any).payer;
  const authority = provider.wallet.publicKey;

  let collateralMint: PublicKey;
  let nextVaultId = Math.floor(Math.random() * 900_000_000) + 5_000_000_000;

  before(async () => {
    collateralMint = await createMint(provider.connection, payer, authority, null, 6);
  });

  async function openVault(opts: {
    name?: string;
    commitDuration?: number;
    marketDuration?: number;
    minTotal?: number; // in raw u64 (e.g. 10_000_000 = 10 USDC)
  }): Promise<{ vaultId: anchor.BN; vaultPda: PublicKey }> {
    const vaultId = new anchor.BN(nextVaultId++);
    const vaultPda = deriveVaultPda(vaultId, program.programId);
    const vaultCollateral = deriveVaultCollateralPda(vaultPda, program.programId);
    await m
      .initializeVault(
        vaultId,
        opts.name ?? `Vault ${vaultId.toString()}`,
        new anchor.BN(opts.commitDuration ?? 600),
        new anchor.BN(opts.marketDuration ?? 3600),
        new anchor.BN(opts.minTotal ?? 10_000_000),
      )
      .accountsPartial({
        authority,
        vault: vaultPda,
        collateralMint,
        vaultCollateral,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();
    return { vaultId, vaultPda };
  }

  it("initialize_vault — happy path", async () => {
    const { vaultId, vaultPda } = await openVault({ name: "Will BTC hit $200k?" });
    const v = await accs.commitmentVault.fetch(vaultPda);
    assert.ok(v.authority.equals(authority));
    assert.equal(v.vaultId.toString(), vaultId.toString());
    assert.equal(v.launched, false);
    assert.equal(v.yesTotal.toString(), "0");
    assert.equal(v.noTotal.toString(), "0");
    assert.equal(v.commitCount, 0);
    assert.ok(v.market.equals(PublicKey.default));
  });

  it("rejects initialize_vault with commit_duration < 1 min", async () => {
    try {
      await openVault({ commitDuration: 30 });
      assert.fail("Should reject short commit_duration");
    } catch (err) {
      assert.include(String(err), "InvalidCommitDuration");
    }
  });

  it("rejects initialize_vault with market_duration < 5 min", async () => {
    try {
      await openVault({ marketDuration: 60 });
      assert.fail("Should reject short market_duration");
    } catch (err) {
      assert.include(String(err), "InvalidMarketDuration");
    }
  });

  it("rejects initialize_vault with empty name", async () => {
    try {
      await openVault({ name: "" });
      assert.fail("Should reject empty name");
    } catch (err) {
      assert.include(String(err), "InvalidName");
    }
  });

  it("rejects initialize_vault with min_total = 0", async () => {
    try {
      await openVault({ minTotal: 0 });
      assert.fail("Should reject zero min_total");
    } catch (err) {
      assert.include(String(err), "InvalidBudget");
    }
  });

  it("commit — happy path, increments aggregates", async () => {
    const { vaultPda } = await openVault({});
    const vaultCollateral = deriveVaultCollateralPda(vaultPda, program.programId);
    const userUsdc = await createTokenAccount(
      provider.connection,
      payer,
      collateralMint,
      authority,
    );
    await mintTo(provider.connection, payer, collateralMint, userUsdc, payer, 100_000_000);

    const commitPos = deriveCommitPositionPda(vaultPda, authority, program.programId);

    // 5 USDC on YES
    await m
      .vaultCommit({ yes: {} }, new anchor.BN(5_000_000))
      .accountsPartial({
        signer: authority,
        vault: vaultPda,
        collateralMint,
        vaultCollateral,
        userCollateral: userUsdc,
        commitPosition: commitPos,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    let v = await accs.commitmentVault.fetch(vaultPda);
    assert.equal(v.yesTotal.toString(), "5000000");
    assert.equal(v.commitCount, 1);

    // Second commit, 3 USDC on NO, same wallet → updates same CommitPosition
    await m
      .vaultCommit({ no: {} }, new anchor.BN(3_000_000))
      .accountsPartial({
        signer: authority,
        vault: vaultPda,
        collateralMint,
        vaultCollateral,
        userCollateral: userUsdc,
        commitPosition: commitPos,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    v = await accs.commitmentVault.fetch(vaultPda);
    assert.equal(v.yesTotal.toString(), "5000000");
    assert.equal(v.noTotal.toString(), "3000000");
    // commit_count stays at 1 because it's the same signer reusing the same position
    assert.equal(v.commitCount, 1);

    const pos = await accs.commitPosition.fetch(commitPos);
    assert.equal(pos.yesAmount.toString(), "5000000");
    assert.equal(pos.noAmount.toString(), "3000000");
    assert.equal(pos.claimed, false);
  });

  it("rejects commit below MIN_COMMIT_USDC (1 USDC)", async () => {
    const { vaultPda } = await openVault({});
    const vaultCollateral = deriveVaultCollateralPda(vaultPda, program.programId);
    const userUsdc = await createTokenAccount(
      provider.connection,
      payer,
      collateralMint,
      authority,
    );
    await mintTo(provider.connection, payer, collateralMint, userUsdc, payer, 1_000_000);
    const commitPos = deriveCommitPositionPda(vaultPda, authority, program.programId);
    try {
      await m
        .vaultCommit({ yes: {} }, new anchor.BN(500_000)) // 0.5 USDC
        .accountsPartial({
          signer: authority,
          vault: vaultPda,
          collateralMint,
          vaultCollateral,
          userCollateral: userUsdc,
          commitPosition: commitPos,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      assert.fail("Should reject below min commit");
    } catch (err) {
      assert.include(String(err), "CommitTooSmall");
    }
  });

  it("rejects launch_vault_market before commit_end_ts", async () => {
    // We can't clock-warp on surfpool; this test only proves the pre-deadline
    // guard fires. Post-deadline happy path requires devnet smoke testing.
    const { vaultId, vaultPda } = await openVault({});
    const marketId = new anchor.BN(Math.floor(Math.random() * 1e9) + 6_000_000_000);
    const marketPda = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), marketId.toArrayLike(Buffer, "le", 8)],
      program.programId,
    )[0];
    const yesMint = PublicKey.findProgramAddressSync(
      [Buffer.from("yes_mint"), marketPda.toBuffer()],
      program.programId,
    )[0];
    const noMint = PublicKey.findProgramAddressSync(
      [Buffer.from("no_mint"), marketPda.toBuffer()],
      program.programId,
    )[0];
    const marketVault = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), marketPda.toBuffer()],
      program.programId,
    )[0];
    const METAPLEX = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
    const yesMetadata = PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), METAPLEX.toBuffer(), yesMint.toBuffer()],
      METAPLEX,
    )[0];
    const noMetadata = PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), METAPLEX.toBuffer(), noMint.toBuffer()],
      METAPLEX,
    )[0];

    try {
      await m
        .launchVaultMarket(marketId)
        .accountsPartial({
          payer: authority,
          vault: vaultPda,
          market: marketPda,
          collateralMint,
          yesMint,
          noMint,
          marketVault,
          yesMetadata,
          noMetadata,
          tokenMetadataProgram: METAPLEX,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      assert.fail("Should reject pre-deadline launch");
    } catch (err) {
      assert.include(String(err), "CommitPhaseNotEnded");
    }
    void vaultId;
  });

  it("rejects refund_commit before commit_end_ts", async () => {
    const { vaultPda } = await openVault({});
    const vaultCollateral = deriveVaultCollateralPda(vaultPda, program.programId);
    const userUsdc = await createTokenAccount(
      provider.connection,
      payer,
      collateralMint,
      authority,
    );
    await mintTo(provider.connection, payer, collateralMint, userUsdc, payer, 10_000_000);
    const commitPos = deriveCommitPositionPda(vaultPda, authority, program.programId);

    // Need a non-zero position first
    await m
      .vaultCommit({ yes: {} }, new anchor.BN(2_000_000))
      .accountsPartial({
        signer: authority,
        vault: vaultPda,
        collateralMint,
        vaultCollateral,
        userCollateral: userUsdc,
        commitPosition: commitPos,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    try {
      await m
        .refundCommit()
        .accountsPartial({
          signer: authority,
          vault: vaultPda,
          vaultCollateral,
          collateralMint,
          userCollateral: userUsdc,
          commitPosition: commitPos,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      assert.fail("Should reject pre-deadline refund");
    } catch (err) {
      assert.include(String(err), "CommitPhaseNotEnded");
    }
  });
});
