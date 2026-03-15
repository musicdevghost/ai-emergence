"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface SessionHeaderProps {
  status: string;
  exchangeCount: number;
  sessionNumber?: number;
}

export function SessionHeader({
  status,
  exchangeCount,
}: SessionHeaderProps) {
  const [viewers, setViewers] = useState<number | null>(null);

  useEffect(() => {
    const fetchViewers = () => {
      fetch("/api/analytics/live")
        .then((r) => r.json())
        .then((d) => setViewers(d.viewers))
        .catch(() => {});
    };
    fetchViewers();
    const interval = setInterval(fetchViewers, 15000);
    return () => clearInterval(interval);
  }, []);

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
            {viewers !== null && viewers > 0 && (
              <span className="flex items-center gap-1 text-[10px] sm:text-xs text-[var(--color-text-muted)]">
                <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                {viewers}
              </span>
            )}
            <span className="text-[10px] sm:text-xs text-[var(--color-text-muted)]">
              {exchangeCount}<span className="hidden sm:inline"> exchanges</span>
            </span>
            <span className="text-[var(--color-border)]">|</span>
            <Link
              href="/observatory"
              className="text-[10px] sm:text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              <span className="sm:hidden">Stats</span>
              <span className="hidden sm:inline">Observatory</span>
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
