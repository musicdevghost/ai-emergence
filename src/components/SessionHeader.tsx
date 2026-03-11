"use client";

interface SessionHeaderProps {
  status: string;
  exchangeCount: number;
  sessionNumber?: number;
}

export function SessionHeader({
  status,
  exchangeCount,
}: SessionHeaderProps) {
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
        </div>
        <span className="text-xs text-[var(--color-text-muted)]">
          {exchangeCount} exchanges
        </span>
      </div>
    </header>
  );
}
