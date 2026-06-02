import Link from "next/link";
import { Wordmark } from "@/components/ui/wordmark";

/** Lightweight header for the marketing landing — no wallet, no data hooks. */
export function LandingNav() {
  return (
    <header className="flex items-center justify-between px-[24px] md:px-[48px] py-[16px] border-b border-line">
      <Link href="/" className="shrink-0">
        <Wordmark size={18} tone="light" />
      </Link>
      <nav className="flex items-center gap-[18px] md:gap-[24px] font-mono text-[12px] text-muted tracking-[0.03em]">
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
          className="hidden sm:inline hover:text-text-hi transition-all duration-[120ms]"
        >
          GitHub
        </a>
        <Link
          href="/markets"
          className="px-[12px] py-[6px] bg-text-hi text-bg rounded-sm font-medium hover:opacity-90 transition-all duration-[120ms]"
        >
          Launch app →
        </Link>
      </nav>
    </header>
  );
}
