/**
 * Integration tests for the Multi-outcome Commitment Vault (Sprint 23).
 *
 * Localnet (surfpool) can't clock-warp, so we exercise:
 *   - happy path init + commit (per-leg aggregates)
 *   - validation rejects (out-of-range leg index, too-small commit, bad name)
 *   - pre-deadline launch rejection
 */

import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PmAmm } from "../target/types/pm_amm";
import { PublicKey, SystemProgram, Keypair, type Connection, type Signer } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAccount, mintTo } from "@solana/spl-token";
import { assert } from "chai";

const VAULT_GROUP_SEED = Buffer.from("vault_group");
const VAULT_GROUP_COLLATERAL_SEED = Buffer.from("vault_group_collateral");
const COMMIT_GROUP_SEED = Buffer.from("commit_group");

function deriveVaultGroupPda(vaultId: anchor.BN, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [VAULT_GROUP_SEED, vaultId.toArrayLike(Buffer, "le", 8)],
    programId,
  )[0];
}

function deriveVaultGroupCollateralPda(vault: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [VAULT_GROUP_COLLATERAL_SEED, vault.toBuffer()],
    programId,
  )[0];
}

function deriveCommitGroupPda(vault: PublicKey, owner: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [COMMIT_GROUP_SEED, vault.toBuffer(), owner.toBuffer()],
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

describe("commitment_vault_group", () => {
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
  let nextVaultId = Math.floor(Math.random() * 900_000_000) + 7_000_000_000;

  before(async () => {
    collateralMint = await createMint(provider.connection, payer, authority, null, 6);
  });

  async function openVaultGroup(opts: {
    name?: string;
    legNames?: string[];
    commitDuration?: number;
    marketDuration?: number;
    minTotal?: number;
  }): Promise<{ vaultId: anchor.BN; vaultPda: PublicKey; legNames: string[] }> {
    const vaultId = new anchor.BN(nextVaultId++);
    const vaultPda = deriveVaultGroupPda(vaultId, program.programId);
    const vaultCollateral = deriveVaultGroupCollateralPda(vaultPda, program.programId);
    const legNames = opts.legNames ?? ["A", "B", "C"];
    await m
      .initializeVaultGroup(
        vaultId,
        opts.name ?? `Group ${vaultId.toString()}`,
        legNames,
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
    return { vaultId, vaultPda, legNames };
  }

  it("initialize_vault_group — happy path (3 legs)", async () => {
    const { vaultId, vaultPda, legNames } = await openVaultGroup({
      name: "2028 US Election",
      legNames: ["Trump", "Newsom", "Other"],
    });
    const v = await accs.commitmentVaultGroup.fetch(vaultPda);
    assert.ok(v.authority.equals(authority));
    assert.equal(v.vaultId.toString(), vaultId.toString());
    assert.equal(v.legCount, legNames.length);
    assert.equal(v.commitCount, 0);
    assert.equal(v.groupMarketInitialized, false);
    assert.equal(v.legsLaunched, 0);
    // leg names decoded
    const decoded = (v.legNames as number[][]).slice(0, v.legCount).map((bytes) => {
      const end = bytes.indexOf(0);
      return new TextDecoder().decode(new Uint8Array(end >= 0 ? bytes.slice(0, end) : bytes));
    });
    assert.deepEqual(decoded, legNames);
  });

  it("rejects fewer than 2 legs", async () => {
    try {
      await openVaultGroup({ legNames: ["only-one"] });
      assert.fail("Should reject single-leg group");
    } catch (err) {
      assert.include(String(err), "InvalidLegCount");
    }
  });

  it("rejects more than 8 legs", async () => {
    try {
      await openVaultGroup({
        legNames: ["L0", "L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"],
      });
      assert.fail("Should reject 9-leg group");
    } catch (err) {
      assert.include(String(err), "InvalidLegCount");
    }
  });

  it("rejects empty leg name", async () => {
    try {
      await openVaultGroup({ legNames: ["", "B"] });
      assert.fail("Should reject empty leg name");
    } catch (err) {
      assert.include(String(err), "InvalidLegName");
    }
  });

  it("commit_group — happy path, increments per-leg aggregates", async () => {
    const { vaultPda } = await openVaultGroup({});
    const vaultCollateral = deriveVaultGroupCollateralPda(vaultPda, program.programId);
    const userUsdc = await createTokenAccount(
      provider.connection,
      payer,
      collateralMint,
      authority,
    );
    await mintTo(provider.connection, payer, collateralMint, userUsdc, payer, 100_000_000);
    const commitPos = deriveCommitGroupPda(vaultPda, authority, program.programId);

    // 5 USDC on leg 0
    await m
      .vaultCommitGroup(0, new anchor.BN(5_000_000))
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

    // 3 USDC on leg 1
    await m
      .vaultCommitGroup(1, new anchor.BN(3_000_000))
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

    const v = await accs.commitmentVaultGroup.fetch(vaultPda);
    assert.equal((v.legTotals as anchor.BN[])[0].toString(), "5000000");
    assert.equal((v.legTotals as anchor.BN[])[1].toString(), "3000000");
    assert.equal((v.legTotals as anchor.BN[])[2].toString(), "0");
    assert.equal(v.commitCount, 1); // same signer

    const pos = await accs.commitPositionGroup.fetch(commitPos);
    assert.equal((pos.legAmounts as anchor.BN[])[0].toString(), "5000000");
    assert.equal((pos.legAmounts as anchor.BN[])[1].toString(), "3000000");
    assert.equal(pos.claimed, false);
  });

  it("rejects commit on leg_index >= leg_count", async () => {
    const { vaultPda } = await openVaultGroup({}); // 3 legs
    const vaultCollateral = deriveVaultGroupCollateralPda(vaultPda, program.programId);
    const userUsdc = await createTokenAccount(
      provider.connection,
      payer,
      collateralMint,
      authority,
    );
    await mintTo(provider.connection, payer, collateralMint, userUsdc, payer, 10_000_000);
    const commitPos = deriveCommitGroupPda(vaultPda, authority, program.programId);

    try {
      await m
        .vaultCommitGroup(5, new anchor.BN(2_000_000))
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
      assert.fail("Should reject leg_index=5 with leg_count=3");
    } catch (err) {
      assert.include(String(err), "VaultGroupLegOutOfBounds");
    }
  });

  it("rejects commit_group below MIN_COMMIT_USDC", async () => {
    const { vaultPda } = await openVaultGroup({});
    const vaultCollateral = deriveVaultGroupCollateralPda(vaultPda, program.programId);
    const userUsdc = await createTokenAccount(
      provider.connection,
      payer,
      collateralMint,
      authority,
    );
    await mintTo(provider.connection, payer, collateralMint, userUsdc, payer, 5_000_000);
    const commitPos = deriveCommitGroupPda(vaultPda, authority, program.programId);

    try {
      await m
        .vaultCommitGroup(0, new anchor.BN(500_000)) // 0.5 USDC
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

  it("rejects launch_vault_group_market before commit_end_ts", async () => {
    const { vaultPda } = await openVaultGroup({});
    const groupId = new anchor.BN(Math.floor(Math.random() * 1e9) + 8_000_000_000);
    const groupPda = PublicKey.findProgramAddressSync(
      [Buffer.from("group"), groupId.toArrayLike(Buffer, "le", 8)],
      program.programId,
    )[0];

    try {
      await m
        .launchVaultGroupMarket(groupId)
        .accountsPartial({
          payer: authority,
          vault: vaultPda,
          groupMarket: groupPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      assert.fail("Should reject pre-deadline launch");
    } catch (err) {
      assert.include(String(err), "CommitPhaseNotEnded");
    }
  });

  it("rejects refund_commit_group before commit_end_ts", async () => {
    const { vaultPda } = await openVaultGroup({});
    const vaultCollateral = deriveVaultGroupCollateralPda(vaultPda, program.programId);
    const userUsdc = await createTokenAccount(
      provider.connection,
      payer,
      collateralMint,
      authority,
    );
    await mintTo(provider.connection, payer, collateralMint, userUsdc, payer, 10_000_000);
    const commitPos = deriveCommitGroupPda(vaultPda, authority, program.programId);

    // Non-zero position
    await m
      .vaultCommitGroup(0, new anchor.BN(2_000_000))
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
        .refundCommitGroup()
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
