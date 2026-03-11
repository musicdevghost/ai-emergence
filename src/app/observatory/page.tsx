"use client";

import { useEffect, useState } from "react";
import { AGENTS, type AgentRole } from "@/lib/agents";
import Link from "next/link";

interface Stats {
  totalSessions: number;
  totalExchanges: number;
  agentStats: { agent: AgentRole; count: number }[];
  recentSessions: {
    id: string;
    created_at: string;
    completed_at: string | null;
    status: string;
    seed_thread: string | null;
    extracted_thread: string | null;
    exchange_count: number;
  }[];
  activeSession: { id: string; exchange_count: number; status: string } | null;
}

interface AnalyticsStats {
  totalViews: number;
  todayViews: number;
  uniqueVisitors: number;
  liveViewers: number;
  viewsByPage: { path: string; count: number }[];
  dailyViews: { date: string; count: number }[];
}

export default function ObservatoryPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/stats").then((r) => r.json()),
      fetch("/api/analytics/stats").then((r) => r.json()),
    ])
      .then(([s, a]) => {
        setStats(s);
        setAnalytics(a);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-[var(--color-text-muted)]">
          Loading observatory...
        </span>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-[var(--color-text-muted)]">
          Could not load data.
        </span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      {/* Header */}
      <header className="border-b border-[var(--color-border)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--color-text)]">
              Observatory
            </h1>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              Emergence Research Dashboard
            </p>
          </div>
          <Link
            href="/"
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            Back to Theatre
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8 space-y-8">
        {/* Audience metrics */}
        {analytics && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <MetricCard
              label="Watching Now"
              value={analytics.liveViewers}
              isLive={analytics.liveViewers > 0}
            />
            <MetricCard
              label="Views Today"
              value={analytics.todayViews}
            />
            <MetricCard
              label="Total Views"
              value={analytics.totalViews}
            />
            <MetricCard
              label="Unique Visitors"
              value={analytics.uniqueVisitors}
            />
          </div>
        )}

        {/* Session metrics */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricCard
            label="Sessions"
            value={stats.totalSessions}
          />
          <MetricCard
            label="Exchanges"
            value={stats.totalExchanges}
          />
          <MetricCard
            label="Status"
            value={stats.activeSession ? "Live" : "Between Sessions"}
            isLive={!!stats.activeSession}
          />
          <MetricCard
            label="Current Exchange"
            value={stats.activeSession?.exchange_count ?? "—"}
          />
        </div>

        {/* Agent breakdown */}
        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Agent Participation
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.agentStats.map((stat) => {
              const agent = AGENTS[stat.agent];
              return (
                <div
                  key={stat.agent}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
                >
                  <span
                    className="text-xs font-semibold uppercase tracking-wider"
                    style={{ color: agent.color }}
                  >
                    {agent.name}
                  </span>
                  <p className="mt-1 text-2xl font-light text-[var(--color-text)]">
                    {stat.count}
                  </p>
                  <p className="text-[10px] text-[var(--color-text-muted)]">
                    exchanges
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Session chain */}
        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Emergence Chain
          </h2>
          <div className="space-y-3">
            {stats.recentSessions.map((s, i) => (
              <div
                key={s.id}
                className="flex items-start gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
              >
                {/* Chain connector */}
                <div className="flex flex-col items-center pt-1">
                  <div
                    className={`h-3 w-3 rounded-full border-2 ${
                      s.status === "active"
                        ? "border-green-500 bg-green-500/20 pulse-glow"
                        : s.status === "complete"
                          ? "border-[var(--color-accent)] bg-[var(--color-accent)]/20"
                          : "border-amber-500 bg-amber-500/20"
                    }`}
                  />
                  {i < stats.recentSessions.length - 1 && (
                    <div className="mt-1 h-8 w-px bg-[var(--color-border)]" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {new Date(s.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span
                      className={`text-[10px] uppercase tracking-wider ${
                        s.status === "active"
                          ? "text-green-400"
                          : s.status === "complete"
                            ? "text-[var(--color-text-muted)]"
                            : "text-amber-400"
                      }`}
                    >
                      {s.status}
                    </span>
                    <span className="text-[10px] text-[var(--color-text-muted)]">
                      {s.exchange_count} exchanges
                    </span>
                  </div>
                  {s.extracted_thread && (
                    <p className="mt-1.5 text-sm text-[var(--color-text)] italic truncate">
                      &ldquo;{s.extracted_thread}&rdquo;
                    </p>
                  )}
                  {s.seed_thread && !s.extracted_thread && (
                    <p className="mt-1.5 text-xs text-[var(--color-text-muted)] italic truncate">
                      Seeded: &ldquo;{s.seed_thread}&rdquo;
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function MetricCard({
  label,
  value,
  isLive,
}: {
  label: string;
  value: string | number;
  isLive?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
        {label}
      </p>
      <p className="mt-1 flex items-center gap-2 text-xl font-light text-[var(--color-text)]">
        {isLive && (
          <span className="pulse-glow h-2 w-2 rounded-full bg-green-500" />
        )}
        {value}
      </p>
    </div>
  );
}
