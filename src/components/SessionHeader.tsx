"use client";

import Link from "next/link";

interface SessionHeaderProps {
  status: string;
  iteration?: { number: number; name: string } | null;
}

export function SessionHeader({
  status,
  iteration,
}: SessionHeaderProps) {

  return (
    <header className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 backdrop-blur-md">
      <div className="mx-auto max-w-2xl px-4 py-2.5">
        <div className="flex items-center justify-between">
          {/* Left: title + status */}
          <div className="flex items-center gap-2">
            <Link href="/" className="text-sm font-semibold tracking-wider uppercase text-[var(--color-text)]">
              Emergence
            </Link>
            {iteration && (
              <span className="text-[10px] sm:text-xs text-[var(--color-text-muted)]">
                <span className="hidden sm:inline">Iteration {toRoman(iteration.number)} — </span>{iteration.name}
              </span>
            )}
            {status === "active" && (
              <span className="flex items-center gap-1 text-[10px] sm:text-xs text-[var(--color-text-muted)]">
                <span className="pulse-glow h-1.5 w-1.5 rounded-full bg-green-500" />
                <span className="hidden sm:inline">Live</span>
              </span>
            )}
            {status === "paused" && (
              <span className="text-[10px] sm:text-xs text-amber-400">Paused</span>
            )}
            {status === "complete" && (
              <span className="text-[10px] sm:text-xs text-[var(--color-text-muted)]">
                Complete
              </span>
            )}
          </div>

          {/* Right: nav */}
          <div className="flex items-center gap-3 sm:gap-4">
            <Link
              href="/observatory"
              className="text-[10px] sm:text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              Observatory
            </Link>
            <Link
              href="/about"
              className="text-[10px] sm:text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              About
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
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
