"use client";

import { useState, type ReactNode } from "react";

/**
 * Syntax-highlighted, copyable code block. Lightweight regex tokenizer (no
 * external highlighter) covering TS/JS + shell: comments, strings, numbers,
 * keywords, and Capitalized type names — colored from the theme palette.
 */

const KEYWORDS = new Set([
  "import",
  "export",
  "from",
  "const",
  "let",
  "var",
  "await",
  "async",
  "function",
  "return",
  "new",
  "interface",
  "type",
  "if",
  "else",
  "for",
  "of",
  "in",
  "as",
  "void",
  "true",
  "false",
  "null",
  "undefined",
]);

// Order matters: comment, then string, then number, then identifier.
const TOKEN =
  /(\/\/[^\n]*)|(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b\d[\d_]*\b)|([A-Za-z_$][\w$]*)/g;

function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(code)) !== null) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const [full, comment, str, num, word] = m;
    if (comment) {
      out.push(
        <span key={k++} className="text-muted italic">
          {full}
        </span>,
      );
    } else if (str) {
      out.push(
        <span key={k++} className="text-yes">
          {full}
        </span>,
      );
    } else if (num) {
      out.push(
        <span key={k++} className="text-no">
          {full}
        </span>,
      );
    } else if (word) {
      if (KEYWORDS.has(word)) {
        out.push(
          <span key={k++} className="text-accent">
            {full}
          </span>,
        );
      } else if (/^[A-Z]/.test(word)) {
        out.push(
          <span key={k++} style={{ color: "oklch(0.74 0.09 235)" }}>
            {full}
          </span>,
        );
      } else {
        out.push(full);
      }
    }
    last = TOKEN.lastIndex;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

export function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — no-op
    }
  };

  return (
    <div className="relative group">
      <pre className="bg-surface border border-line rounded-lg p-[18px] pr-[44px] overflow-x-auto font-mono text-[12.5px] leading-[1.65] text-text whitespace-pre">
        <code>{highlight(code)}</code>
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy code"
        title="Copy to clipboard"
        className="absolute top-[10px] right-[10px] p-[6px] rounded-md border border-line bg-bg/70 text-muted hover:text-text-hi hover:border-line-2 transition-all duration-[120ms] cursor-pointer"
      >
        {copied ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-[13px] h-[13px] text-yes"
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
            className="w-[13px] h-[13px]"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
    </div>
  );
}
