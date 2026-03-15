"use client";

import { useState } from "react";
import Link from "next/link";

interface SessionHeaderProps {
  status: string;
  exchangeCount: number;
  iteration?: { number: number; name: string } | null;
}

export function SessionHeader({
  status,
  exchangeCount,
  iteration,
}: SessionHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 backdrop-blur-md">
      <div className="mx-auto max-w-2xl px-4 py-3 sm:py-4">
        {/* Desktop: two rows */}
        <div className="hidden sm:flex sm:flex-col sm:gap-1.5">
          {/* Row 1: Title left, Nav right */}
          <div className="flex items-center justify-between">
            <Link href="/" className="text-lg font-semibold tracking-wider uppercase text-[var(--color-text)]">
              Emergence
            </Link>
            <div className="flex items-center gap-5">
              <Link
                href="/observatory"
                className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
              >
                Observatory
              </Link>
              <Link
                href="/about"
                className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
              >
                About
              </Link>
            </div>
          </div>
          {/* Row 2: Iteration + status + exchange count */}
          <div className="flex items-center gap-3">
            {iteration && (
              <span className="text-sm text-[var(--color-text-muted)]">
                Iteration {toRoman(iteration.number)} — {iteration.name}
              </span>
            )}
            <StatusBadge status={status} />
            <span className="text-sm text-[var(--color-text-muted)]">
              Exchange #{exchangeCount}
            </span>
          </div>
        </div>

        {/* Mobile: compact single row */}
        <div className="flex sm:hidden items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Link href="/" className="text-base font-semibold tracking-wider uppercase text-[var(--color-text)] shrink-0">
              Emergence
            </Link>
            <StatusBadge status={status} />
            <span className="text-xs text-[var(--color-text-muted)] shrink-0">
              #{exchangeCount}
            </span>
          </div>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            aria-label="Menu"
          >
            {menuOpen ? (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>

        {/* Mobile menu dropdown */}
        {menuOpen && (
          <div className="sm:hidden mt-3 pt-3 border-t border-[var(--color-border)] space-y-2">
            {iteration && (
              <p className="text-xs text-[var(--color-text-muted)]">
                Iteration {toRoman(iteration.number)} — {iteration.name}
              </p>
            )}
            <div className="flex items-center gap-4">
              <Link
                href="/observatory"
                className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                onClick={() => setMenuOpen(false)}
              >
                Observatory
              </Link>
              <Link
                href="/about"
                className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                onClick={() => setMenuOpen(false)}
              >
                About
              </Link>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "active") {
    return (
      <span className="flex items-center gap-1.5 rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[10px] sm:text-xs text-green-400">
        <span className="pulse-glow h-1.5 w-1.5 rounded-full bg-green-500" />
        Live
      </span>
    );
  }
  if (status === "paused") {
    return (
      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] sm:text-xs text-amber-400">
        Paused
      </span>
    );
  }
  if (status === "complete") {
    return (
      <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-[10px] sm:text-xs text-[var(--color-text-muted)]">
        Complete
      </span>
    );
  }
  return null;
}

function toRoman(num: number): string {
  const numerals: [number, string][] = [
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let result = "";
  for (const [value, symbol] of numerals) {
    while (num >= value) {
      result += symbol;
      num -= value;
    }
  }
  return result;
}
