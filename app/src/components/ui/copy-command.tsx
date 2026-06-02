"use client";

import { useState } from "react";

/**
 * A copyable shell-command chip: shows `$ <command>` with a copy icon that
 * flips to a check on click. Client component (uses the clipboard API).
 */
export function CopyCommand({ command, className }: { command: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (insecure context / permissions) — no-op.
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy: ${command}`}
      title="Copy to clipboard"
      className={[
        "group inline-flex items-center gap-[10px] font-mono text-[12px] text-muted",
        "bg-surface border border-line rounded-md px-[12px] py-[10px]",
        "hover:border-line-2 hover:text-text-hi transition-all duration-[120ms] cursor-pointer",
        className ?? "",
      ].join(" ")}
    >
      <span>
        <span className="text-text-dim select-none">$ </span>
        {command}
      </span>
      {copied ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-[13px] h-[13px] text-yes shrink-0"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-[13px] h-[13px] opacity-60 group-hover:opacity-100 shrink-0"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}
