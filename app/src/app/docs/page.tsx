import Link from "next/link";
import { LandingNav } from "@/components/layout/landing-nav";
import { CopyCommand } from "@/components/ui/copy-command";
import { CodeBlock } from "@/components/ui/code-block";

/** In-app integration guide for `@pm-amm/sdk`. The canonical reference is the
 *  package README; this page mirrors the essentials. Static — no data hooks. */
export default function DocsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <LandingNav />

      <main className="px-[24px] md:px-[48px] py-[48px] max-w-[860px] mx-auto w-full">
        <div className="text-caption mb-[10px]">SDK · @pm-amm/sdk</div>
        <h1 className="text-[34px] md:text-[44px] tracking-[-0.03em] text-text-hi leading-[1.05]">
          Integrate pm-AMM
        </h1>
        <p className="mt-[16px] text-[15px] leading-[1.6] text-text-dim">
          A framework-agnostic TypeScript SDK for the pm-AMM Solana program — markets, commitment
          vaults, and multi-outcome groups. One typed client wraps all 26 instructions, the typed
          account reads, and the pricing math.
        </p>

        <Section title="Install">
          <div className="mb-[12px]">
            <CopyCommand command="npm i @pm-amm/sdk" />
          </div>
          <Code>{`pnpm add @pm-amm/sdk @solana/web3.js @anchor-lang/core @solana/spl-token`}</Code>
          <p className="mt-[10px] text-[12px] leading-[1.55] text-muted">
            web3.js, anchor and spl-token are peer dependencies — your app provides a single copy
            (so <span className="font-mono">PublicKey instanceof</span> stays consistent).
          </p>
        </Section>

        <Section title="Construct a client">
          <p className="text-[14px] leading-[1.6] text-text-dim mb-[14px]">
            The client is bound to one deployment: pass the program id and the collateral (USDC)
            mint. Use <span className="font-mono">readOnly</span> for queries, or{" "}
            <span className="font-mono">fromProvider</span> with an Anchor provider to sign.
          </p>
          <Code>{`import { Connection, PublicKey } from "@solana/web3.js";
import { PmAmmClient } from "@pm-amm/sdk";

const PROGRAM_ID = new PublicKey("GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y");
const USDC_MINT  = new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ");

// read-only
const client = PmAmmClient.readOnly(new Connection(RPC), PROGRAM_ID, USDC_MINT);

// wallet-aware (browser): build an AnchorProvider from your wallet adapter
const client = PmAmmClient.fromProvider(provider, PROGRAM_ID, USDC_MINT);`}</Code>
        </Section>

        <Section title="Read state">
          <Code>{`const markets = await client.fetchAllMarkets();        // typed Market accounts
const groups  = await client.fetchAllGroups();         // multi-outcome groups
const vaults  = await client.fetchAllVaults();          // binary commitment vaults
const lp      = await client.fetchLpPosition(market, owner);

// PDAs are pure helpers, bound to the client's program id:
const yes = client.yesMint(market);
const vaultPda = client.vaultPda(vaultId);`}</Code>
        </Section>

        <Section title="Create a market">
          <Code>{`const { marketId, marketPda, signature } = await client.send.createMarket({
  name: "Will BTC top $200k in 2026?",
  durationSecs: 7 * 86_400,
  initialPriceBps: 5000,   // 50% (0 = legacy 50/50)
  depositUsdc: 250,        // optional bootstrap liquidity, same tx
});`}</Code>
        </Section>

        <Section title="Trade & provide liquidity">
          <Code>{`// swap (amounts are raw 6-dp micro-units; compute your own slippage min)
await client.send.swap(market, "usdcToYes", 10_000_000, minOut);

await client.send.depositLiquidity(market, 100);   // USDC
await client.send.claimWinnings(market);            // post-resolution

// or compose the raw instruction yourself:
const ix = await client.ix.swap({ signer, market, direction: "usdcToYes",
  amountIn: 10_000_000, minOutput: minOut });`}</Code>
        </Section>

        <Section title="Commitment vaults">
          <Code>{`// binary vault: open → commit → launch → claim
const { vaultPda } = await client.send.createVault({
  name: "Crowd market", commitDurationSecs: 3600,
  marketDurationSecs: 86_400, minTotalUsdc: 50,
});
await client.send.vaultCommit(vault, "yes", 25);
const { marketPda } = await client.send.launchVaultMarket(vault);
await client.send.claimCommitter(vault, marketPda);

// multi-outcome (2–8 legs) via flows:
const res = await client.flows.createGroup({
  name: "Who wins?", legNames: ["A", "B", "C"],
  durationSecs: 86_400, budgetPerLegUsdc: 30,
});`}</Code>
        </Section>

        <Section title="Pricing math (no chain needed)">
          <Code>{`import { poolValue, priceFromReserves, estimateSwapOutput } from "@pm-amm/sdk/math";

const price = priceFromReserves(reserveYes, reserveNo, lEff);
const tvl   = poolValue(price, lEff);`}</Code>
        </Section>

        <Section title="Surface at a glance">
          <ul className="space-y-[8px] text-[13px] leading-[1.6] text-text-dim list-disc pl-[18px] marker:text-line-2">
            <li>
              <b>reads</b> — fetchMarket/All, fetchGroup/All, fetchVault/All, fetchLpPosition,
              vault-group + commit-position reads
            </li>
            <li>
              <b>client.ix.*</b> — composable{" "}
              <span className="font-mono">TransactionInstruction</span> builders for all 26
              instructions
            </li>
            <li>
              <b>client.send.*</b> — build + compute-budget + ATA-ensure + send for every operation
            </li>
            <li>
              <b>client.flows.*</b> — createGroup, resolveGroup, findClaimableLegs,
              claimAllGroupWinnings
            </li>
            <li>
              <b>@pm-amm/sdk/math</b> — phi/Phi, priceFromReserves, poolValue, LP simulation, group
              helpers
            </li>
          </ul>
        </Section>

        <div className="mt-[40px] pt-[24px] border-t border-line flex flex-wrap gap-[18px] font-mono text-[12px] text-muted">
          <a
            href="https://github.com/EwanBorgPad/pm-amm/tree/main/packages/sdk"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-text-hi transition-all duration-[120ms]"
          >
            Full README on GitHub →
          </a>
          <a
            href="/llms.txt"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-text-hi transition-all duration-[120ms]"
          >
            LLM / API reference (llms.txt) →
          </a>
          <Link href="/markets" className="hover:text-text-hi transition-all duration-[120ms]">
            Open the app →
          </Link>
        </div>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-[40px]">
      <h2 className="text-[20px] tracking-[-0.01em] text-text-hi mb-[12px]">{title}</h2>
      {children}
    </section>
  );
}

function Code({ children }: { children: string }) {
  return <CodeBlock code={children} />;
}
