"use client";

import { useEffect, useState, useCallback } from "react";
import { AGENTS, type AgentRole } from "@/lib/agents";
import { renderContent } from "@/components/ExchangeBubble";
import Link from "next/link";

interface Pagination {
  page: number;
  pageSize: number;
  totalSessions: number;
  totalPages: number;
}

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
  pagination: Pagination;
}

interface AnalyticsStats {
  totalViews: number;
  todayViews: number;
  uniqueVisitors: number;
  liveViewers: number;
  viewsByPage: { path: string; count: number }[];
  dailyViews: { date: string; count: number }[];
}

interface Exchange {
  id: string;
  exchange_number: number;
  agent: AgentRole;
  content: string;
  created_at: string;
}

export default function ObservatoryPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [loadingPage, setLoadingPage] = useState(false);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [sessionExchanges, setSessionExchanges] = useState<Record<string, Exchange[]>>({});

  const fetchStats = useCallback(async (p: number) => {
    try {
      const res = await fetch(`/api/stats?page=${p}`);
      const data = await res.json();
      setStats(data);
    } catch (err) {
      console.error("Failed to fetch stats:", err);
    }
  }, []);

  useEffect(() => {
    Promise.all([
      fetchStats(1),
      fetch("/api/analytics/stats").then((r) => r.json()).then(setAnalytics),
    ])
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [fetchStats]);

  const goToPage = useCallback(async (p: number) => {
    setLoadingPage(true);
    setExpandedSession(null);
    setPage(p);
    await fetchStats(p);
    setLoadingPage(false);
  }, [fetchStats]);

  const toggleSession = useCallback(async (sessionId: string) => {
    if (expandedSession === sessionId) {
      setExpandedSession(null);
      return;
    }
    setExpandedSession(sessionId);
    if (!sessionExchanges[sessionId]) {
      try {
        const res = await fetch(`/api/exchanges?session_id=${sessionId}&after=-1`);
        const data = await res.json();
        setSessionExchanges((prev) => ({ ...prev, [sessionId]: data.exchanges }));
      } catch (err) {
        console.error("Failed to fetch exchanges:", err);
      }
    }
  }, [expandedSession, sessionExchanges]);

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

  const { pagination } = stats;

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
        {/* Session metrics */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricCard label="Sessions" value={stats.totalSessions} />
          <MetricCard label="Exchanges" value={stats.totalExchanges} />
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

        {/* Emergence Chain */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Emergence Chain
            </h2>
            {pagination.totalPages > 1 && (
              <span className="text-[10px] text-[var(--color-text-muted)]">
                Page {pagination.page} of {pagination.totalPages}
              </span>
            )}
          </div>

          <div className={`space-y-3 ${loadingPage ? "opacity-50" : ""}`}>
            {stats.recentSessions.map((s, i) => {
              const isExpanded = expandedSession === s.id;
              const exchanges = sessionExchanges[s.id];
              const sessionLabel = `Session ${pagination.totalSessions - ((pagination.page - 1) * pagination.pageSize + i)}`;

              return (
                <div key={s.id}>
                  <button
                    onClick={() => toggleSession(s.id)}
                    className={`w-full text-left flex items-start gap-4 rounded-lg border p-4 transition-colors ${
                      isExpanded
                        ? "border-[var(--color-accent)]/50 bg-[var(--color-surface-elevated)]"
                        : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-text-muted)]"
                    }`}
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
                      {i < stats.recentSessions.length - 1 && !isExpanded && (
                        <div className="mt-1 h-8 w-px bg-[var(--color-border)]" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-[var(--color-text)]">
                          {sessionLabel}
                        </span>
                        <span className="text-[10px] text-[var(--color-text-muted)]">
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
                        <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">
                          {isExpanded ? "▾" : "▸"}
                        </span>
                      </div>
                      {s.extracted_thread && (
                        <p className={`mt-1.5 text-sm text-[var(--color-text)] italic leading-relaxed ${isExpanded ? "" : "truncate"}`}>
                          &ldquo;{renderContent(s.extracted_thread)}&rdquo;
                        </p>
                      )}
                      {s.seed_thread && !s.extracted_thread && (
                        <p className={`mt-1.5 text-xs text-[var(--color-text-muted)] italic leading-relaxed ${isExpanded ? "" : "truncate"}`}>
                          Seeded: &ldquo;{renderContent(s.seed_thread)}&rdquo;
                        </p>
                      )}
                    </div>
                  </button>

                  {/* Expanded conversation */}
                  {isExpanded && (
                    <div className="ml-7 mt-2 mb-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] overflow-hidden">
                      {!exchanges ? (
                        <div className="p-6 text-center">
                          <span className="text-xs text-[var(--color-text-muted)]">
                            Loading conversation...
                          </span>
                        </div>
                      ) : exchanges.length === 0 ? (
                        <div className="p-6 text-center">
                          <span className="text-xs text-[var(--color-text-muted)]">
                            No exchanges yet.
                          </span>
                        </div>
                      ) : (
                        <div className="max-h-[70vh] overflow-y-auto">
                          {exchanges.map((ex) => {
                            const agent = AGENTS[ex.agent];
                            return (
                              <div
                                key={ex.id}
                                className="px-5 py-4 border-b border-[var(--color-border)] last:border-b-0"
                              >
                                <div className="flex items-center gap-2 mb-2">
                                  <span
                                    className="h-2 w-2 rounded-full"
                                    style={{ backgroundColor: agent.color }}
                                  />
                                  <span
                                    className="text-xs font-semibold uppercase tracking-wider"
                                    style={{ color: agent.color }}
                                  >
                                    {agent.name}
                                  </span>
                                  <span className="text-[10px] text-[var(--color-text-muted)]">
                                    Exchange #{ex.exchange_number + 1}
                                  </span>
                                </div>
                                <div className="text-sm leading-relaxed text-[var(--color-text)] pl-4">
                                  {renderContent(ex.content)}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 mt-6">
              <button
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1 || loadingPage}
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ← Newer
              </button>
              <span className="text-[10px] text-[var(--color-text-muted)]">
                {pagination.page} / {pagination.totalPages}
              </span>
              <button
                onClick={() => goToPage(page + 1)}
                disabled={page >= pagination.totalPages || loadingPage}
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Older →
              </button>
            </div>
          )}
        </section>

        {/* Audience analytics */}
        {analytics && (
          <section>
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Audience
            </h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <MetricCard
                label="Watching Now"
                value={analytics.liveViewers}
                isLive={analytics.liveViewers > 0}
              />
              <MetricCard label="Views Today" value={analytics.todayViews} />
              <MetricCard label="Total Views" value={analytics.totalViews} />
              <MetricCard label="Unique Visitors" value={analytics.uniqueVisitors} />
            </div>
          </section>
        )}
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
