import Link from "next/link";
import { LandingNav } from "@/components/layout/landing-nav";
import { CopyCommand } from "@/components/ui/copy-command";

/**
 * Marketing landing. Intentionally static — no wallet, no chain reads — so it
 * loads instantly. The live market feed lives at `/markets`.
 */
export default function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <LandingNav />

      {/* Hero */}
      <section className="px-[24px] md:px-[48px] pt-[72px] md:pt-[112px] pb-[64px] max-w-[1100px] mx-auto w-full">
        <div className="inline-flex items-center gap-[8px] font-mono text-[10px] tracking-[0.12em] uppercase text-muted border border-line rounded-full px-[12px] py-[5px] mb-[28px]">
          <span className="w-[6px] h-[6px] rounded-full bg-yes" />
          Paradigm pm-AMM · Solana · Devnet
        </div>

        <h1 className="text-[40px] md:text-[64px] leading-[1.02] tracking-[-0.03em] text-text-hi font-medium max-w-[18ch]">
          Prediction markets with{" "}
          <span className="text-accent">uniform loss-versus-rebalancing</span>.
        </h1>

        <p className="mt-[24px] text-[15px] md:text-[17px] leading-[1.6] text-text-dim max-w-[64ch]">
          A faithful implementation of the Paradigm pm-AMM (Moallemi &amp; Robinson, 2024).
          Time-decaying liquidity <span className="font-mono text-text-hi">L_eff = L₀·√(T−t)</span>{" "}
          delivers uniform LVR across price <em>and</em> time, with continuous LP yield via the dC_t
          mechanism — plus permissionless crowd-bootstrapped markets through Commitment Vaults.
        </p>

        <div className="mt-[36px] flex flex-wrap items-center gap-[12px]">
          <Link
            href="/markets"
            className="px-[18px] py-[11px] bg-text-hi text-bg rounded-md font-mono text-[13px] tracking-[0.03em] font-medium hover:opacity-90 transition-all duration-[120ms]"
          >
            Launch app →
          </Link>
          <Link
            href="/docs"
            className="px-[18px] py-[11px] border border-line-2 text-text-hi rounded-md font-mono text-[13px] tracking-[0.03em] hover:bg-surface transition-all duration-[120ms]"
          >
            Integrate the SDK
          </Link>
          <CopyCommand command="npm i @pm-amm/sdk" />
        </div>
      </section>

      {/* Three pillars */}
      <section className="px-[24px] md:px-[48px] pb-[72px] max-w-[1100px] mx-auto w-full">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-[1px] bg-line border border-line rounded-xl overflow-hidden">
          <Pillar
            tag="01 — Markets"
            title="Dynamic pm-AMM"
            body="Binary YES/NO markets priced by P = Φ((y−x)/L_eff). Liquidity decays to zero at expiry so LVR is constant per unit time — LPs earn a predictable yield, arbitrageurs keep the price honest."
          />
          <Pillar
            tag="02 — Vaults"
            title="Commitment Vaults"
            body="Anyone opens a vault; the crowd commits USDC; at launch the market is seeded at the commit-implied price. Binary, or multi-outcome categorical markets of 2–8 legs with Σ pᵢ = 1."
          />
          <Pillar
            tag="03 — SDK"
            title="@pm-amm/sdk"
            body="One typed client wraps all 26 instructions: PDA helpers, decoded reads, composable instruction builders, send wrappers, multi-tx flows, and the float-64 pricing math. Framework-agnostic."
          />
        </div>
      </section>

      {/* SDK snippet */}
      <section className="px-[24px] md:px-[48px] pb-[88px] max-w-[1100px] mx-auto w-full">
        <div className="grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-[32px] items-center">
          <div>
            <div className="text-caption mb-[12px]">FOR BUILDERS</div>
            <h2 className="text-[26px] md:text-[32px] tracking-[-0.02em] text-text-hi leading-[1.1]">
              Markets &amp; vaults in a few lines.
            </h2>
            <p className="mt-[14px] text-[14px] leading-[1.6] text-text-dim max-w-[48ch]">
              Point the client at any deployment — pass your program id and collateral mint, supply
              a wallet provider to sign. Read the{" "}
              <Link
                href="/docs"
                className="text-accent hover:text-text-hi underline underline-offset-2"
              >
                integration guide
              </Link>{" "}
              to get started.
            </p>
          </div>
          <pre className="bg-surface border border-line rounded-lg p-[20px] overflow-x-auto font-mono text-[12.5px] leading-[1.7] text-text">
            <span className="text-muted">{`// 1. construct a client (read-only or wallet-aware)`}</span>
            {"\n"}
            <span className="text-no">import</span> {`{ PmAmmClient } `}
            <span className="text-no">from</span>{" "}
            <span className="text-yes">{`"@pm-amm/sdk"`}</span>;{"\n\n"}
            <span className="text-no">const</span> client = PmAmmClient.fromProvider(provider,
            PROGRAM_ID, USDC_MINT);
            {"\n\n"}
            <span className="text-muted">{`// 2. read markets, or create one`}</span>
            {"\n"}
            <span className="text-no">const</span> markets = <span className="text-no">await</span>{" "}
            client.fetchAllMarkets();
            {"\n"}
            <span className="text-no">await</span> client.send.createMarket({"{"}
            {"\n"}
            {"  "}name: <span className="text-yes">{`"Will it ship?"`}</span>, durationSecs: 86_400,
            depositUsdc: 100,
            {"\n"}
            {"}"});
          </pre>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-line px-[24px] md:px-[48px] py-[24px]">
        <div className="max-w-[1100px] mx-auto w-full flex flex-wrap items-center justify-between gap-[12px] font-mono text-[11px] text-muted tracking-[0.03em]">
          <span>pm-AMM · built for $PREDICT</span>
          <div className="flex items-center gap-[18px]">
            <Link href="/markets" className="hover:text-text-hi transition-all duration-[120ms]">
              Markets
            </Link>
            <Link href="/docs" className="hover:text-text-hi transition-all duration-[120ms]">
              Docs
            </Link>
            <a
              href="https://github.com/EwanBorgPad/pm-amm"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-text-hi transition-all duration-[120ms]"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Pillar({ tag, title, body }: { tag: string; title: string; body: string }) {
  return (
    <div className="bg-bg p-[24px] md:p-[28px] flex flex-col gap-[10px]">
      <div className="font-mono text-[10px] tracking-[0.1em] uppercase text-muted">{tag}</div>
      <div className="text-[19px] tracking-[-0.01em] text-text-hi">{title}</div>
      <p className="text-[13px] leading-[1.6] text-text-dim">{body}</p>
    </div>
  );
}
