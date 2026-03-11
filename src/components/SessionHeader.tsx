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
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold tracking-wider uppercase text-[var(--color-text)]">
            Emergence
          </h1>
          {status === "active" && (
            <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
              <span className="pulse-glow h-2 w-2 rounded-full bg-green-500" />
              Live
            </span>
          )}
          {status === "paused" && (
            <span className="text-xs text-amber-400">Paused</span>
          )}
          {status === "complete" && (
            <span className="text-xs text-[var(--color-text-muted)]">
              Session Complete
            </span>
          )}
          {viewers !== null && viewers > 0 && (
            <span className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              {viewers}
            </span>
          )}
        </div>
        <nav className="flex items-center gap-4">
          <span className="text-xs text-[var(--color-text-muted)]">
            {exchangeCount} exchanges
          </span>
          <Link
            href="/observatory"
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            Observatory
          </Link>
          <Link
            href="/about"
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            About
          </Link>
        </nav>
      </div>
    </header>
  );
}
