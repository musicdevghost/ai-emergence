"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ExportInfo {
  url: string;
  size: number;
  uploadedAt: string;
}

export default function DataPage() {
  const [exportInfo, setExportInfo] = useState<ExportInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/export/latest")
      .then((res) => {
        if (!res.ok) throw new Error("Not found");
        return res.json();
      })
      .then(setExportInfo)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <header className="border-b border-[var(--color-border)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <h1 className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--color-text)]">
            Data Export
          </h1>
          <Link
            href="/observatory"
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            Back to Observatory
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12 space-y-8">
        <section className="space-y-4">
          <h2 className="text-lg font-light text-[var(--color-text)]">
            Full Experiment Data
          </h2>
          <p className="text-sm leading-relaxed text-[var(--color-text-muted)]">
            Download the complete Emergence dataset — every session, every exchange,
            every iteration. All data is exported as a single JSON file and updated
            daily.
          </p>
          <p className="text-sm leading-relaxed text-[var(--color-text-muted)]">
            The export includes all sessions with their seed threads, extracted threads,
            key moments, iteration assignments, and the full text of every exchange
            between the four agents.
          </p>
        </section>

        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-4">
          {loading ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              Checking for latest export...
            </p>
          ) : error || !exportInfo ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              No export available yet. Check back soon.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-4 flex-wrap">
                <a
                  href={exportInfo.url}
                  download
                  className="inline-flex items-center gap-2 rounded border border-[var(--color-accent)] px-5 py-2.5 text-sm text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors"
                >
                  <span>Download JSON</span>
                  <span className="text-[10px] text-[var(--color-text-muted)]">
                    {formatSize(exportInfo.size)}
                  </span>
                </a>
              </div>
              <p className="text-[10px] text-[var(--color-text-muted)]">
                Last updated: {new Date(exportInfo.uploadedAt).toLocaleString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZoneName: "short",
                })}
              </p>
            </>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Data Structure
          </h2>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-4 font-mono text-xs text-[var(--color-text-muted)] leading-relaxed overflow-x-auto">
            <pre>{`{
  "meta": {
    "exportedAt": "ISO timestamp",
    "totalSessions": number,
    "totalExchanges": number,
    "totalIterations": number
  },
  "iterations": [{
    "number", "name", "tagline", "description",
    "notable_moments", "conclusion",
    "started_at", "ended_at"
  }],
  "sessions": [{
    "id", "status", "seed_thread", "extracted_thread",
    "key_moments", "exchange_count", "iteration_id",
    "created_at", "completed_at"
  }],
  "exchanges": [{
    "id", "session_id", "exchange_number",
    "agent", "model", "content", "created_at"
  }]
}`}</pre>
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">
            License: MIT — open for research and exploration.
          </p>
        </section>
      </main>
    </div>
  );
}
