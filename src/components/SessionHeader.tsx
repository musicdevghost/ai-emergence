"use client";

import Link from "next/link";

interface SessionHeaderProps {
  status: string;
  iteration?: { number: number; name: string } | null;
  stats?: { totalExchanges: number; iterationCount: number } | null;
}

export function SessionHeader({ status, iteration, stats }: SessionHeaderProps) {
  return (
    <header className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 backdrop-blur-md">
      <div className="mx-auto max-w-2xl px-4 py-3">
        {/* Row 1: Title + Nav */}
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="text-base sm:text-lg font-semibold tracking-wider uppercase text-[var(--color-text)]"
          >
            Emergence
          </Link>
          <div className="flex items-center gap-4 sm:gap-5 sm:mt-7">
            <Link
              href="/observatory"
              className="text-[10px] uppercase tracking-widest text-white/50 hover:text-white/90 transition-colors"
            >
              Observatory
            </Link>
            <Link
              href="/about"
              className="text-[10px] uppercase tracking-widest text-white/50 hover:text-white/90 transition-colors"
            >
              About
            </Link>
          </div>
        </div>

        {/* Row 2: Iteration + status */}
        <div className="flex items-center gap-2 mt-4 sm:mt-1">
          {iteration && (
            <span className="text-xs sm:text-sm text-[var(--color-text-muted)]">
              Iteration {toRoman(iteration.number)} — {iteration.name}
            </span>
          )}
          <StatusBadge status={status} />
        </div>

        {/* Row 3: Stats — always visible */}
        {stats && (
          <p className="text-[10px] text-[var(--color-text-muted)] mt-1.5 sm:mt-0.5">
            {stats.totalExchanges.toLocaleString()} exchanges across {stats.iterationCount} iterations —{" "}
            <Link
              href="/observatory"
              className="underline underline-offset-2 hover:text-[var(--color-accent)] transition-colors"
            >
              read the full record
            </Link>
          </p>
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
        Resting
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
