"use client";

import { useState } from "react";
import Link from "next/link";
import { LandingNav } from "@/components/layout/landing-nav";
import { CopyCommand } from "@/components/ui/copy-command";
import { CodeBlock } from "@/components/ui/code-block";

type Tab = "simple" | "detailed";

/** In-app docs. Two tabs: a plain-language overview, and a per-function
 *  reference. The exhaustive reference lives in doc/api-reference.md. */
export default function DocsPage() {
  const [tab, setTab] = useState<Tab>("simple");

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <LandingNav />

      <main className="px-[24px] md:px-[48px] py-[48px] max-w-[860px] mx-auto w-full">
        <div className="text-caption mb-[10px]">Docs · pm-AMM</div>
        <h1 className="text-[34px] md:text-[44px] tracking-[-0.03em] text-text-hi leading-[1.05]">
          {tab === "simple" ? "How it works" : "Integrate pm-AMM"}
        </h1>
        <p className="mt-[16px] text-[15px] leading-[1.6] text-text-dim">
          {tab === "simple"
            ? "A plain-language guide to prediction markets on the pm-AMM — what they are, the three ways to take part, and why the design is different."
            : "Every on-chain instruction and every @pm-amm/sdk function, explained one by one. The full written reference is doc/api-reference.md."}
        </p>

        {/* Tab bar */}
        <div className="mt-[28px] flex gap-[4px] border-b border-line">
          <TabButton active={tab === "simple"} onClick={() => setTab("simple")}>
            Simple
          </TabButton>
          <TabButton active={tab === "detailed"} onClick={() => setTab("detailed")}>
            Detailed · per-function
          </TabButton>
        </div>

        {tab === "simple" ? <SimpleTab /> : <DetailedTab />}

        <div className="mt-[40px] pt-[24px] border-t border-line flex flex-wrap gap-[18px] font-mono text-[12px] text-muted">
          <a
            href="https://github.com/EwanBorgPad/pm-amm/blob/main/doc/api-reference.md"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-text-hi transition-all duration-[120ms]"
          >
            Full API reference →
          </a>
          <a
            href="/llms.txt"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-text-hi transition-all duration-[120ms]"
          >
            LLM reference (llms.txt) →
          </a>
          <Link href="/markets" className="hover:text-text-hi transition-all duration-[120ms]">
            Open the app →
          </Link>
        </div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ Simple */

function SimpleTab() {
  return (
    <>
      <Section title="What is a prediction market?">
        <p className="text-[14px] leading-[1.7] text-text-dim">
          A market on a yes/no question (&ldquo;Will BTC top $200k in 2026?&rdquo;). You buy{" "}
          <b className="text-yes">YES</b> or <b className="text-no">NO</b> tokens with USDC. When
          the event resolves, the winning side redeems for <b>1 USDC each</b> and the losing side
          for <b>0</b>. The price of YES (between 0 and 1) is simply the market&rsquo;s estimate of
          the <b>probability</b> — YES at 0.62 means &ldquo;~62% likely&rdquo;.
        </p>
      </Section>

      <Section title="Three ways to take part">
        <div className="space-y-[14px]">
          <Role title="Bettor" tone="text-text-hi">
            Swap USDC for YES or NO. If you&rsquo;re right, every token pays 1 USDC at resolution.
            You can also sell back any time before resolution at the live price.
          </Role>
          <Role title="Liquidity provider (LP)" tone="text-yes">
            Deposit USDC so others can trade. You earn a <b>continuous yield</b> as the pool
            releases tokens to you over time (the <span className="font-mono">dC_t</span>{" "}
            mechanism), and you take the other side of bettors&rsquo; trades — your cost is
            &ldquo;LVR&rdquo; (the AMM&rsquo;s loss to arbitrage), which this design keeps{" "}
            <b>steady and predictable</b> instead of lumpy.
          </Role>
          <Role title="Creator" tone="text-no">
            Open a market yourself, or open a <b>commitment vault</b> so a crowd funds the starting
            liquidity. The crowd&rsquo;s commits set the opening price; once it launches, the
            committers become the market&rsquo;s LPs.
          </Role>
        </div>
      </Section>

      <Section title="Why pm-AMM is different">
        <ul className="space-y-[10px] text-[14px] leading-[1.65] text-text-dim list-disc pl-[18px] marker:text-line-2">
          <li>
            <b className="text-text-hi">Liquidity decays as √(time left).</b> The LP&rsquo;s risk is
            spread evenly across the whole life of the market — no nasty surprise right before
            expiry.
          </li>
          <li>
            <b className="text-text-hi">Prices stay honest.</b> They track the true probability of
            the event, not just inventory imbalance.
          </li>
          <li>
            <b className="text-text-hi">Always fully collateralized.</b> The vault holds enough USDC
            to pay <i>every</i> winning token — a winner can never be locked out of their payout.
          </li>
        </ul>
      </Section>

      <Section title="What does it cost?">
        <p className="text-[14px] leading-[1.7] text-text-dim">
          There is <b>no protocol fee on trades today</b> — a swap returns exactly what the curve
          quotes (you only pay price impact / slippage). An LP&rsquo;s return comes from the
          curve&rsquo;s spread and the time-release mechanism, not from a fee. A configurable
          trading fee (split to the protocol DAO and the market creator) is the planned next step.
        </p>
      </Section>

      <Section title="Get started">
        <p className="text-[14px] leading-[1.6] text-text-dim mb-[12px]">
          Browse live markets, place a bet, provide liquidity, or open your own market or vault.
        </p>
        <Link
          href="/markets"
          className="inline-block px-[16px] py-[9px] border border-text-hi text-text-hi font-mono text-[13px] hover:bg-text-hi hover:text-bg transition-all duration-[120ms]"
        >
          Open the app →
        </Link>
        <p className="mt-[14px] text-[12px] leading-[1.55] text-muted">
          Building on top? Switch to the <b>Detailed</b> tab for the SDK and every instruction.
        </p>
      </Section>
    </>
  );
}

function Role({
  title,
  tone,
  children,
}: {
  title: string;
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-l-2 border-line pl-[14px]">
      <div className={`text-[13px] font-mono uppercase tracking-[0.04em] ${tone}`}>{title}</div>
      <p className="mt-[4px] text-[13px] leading-[1.6] text-text-dim">{children}</p>
    </div>
  );
}

/* ---------------------------------------------------------------- Detailed */

function DetailedTab() {
  return (
    <>
      <Section title="Install">
        <div className="mb-[12px]">
          <CopyCommand command="npm i @pm-amm/sdk" />
        </div>
        <Code>{`pnpm add @pm-amm/sdk @solana/web3.js @anchor-lang/core @solana/spl-token`}</Code>
        <p className="mt-[10px] text-[12px] leading-[1.55] text-muted">
          web3.js, anchor and spl-token are peer dependencies — your app provides a single copy.
        </p>
      </Section>

      <Section title="Construct a client">
        <Code>{`import { Connection, PublicKey } from "@solana/web3.js";
import { PmAmmClient } from "@pm-amm/sdk";

const PROGRAM_ID = new PublicKey("GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y");
const USDC_MINT  = new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ");

const client = PmAmmClient.readOnly(new Connection(RPC), PROGRAM_ID, USDC_MINT);   // queries
const client = PmAmmClient.fromProvider(provider, PROGRAM_ID, USDC_MINT);          // sign + send`}</Code>
      </Section>

      <Section title="Binary market — 10 instructions">
        <FnList
          items={[
            [
              "initialize_market",
              "Create the market PDA, YES/NO mints, USDC vault + metadata. initial_price_bps seeds the price. SDK: send.createMarket(input).",
            ],
            [
              "deposit_liquidity",
              "Add USDC, get LP shares. First deposit calibrates L_0 so max(x,y)=deposit (fully collateralized). SDK: send.depositLiquidity(market, usdc).",
            ],
            [
              "swap",
              "Trade USDC↔YES, USDC↔NO, YES↔NO (6 directions). Reverts on slippage or if it would break solvency. SDK: send.swap({market,direction,amountIn,minOutput}).",
            ],
            [
              "withdraw_liquidity",
              "Burn LP shares → receive proportional YES+NO (auto-claims residuals). SDK: send.withdrawLiquidity(market, shares).",
            ],
            [
              "accrue",
              "Permissionless dC_t accrual (release reserves to LPs as L_eff decays). SDK: send.accrue(market).",
            ],
            [
              "claim_lp_residuals",
              "Mint your accrued YES+NO residuals. SDK: send.claimLpResiduals(market).",
            ],
            [
              "redeem_pair",
              "Burn 1 YES + 1 NO → 1 USDC, any time. SDK: send.redeemPair(market, amount).",
            ],
            [
              "suggest_l_zero",
              "View-only: emit the optimal L_0 for a budget. SDK: ix.buildSuggestLZero(...).",
            ],
            [
              "resolve_market",
              "Authority-only, after expiry: set the winning side. SDK: send.resolveMarket(market, side).",
            ],
            [
              "claim_winnings",
              "Burn winning tokens for 1 USDC each (losing side → 0). SDK: send.claimWinnings(market).",
            ],
          ]}
        />
      </Section>

      <Section title="Multi-outcome group — 5 instructions">
        <FnList
          items={[
            [
              "initialize_group_market",
              "Create a GroupMarket wrapping N (2–32) binary legs. SDK: flows.createGroup(...).",
            ],
            [
              "attach_leg_to_group",
              "Bind a binary market as a leg, seeded at 10000/N bps (write-once).",
            ],
            ["resolve_group", "Authority-only, after expiry: pick the winning leg."],
            [
              "resolve_group_leg",
              "Permissionless cascade: finalize each leg from the group's winner. SDK: flows.claimAllGroupWinnings(...).",
            ],
            [
              "cancel_group_market",
              "Authority-only: void an abandoned group → every leg settles No. SDK: flows.cancelGroup(...).",
            ],
          ]}
        />
      </Section>

      <Section title="Binary commitment vault — committers become LPs">
        <FnList
          items={[
            [
              "initialize_vault",
              "Open a vault (commit window, market duration, min total). SDK: send.createVault(input).",
            ],
            [
              "vault_commit",
              "Commit USDC on YES/NO; the ratio sets the launch price. SDK: send.vaultCommit(vault, side, usdc).",
            ],
            [
              "launch_vault_market",
              "After commit_end & min_total: create the market AND deposit the whole pot as liquidity. SDK: send.launchVaultMarket(vault).",
            ],
            [
              "claim_committer",
              "Materialize your LP position (1 USDC committed = 1 LP share). SDK: send.claimCommitter(vault, market).",
            ],
            [
              "refund_commit",
              "1:1 refund — only if the launch can no longer succeed. SDK: send.refundCommit(vault).",
            ],
          ]}
        />
      </Section>

      <Section title="Multi-outcome commitment vault — 6 instructions">
        <FnList
          items={[
            [
              "initialize_vault_group",
              "Open an N-leg (2–8) vault with named legs. SDK: send.createVaultGroup(input).",
            ],
            [
              "vault_commit_group",
              "Commit USDC on a specific leg. SDK: send.vaultCommitGroup(vault, legIndex, usdc).",
            ],
            [
              "launch_vault_group_market",
              "Step 1: create the wrapping GroupMarket. SDK: send.launchVaultGroupMarket(vault).",
            ],
            [
              "launch_vault_group_leg",
              "Step 2 (per leg): create + attach the leg market. SDK: send.launchVaultGroupLeg(vault, group, legIndex).",
            ],
            [
              "claim_committer_group",
              "Per-leg: mint that leg's YES 1:1 + move backing. SDK: send.claimCommitterGroup(vault, group, legMarket, legIndex).",
            ],
            [
              "refund_commit_group",
              "Refund unclaimed legs if the launch can't complete. SDK: send.refundCommitGroup(vault).",
            ],
          ]}
        />
      </Section>

      <Section title="SDK surface">
        <FnList
          items={[
            [
              "client.fetch*",
              "Typed reads: fetchMarket/All, fetchGroup/All, fetchVault/All, fetchVaultGroup/All, fetchLpPosition, fetchCommitPosition, fetchCommitGroupPosition.",
            ],
            [
              "client.ix.*",
              "Composable TransactionInstruction builders for all 26 instructions (build* one-to-one with the list above).",
            ],
            [
              "client.send.*",
              "Build + compute-budget + ATA-ensure + sign + send. The common path.",
            ],
            [
              "client.flows.*",
              "createGroup, cancelGroup, findClaimableLegs, claimAllGroupWinnings.",
            ],
            [
              "@pm-amm/sdk/math",
              "Pure: phi, capitalPhi, priceFromReserves, poolValue, estimateSwapOutput, simulateLpDeposit, lpPositionPnl, expectedDailyLvr, formatUsdc/Price, group helpers.",
            ],
          ]}
        />
      </Section>

      <Section title="Code: read, trade, vaults, math">
        <Code>{`// reads
const markets = await client.fetchAllMarkets();
const lp = await client.fetchLpPosition(market, owner);

// trade & LP
await client.send.swap({ market, direction: "UsdcToYes", amountIn: 10_000_000, minOutput });
await client.send.depositLiquidity(market, 100);

// commitment vault (vault = LP)
const { vaultPda } = await client.send.createVault({
  name: "Crowd market", commitDurationSecs: 3600, marketDurationSecs: 86_400, minTotalUsdc: 50,
});
await client.send.vaultCommit(vaultPda, "yes", 25);
const { marketPda } = await client.send.launchVaultMarket(vaultPda);
await client.send.claimCommitter(vaultPda, marketPda);   // → LP position

// pricing math (no chain)
import { poolValue, priceFromReserves } from "@pm-amm/sdk/math";
const price = priceFromReserves(reserveYes, reserveNo, lEff);
const tvl   = poolValue(price, lEff);`}</Code>
      </Section>
    </>
  );
}

function FnList({ items }: { items: [string, string][] }) {
  return (
    <div className="space-y-[10px]">
      {items.map(([name, desc]) => (
        <div
          key={name}
          className="grid grid-cols-1 sm:grid-cols-[210px_1fr] gap-[4px] sm:gap-[14px]"
        >
          <code className="text-[12.5px] text-text-hi font-mono break-words">{name}</code>
          <p className="text-[13px] leading-[1.55] text-text-dim">{desc}</p>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ shared */

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-[14px] py-[9px] text-[13px] font-mono -mb-px border-b-2 transition-all duration-[120ms] ${
        active ? "border-text-hi text-text-hi" : "border-transparent text-muted hover:text-text-dim"
      }`}
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-[32px]">
      <h2 className="text-[20px] tracking-[-0.01em] text-text-hi mb-[12px]">{title}</h2>
      {children}
    </section>
  );
}

function Code({ children }: { children: string }) {
  return <CodeBlock code={children} />;
}
