"use client";

import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_LIST } from "@/lib/tokens";
import { useTokenInfo } from "@/hooks/use-token-info";

function isValidMint(s: string): boolean {
  if (s.length < 32) return false;
  try {
    // Constructs as an expression (not a bare `new`) so it parses + validates.
    return new PublicKey(s).toBase58().length > 0;
  } catch {
    return false;
  }
}

/**
 * Collateral-token selector: a row of popular tokens (logo + symbol) plus a
 * "Custom" option to paste ANY SPL mint address (resolved on-chain via
 * `useTokenInfo`). Controlled: `value` is the selected mint (base58), `onChange`
 * fires with the chosen mint.
 */
export function TokenPicker({
  value,
  onChange,
  label = "COLLATERAL TOKEN",
}: {
  value: string;
  onChange: (mint: string) => void;
  label?: string;
}) {
  const selectedKnown = TOKEN_LIST.some((t) => t.mint === value);
  const [showCustom, setShowCustom] = useState(!selectedKnown && !!value);
  const [addr, setAddr] = useState(!selectedKnown ? value : "");
  const valid = isValidMint(addr);
  const preview = useTokenInfo(valid ? addr : undefined);

  return (
    <div>
      <div className="text-caption mb-[8px]">{label}</div>
      <div className="flex flex-wrap gap-[6px]">
        {TOKEN_LIST.map((t) => (
          <button
            key={t.mint}
            type="button"
            onClick={() => {
              onChange(t.mint);
              setShowCustom(false);
            }}
            className={`flex items-center gap-[6px] px-[10px] py-[6px] rounded-sm text-[12px] font-mono border cursor-pointer transition-all duration-[120ms] ${value === t.mint ? "text-text-hi border-line-2 bg-surface" : "text-muted border-line hover:text-text-hi"}`}
          >
            {t.logoURI && (
              <img
                src={t.logoURI}
                alt=""
                width={16}
                height={16}
                className="rounded-full"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            )}
            {t.symbol}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowCustom((v) => !v)}
          className={`px-[10px] py-[6px] rounded-sm text-[12px] font-mono border cursor-pointer transition-all duration-[120ms] ${showCustom ? "text-text-hi border-line-2 bg-surface" : "text-muted border-line hover:text-text-hi"}`}
        >
          + Custom
        </button>
      </div>

      {showCustom && (
        <div className="mt-[8px]">
          <div className="border border-line-2 rounded-lg px-[12px] bg-bg focus-within:border-muted">
            <input
              className="bg-transparent border-none outline-none text-text-hi font-mono text-[13px] py-[10px] w-full"
              placeholder="Paste any SPL mint address…"
              value={addr}
              onChange={(e) => setAddr(e.target.value.trim())}
            />
          </div>
          {addr.length > 0 && !valid && (
            <p className="text-[10px] text-no font-mono mt-[4px]">Invalid mint address.</p>
          )}
          {valid && preview.isLoading && (
            <p className="text-[10px] text-muted font-mono mt-[4px]">Resolving…</p>
          )}
          {valid && preview.isError && (
            <p className="text-[10px] text-no font-mono mt-[4px]">
              Mint not found on this cluster.
            </p>
          )}
          {valid && preview.data && (
            <button
              type="button"
              onClick={() => onChange(addr)}
              className={`mt-[6px] text-[11px] font-mono cursor-pointer transition-all duration-[120ms] ${value === addr ? "text-yes" : "text-muted hover:text-text-hi"}`}
            >
              {value === addr ? "✓ " : "Use "}
              {preview.data.symbol} · {preview.data.decimals} decimals
            </button>
          )}
        </div>
      )}
    </div>
  );
}
