"use client";

import Link from "next/link";

interface SessionHeaderProps {
  status: string;
  exchangeCount: number;
}

export function SessionHeader({
  status,
  exchangeCount,
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

          {/* Right: stats + nav */}
          <div className="flex items-center gap-3 sm:gap-4">
            <span className="text-[10px] sm:text-xs text-[var(--color-text-muted)]">
              {exchangeCount}<span className="hidden sm:inline"> exchanges</span>
            </span>
            <span className="text-[var(--color-border)]">|</span>
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
