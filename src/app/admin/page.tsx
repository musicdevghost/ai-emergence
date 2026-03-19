"use client";

import { useEffect, useState, useCallback } from "react";
import { AGENTS, type AgentRole } from "@/lib/agents";
import { AXON_AGENTS, type AxonRole } from "@/lib/axon-agents";
import { stripMarkdown } from "@/lib/markdown";

interface Session {
  id: string;
  created_at: string;
  completed_at: string | null;
  status: string;
  seed_thread: string | null;
  extracted_thread: string | null;
  exchange_count: number;
  is_baseline: boolean;
  iteration_id: number | null;
  key_moments: string[] | null;
}

interface Exchange {
  id: string;
  exchange_number: number;
  agent: AgentRole;
  model: string;
  content: string;
  created_at: string;
}

interface AxonRequest {
  id: string;
  created_at: string;
  completed_at: string | null;
  status: string;
  input_text: string;
  output_decision: string | null;
  output_content: string | null;
  confidence_level: string | null;
  exchange_count: number;
  request_token: string | null;
}

interface AxonExchange {
  id: string;
  exchange_number: number;
  agent: AxonRole;
  model: string;
  content: string;
  skipped: boolean;
  created_at: string;
}

interface AxonStats {
  total: number;
  exec_count: number;
  pass_count: number;
  active_count: number;
  avg_exchanges: string;
}

interface Iteration {
  id: number;
  number: number;
  name: string;
  tagline: string;
  description: string;
  notable_moments: string[] | null;
  conclusion: string;
  started_at: string;
  ended_at: string | null;
}

interface PageViewStat {
  path: string;
  count: string;
}

interface DailyViewStat {
  date: string;
  count: string;
}

interface AnalyticsStats {
  totalViews: number;
  uniqueVisitors: number;
  liveViewers: number;
  viewsByPage: PageViewStat[];
  dailyViews: DailyViewStat[];
  totalSessions: number;
  totalExchanges: number;
}

type AnalyticsRange = "1d" | "7d" | "30d" | "all";

const RANGE_LABELS: Record<AnalyticsRange, string> = {
  "1d": "Today",
  "7d": "7 Days",
  "30d": "30 Days",
  all: "All Time",
};

export default function AdminPage() {
  const [secret, setSecret] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [annotationNote, setAnnotationNote] = useState("");
  const [analytics, setAnalytics] = useState<AnalyticsStats | null>(null);
  const [analyticsRange, setAnalyticsRange] = useState<AnalyticsRange>("7d");
  const [iterations, setIterations] = useState<Iteration[]>([]);
  const [showNewIteration, setShowNewIteration] = useState(false);
  const [newIteration, setNewIteration] = useState({ name: "", tagline: "", description: "" });
  const [publishing, setPublishing] = useState(false);

  // AXON state
  const [axonRequests, setAxonRequests] = useState<AxonRequest[]>([]);
  const [axonStats, setAxonStats] = useState<AxonStats | null>(null);
  const [selectedAxonRequest, setSelectedAxonRequest] = useState<string | null>(null);
  const [axonExchanges, setAxonExchanges] = useState<AxonExchange[]>([]);
  const [axonDetail, setAxonDetail] = useState<AxonRequest | null>(null);
  const [showAxon, setShowAxon] = useState(false);

  const fetchAnalytics = useCallback(async (range: AnalyticsRange) => {
    try {
      const res = await fetch(`/api/analytics/stats?range=${range}`);
      if (res.ok) setAnalytics(await res.json());
    } catch { /* ignore */ }
  }, []);

  const fetchAxonRequests = useCallback(async () => {
    const res = await fetch(`/api/admin/axon/requests?secret=${secret}`);
    if (res.ok) {
      const data = await res.json();
      setAxonRequests(data.requests);
      setAxonStats(data.stats);
    }
  }, [secret]);

  const fetchAxonDetail = useCallback(async (requestId: string) => {
    setSelectedAxonRequest(requestId);
    setAxonExchanges([]);
    setAxonDetail(null);
    const res = await fetch(`/api/admin/axon/detail?secret=${secret}&request_id=${requestId}`);
    if (res.ok) {
      const data = await res.json();
      setAxonExchanges(data.exchanges);
      setAxonDetail(data.request);
    }
  }, [secret]);

  const fetchIterations = useCallback(async () => {
    const res = await fetch(`/api/admin/iterations?secret=${secret}`);
    if (res.ok) {
      const data = await res.json();
      setIterations(data.iterations);
    }
  }, [secret]);

  const fetchSessions = useCallback(async () => {
    const res = await fetch(`/api/admin/sessions?secret=${secret}`);
    if (res.ok) {
      const data = await res.json();
      setSessions(data.sessions);
      setAuthenticated(true);
      fetchIterations();
      fetchAnalytics(analyticsRange);
      fetchAxonRequests();
    } else {
      alert("Invalid admin secret");
    }
  }, [secret, fetchIterations, fetchAnalytics, analyticsRange, fetchAxonRequests]);

  const fetchExchanges = useCallback(
    async (sessionId: string) => {
      setSelectedSession(sessionId);
      const res = await fetch(
        `/api/exchanges?session_id=${sessionId}&after=-1`
      );
      const data = await res.json();
      setExchanges(data.exchanges);
    },
    []
  );

  async function handleSessionAction(sessionId: string, action: string) {
    await fetch(`/api/admin/sessions`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-admin-secret": secret,
      },
      body: JSON.stringify({ sessionId, action }),
    });
    fetchSessions();
  }

  async function addAnnotation(exchangeId: string) {
    if (!annotationNote.trim()) return;
    await fetch(`/api/admin/annotations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-secret": secret,
      },
      body: JSON.stringify({
        exchangeId,
        sessionId: selectedSession,
        note: annotationNote,
      }),
    });
    setAnnotationNote("");
  }

  async function createIteration() {
    if (!newIteration.name || !newIteration.tagline || !newIteration.description) return;
    await fetch(`/api/admin/iterations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-secret": secret,
      },
      body: JSON.stringify(newIteration),
    });
    setNewIteration({ name: "", tagline: "", description: "" });
    setShowNewIteration(false);
    fetchIterations();
    fetchSessions();
  }

  async function endIteration(id: number) {
    if (!confirm("End this iteration? This will close it and new sessions will not be assigned to any iteration until a new one is created.")) return;
    await fetch(`/api/admin/iterations`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-admin-secret": secret,
      },
      body: JSON.stringify({ id, ended_at: new Date().toISOString() }),
    });
    fetchIterations();
  }

  async function publishExport() {
    setPublishing(true);
    try {
      const res = await fetch(`/api/admin/export/publish`, {
        method: "POST",
        headers: { "x-admin-secret": secret },
      });
      const data = await res.json();
      if (res.ok) {
        alert(`Export published (${data.sessions} sessions, ${data.exchanges} exchanges)\n\n${data.url}`);
      } else {
        alert(`Publish failed: ${data.error}\n\n${data.detail || ""}`);
      }
    } catch (err) {
      alert("Publish failed");
    } finally {
      setPublishing(false);
    }
  }

  async function exportSession(sessionId?: string) {
    const url = sessionId
      ? `/api/admin/export?secret=${secret}&session_id=${sessionId}`
      : `/api/admin/export?secret=${secret}`;
    const res = await fetch(url);
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = sessionId
      ? `emergence-session-${sessionId.slice(0, 8)}.json`
      : "emergence-export-all.json";
    a.click();
  }

  // Login screen
  if (!authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            fetchSessions();
          }}
          className="flex gap-2"
        >
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Admin secret"
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
          />
          <button
            type="submit"
            className="rounded border border-[var(--color-border)] px-6 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            Enter
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <header className="border-b border-[var(--color-border)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <h1 className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--color-text)]">
            Admin Panel
          </h1>
          <div className="flex gap-3">
            <button
              onClick={publishExport}
              disabled={publishing}
              className="text-xs text-[var(--color-accent)] hover:underline transition-colors disabled:opacity-50"
            >
              {publishing ? "Publishing..." : "Publish Export"}
            </button>
            <button
              onClick={() => exportSession()}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
            >
              Export All (JSON)
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6 space-y-6">
        {/* Analytics */}
        {analytics && (
          <div className="space-y-4">
            {/* Range selector */}
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                Analytics
              </h2>
              <div className="flex gap-1">
                {(Object.keys(RANGE_LABELS) as AnalyticsRange[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => { setAnalyticsRange(r); fetchAnalytics(r); }}
                    className={`px-3 py-1 text-[10px] rounded-full border transition-colors ${
                      analyticsRange === r
                        ? "border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent)]/10"
                        : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    {RANGE_LABELS[r]}
                  </button>
                ))}
              </div>
            </div>

            {/* Row 1: Key metrics */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <MetricCard label="Watching Now" value={analytics.liveViewers} live={analytics.liveViewers > 0} />
              <MetricCard label="Views" value={analytics.totalViews} />
              <MetricCard label="Unique Visitors" value={analytics.uniqueVisitors} />
              <MetricCard label="Sessions" value={analytics.totalSessions} />
              <MetricCard label="Exchanges" value={analytics.totalExchanges} />
            </div>

            {/* Row 2: Daily views chart */}
            {analytics.dailyViews.length > 0 && (
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-3">
                  Daily Views
                </p>
                <DailyViewsChart data={analytics.dailyViews} />
              </div>
            )}

            {/* Row 3: Top pages + experiment stats */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Top Pages */}
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-3">
                  Top Pages
                </p>
                <div className="space-y-2">
                  {analytics.viewsByPage.map((p) => {
                    const count = parseInt(p.count);
                    const maxCount = parseInt(analytics.viewsByPage[0]?.count || "1");
                    return (
                      <div key={p.path} className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-[var(--color-text)] truncate">{p.path}</span>
                            <span className="text-[10px] text-[var(--color-text-muted)] ml-2 shrink-0">{count}</span>
                          </div>
                          <div className="h-1 rounded-full bg-[var(--color-bg)]">
                            <div
                              className="h-1 rounded-full bg-[var(--color-accent)]"
                              style={{ width: `${(count / maxCount) * 100}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Experiment Stats */}
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-3">
                  Experiment Stats
                </p>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--color-text-muted)]">Avg Exchanges / Session</span>
                    <span className="text-sm font-light text-[var(--color-text)]">
                      {analytics.totalSessions > 0
                        ? (analytics.totalExchanges / analytics.totalSessions).toFixed(1)
                        : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--color-text-muted)]">Avg Views / Day</span>
                    <span className="text-sm font-light text-[var(--color-text)]">
                      {analytics.dailyViews.length > 0
                        ? (analytics.dailyViews.reduce((sum, d) => sum + parseInt(d.count), 0) / analytics.dailyViews.length).toFixed(1)
                        : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--color-text-muted)]">Views / Session</span>
                    <span className="text-sm font-light text-[var(--color-text)]">
                      {analytics.totalSessions > 0
                        ? (analytics.totalViews / analytics.totalSessions).toFixed(1)
                        : "—"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Iterations */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Iterations
            </h2>
            <button
              onClick={() => setShowNewIteration(!showNewIteration)}
              className="text-[10px] text-[var(--color-accent)] hover:underline"
            >
              {showNewIteration ? "Cancel" : "+ New Iteration"}
            </button>
          </div>

          {showNewIteration && (
            <div className="rounded-lg border border-[var(--color-accent)]/30 bg-[var(--color-surface)] p-4 space-y-3">
              <p className="text-[10px] text-amber-400">
                Creating a new iteration will automatically end the current active one.
              </p>
              <input
                type="text"
                placeholder="Name (e.g. The Remembering)"
                value={newIteration.name}
                onChange={(e) => setNewIteration({ ...newIteration, name: e.target.value })}
                className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
              />
              <input
                type="text"
                placeholder="Tagline"
                value={newIteration.tagline}
                onChange={(e) => setNewIteration({ ...newIteration, tagline: e.target.value })}
                className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
              />
              <textarea
                placeholder="Description"
                value={newIteration.description}
                onChange={(e) => setNewIteration({ ...newIteration, description: e.target.value })}
                rows={3}
                className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)] resize-none"
              />
              <button
                onClick={createIteration}
                className="rounded border border-[var(--color-accent)] px-4 py-1.5 text-xs text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors"
              >
                Create Iteration
              </button>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {iterations.map((iter) => (
              <div
                key={iter.id}
                className={`rounded-lg border p-4 ${
                  iter.ended_at
                    ? "border-[var(--color-border)] bg-[var(--color-surface)]"
                    : "border-green-500/30 bg-green-500/5"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-[var(--color-text)]">
                    {toRoman(iter.number)}. {iter.name}
                  </span>
                  {iter.ended_at ? (
                    <span className="text-[10px] text-[var(--color-text-muted)]">Ended</span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] text-green-400">
                      <span className="pulse-glow h-1.5 w-1.5 rounded-full bg-green-500" />
                      Active
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-[var(--color-text-muted)] italic">{iter.tagline}</p>
                <p className="mt-2 text-[10px] text-[var(--color-text-muted)]">
                  {new Date(iter.started_at).toLocaleDateString()}
                  {iter.ended_at && ` — ${new Date(iter.ended_at).toLocaleDateString()}`}
                </p>
                {!iter.ended_at && (
                  <button
                    onClick={() => endIteration(iter.id)}
                    className="mt-2 text-[10px] text-red-400 hover:underline"
                  >
                    End Iteration
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Sessions list */}
          <div className="lg:col-span-1 space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-3">
              Sessions ({sessions.length})
            </h2>
            <div className="space-y-2 max-h-[80vh] overflow-y-auto">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => fetchExchanges(s.id)}
                  className={`w-full text-left rounded-lg border p-3 transition-colors ${
                    selectedSession === s.id
                      ? "border-[var(--color-accent)] bg-[var(--color-surface-elevated)]"
                      : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-text-muted)]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-[10px] uppercase tracking-wider ${
                        s.status === "active"
                          ? "text-green-400"
                          : s.status === "paused"
                            ? "text-amber-400"
                            : "text-[var(--color-text-muted)]"
                      }`}
                    >
                      {s.status}
                      {s.is_baseline && " (baseline)"}
                    </span>
                    <span className="text-[10px] text-[var(--color-text-muted)]">
                      {s.exchange_count} ex.
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    {new Date(s.created_at).toLocaleString()}
                  </p>
                  {s.extracted_thread && (
                    <p className="mt-1 text-[10px] text-[var(--color-text-muted)] italic truncate">
                      {stripMarkdown(s.extracted_thread)}
                    </p>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Session detail */}
          <div className="lg:col-span-2">
            {selectedSession ? (
              (() => {
                const session = sessions.find((s) => s.id === selectedSession);
                if (!session) return null;
                const iterationForSession = iterations.find((i) => i.id === session.iteration_id);
                return (
                  <div className="space-y-4">
                    {/* Session metadata panel */}
                    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-4">
                      {/* Header row */}
                      <div className="flex items-center flex-wrap gap-2">
                        <span className="font-mono text-xs text-[var(--color-text)]">
                          {session.id.slice(0, 8)}
                        </span>
                        {iterationForSession && (
                          <span className="rounded-full border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10px] text-[var(--color-accent)]">
                            {toRoman(iterationForSession.number)}. {iterationForSession.name}
                          </span>
                        )}
                        <span className="text-[10px] text-[var(--color-text-muted)]">
                          {session.exchange_count} exchanges
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                            session.status === "active"
                              ? "bg-green-500/10 text-green-400 border border-green-500/30"
                              : session.status === "paused"
                                ? "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                                : "bg-[var(--color-bg)] text-[var(--color-text-muted)] border border-[var(--color-border)]"
                          }`}
                        >
                          {session.status}
                        </span>
                        <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">
                          {new Date(session.created_at).toLocaleString()}
                        </span>
                      </div>

                      {/* Seed thread */}
                      {session.seed_thread && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
                            Seed Thread
                          </p>
                          <p className="text-xs text-[var(--color-text)] leading-relaxed italic bg-[var(--color-bg)] rounded p-3 border border-[var(--color-border)]">
                            {stripMarkdown(session.seed_thread)}
                          </p>
                        </div>
                      )}

                      {/* Extracted thread */}
                      {session.extracted_thread && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
                            Extracted Thread
                          </p>
                          <p className="text-xs text-[var(--color-text)] leading-relaxed italic bg-[var(--color-bg)] rounded p-3 border border-[var(--color-border)]">
                            {stripMarkdown(session.extracted_thread)}
                          </p>
                        </div>
                      )}

                      {/* Key moments */}
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
                          Key Moments
                        </p>
                        {session.key_moments && session.key_moments.length > 0 ? (
                          <ol className="space-y-1.5 bg-[var(--color-bg)] rounded p-3 border border-[var(--color-border)]">
                            {session.key_moments.map((moment, i) => (
                              <li key={i} className="flex gap-2 text-xs text-[var(--color-text)] leading-relaxed">
                                <span className="text-[var(--color-accent)] font-mono shrink-0">{i + 1}.</span>
                                <span>{moment}</span>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p className="text-[10px] text-[var(--color-text-muted)] italic bg-[var(--color-bg)] rounded p-3 border border-[var(--color-border)]">
                            No key moments extracted
                          </p>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-3 pt-1 border-t border-[var(--color-border)]">
                        {session.status === "active" && (
                          <>
                            <button
                              onClick={() => handleSessionAction(selectedSession, "pause")}
                              className="text-[10px] text-amber-400 hover:underline"
                            >
                              Pause
                            </button>
                            <button
                              onClick={() => handleSessionAction(selectedSession, "end")}
                              className="text-[10px] text-red-400 hover:underline"
                            >
                              End Session
                            </button>
                          </>
                        )}
                        {session.status === "paused" && (
                          <button
                            onClick={() => handleSessionAction(selectedSession, "resume")}
                            className="text-[10px] text-green-400 hover:underline"
                          >
                            Resume
                          </button>
                        )}
                        <button
                          onClick={() => exportSession(selectedSession)}
                          className="text-[10px] text-[var(--color-text-muted)] hover:underline ml-auto"
                        >
                          Export JSON
                        </button>
                      </div>
                    </div>

                    {/* Exchanges */}
                    <div>
                      <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-3">
                        Exchanges ({exchanges.length})
                      </h2>
                      <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                        {exchanges.map((e) => {
                          const agent = AGENTS[e.agent];
                          return (
                            <div
                              key={e.id}
                              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <span
                                  className="text-xs font-semibold uppercase tracking-wider"
                                  style={{ color: agent.color }}
                                >
                                  {agent.name}
                                </span>
                                <span className="text-[10px] text-[var(--color-text-muted)]">
                                  #{e.exchange_number + 1}
                                </span>
                                <span className="text-[10px] text-[var(--color-text-muted)]">
                                  {e.model}
                                </span>
                                <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">
                                  {new Date(e.created_at).toLocaleTimeString()}
                                </span>
                              </div>
                              <p className="text-sm text-[var(--color-text)] leading-relaxed">
                                {stripMarkdown(e.content)}
                              </p>
                              {/* Annotation input */}
                              <div className="mt-3 flex gap-2">
                                <input
                                  type="text"
                                  placeholder="Add annotation..."
                                  value={annotationNote}
                                  onChange={(ev) => setAnnotationNote(ev.target.value)}
                                  className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[10px] text-[var(--color-text)] focus:outline-none"
                                  onKeyDown={(ev) => {
                                    if (ev.key === "Enter") addAnnotation(e.id);
                                  }}
                                />
                                <button
                                  onClick={() => addAnnotation(e.id)}
                                  className="text-[10px] text-[var(--color-accent)] hover:underline"
                                >
                                  Annotate
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-[var(--color-text-muted)]">
                Select a session to view details
              </div>
            )}
          </div>
        </div>

        {/* AXON Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              AXON · EpistemicGate {axonRequests.length > 0 && `(${axonRequests.length})`}
            </h2>
            <button
              onClick={() => {
                setShowAxon(!showAxon);
                if (!showAxon && axonRequests.length === 0) fetchAxonRequests();
              }}
              className="text-[10px] text-[var(--color-accent)] hover:underline"
            >
              {showAxon ? "Collapse" : "Expand"}
            </button>
          </div>

          {showAxon && (
            <>
              {/* AXON stats row */}
              {axonStats && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <MetricCard label="Total Requests" value={axonStats.total} />
                  <MetricCard label="EXEC" value={axonStats.exec_count} />
                  <MetricCard label="PASS" value={axonStats.pass_count} />
                  <MetricCard label="Active / Pending" value={axonStats.active_count} live={axonStats.active_count > 0} />
                  <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">Avg Exchanges</p>
                    <p className="mt-1 text-lg font-light text-[var(--color-text)]">{axonStats.avg_exchanges ?? "—"}</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                {/* AXON request list */}
                <div className="lg:col-span-1 space-y-2">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">Requests</p>
                    <button
                      onClick={fetchAxonRequests}
                      className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
                    >
                      Refresh
                    </button>
                  </div>
                  <div className="space-y-2 max-h-[70vh] overflow-y-auto">
                    {axonRequests.length === 0 ? (
                      <p className="text-[10px] text-[var(--color-text-muted)] italic py-4 text-center">No AXON requests yet</p>
                    ) : (
                      axonRequests.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => fetchAxonDetail(r.id)}
                          className={`w-full text-left rounded-lg border p-3 transition-colors ${
                            selectedAxonRequest === r.id
                              ? "border-[var(--color-accent)] bg-[var(--color-surface-elevated)]"
                              : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-text-muted)]"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`text-[10px] uppercase tracking-wider font-medium ${
                                r.output_decision === "EXEC"
                                  ? "text-green-400"
                                  : r.output_decision === "PASS"
                                    ? "text-amber-400"
                                    : r.status === "running" || r.status === "pending"
                                      ? "text-[var(--color-accent)]"
                                      : r.status === "error"
                                        ? "text-red-400"
                                        : "text-[var(--color-text-muted)]"
                              }`}
                            >
                              {r.output_decision ?? r.status}
                            </span>
                            <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">
                              {r.exchange_count} ex.
                            </span>
                          </div>
                          <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                            {new Date(r.created_at).toLocaleString()}
                          </p>
                          <p className="mt-1 text-xs text-[var(--color-text)] truncate">
                            {r.input_text}
                          </p>
                          {r.request_token && (
                            <p className="mt-1 text-[9px] font-mono text-[var(--color-text-muted)] truncate opacity-60">
                              {r.request_token.slice(0, 12)}…
                            </p>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>

                {/* AXON request detail */}
                <div className="lg:col-span-2">
                  {selectedAxonRequest && axonDetail ? (
                    <div className="space-y-4">
                      {/* Metadata card */}
                      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-4">
                        <div className="flex items-center flex-wrap gap-2">
                          <span className="font-mono text-xs text-[var(--color-text)]">
                            {axonDetail.id.slice(0, 8)}
                          </span>
                          <span className="text-[10px] text-[var(--color-text-muted)]">
                            {axonDetail.exchange_count} exchanges
                          </span>
                          {axonDetail.output_decision && (
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider border font-medium ${
                                axonDetail.output_decision === "EXEC"
                                  ? "bg-green-500/10 text-green-400 border-green-500/30"
                                  : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                              }`}
                            >
                              {axonDetail.output_decision}
                            </span>
                          )}
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider border ${
                              axonDetail.status === "complete"
                                ? "bg-[var(--color-bg)] text-[var(--color-text-muted)] border-[var(--color-border)]"
                                : axonDetail.status === "running" || axonDetail.status === "pending"
                                  ? "bg-[var(--color-accent)]/10 text-[var(--color-accent)] border-[var(--color-accent)]/30"
                                  : "bg-red-500/10 text-red-400 border-red-500/30"
                            }`}
                          >
                            {axonDetail.status}
                          </span>
                          <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">
                            {new Date(axonDetail.created_at).toLocaleString()}
                          </span>
                        </div>

                        {axonDetail.request_token && (
                          <p className="text-[10px] font-mono text-[var(--color-text-muted)] opacity-60">
                            token: {axonDetail.request_token.slice(0, 16)}…
                          </p>
                        )}

                        {/* Input */}
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
                            Input
                          </p>
                          <p className="text-sm text-[var(--color-text)] leading-relaxed bg-[var(--color-bg)] rounded p-3 border border-[var(--color-border)]">
                            {axonDetail.input_text}
                          </p>
                        </div>

                        {/* Output */}
                        {axonDetail.output_content && (
                          <div>
                            <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
                              {axonDetail.output_decision === "EXEC" ? "Answer" : "Finding"}
                            </p>
                            <p className="text-sm text-[var(--color-text)] leading-relaxed bg-[var(--color-bg)] rounded p-3 border border-[var(--color-border)]">
                              {axonDetail.output_content}
                            </p>
                          </div>
                        )}

                        {/* Timing */}
                        {axonDetail.completed_at && (
                          <p className="text-[10px] text-[var(--color-text-muted)]">
                            Resolved in{" "}
                            {Math.round(
                              (new Date(axonDetail.completed_at).getTime() -
                                new Date(axonDetail.created_at).getTime()) / 1000
                            )}s
                            {" · "}
                            {new Date(axonDetail.completed_at).toLocaleTimeString()}
                          </p>
                        )}
                      </div>

                      {/* Exchanges */}
                      <div>
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-3">
                          Exchanges ({axonExchanges.length})
                        </h3>
                        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                          {axonExchanges.map((e) => {
                            const agentDef = AXON_AGENTS[e.agent];
                            if (e.skipped) {
                              return (
                                <div
                                  key={e.id}
                                  className="flex items-center gap-3 px-4 py-2 rounded border border-[var(--color-border)]/50 bg-[var(--color-surface)] opacity-40"
                                >
                                  <span
                                    className="text-[10px] font-semibold uppercase tracking-wider"
                                    style={{ color: agentDef.color }}
                                  >
                                    {agentDef.name}
                                  </span>
                                  <span className="text-[10px] text-[var(--color-text-muted)]">
                                    #{e.exchange_number + 1}
                                  </span>
                                  <span className="text-[10px] font-mono text-[var(--color-text-muted)]">[PASS]</span>
                                  <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">
                                    {new Date(e.created_at).toLocaleTimeString()}
                                  </span>
                                </div>
                              );
                            }
                            return (
                              <div
                                key={e.id}
                                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
                              >
                                <div className="flex items-center gap-2 mb-2">
                                  <span
                                    className="text-xs font-semibold uppercase tracking-wider"
                                    style={{ color: agentDef.color }}
                                  >
                                    {agentDef.name}
                                  </span>
                                  <span className="text-[10px] text-[var(--color-text-muted)]">
                                    #{e.exchange_number + 1}
                                  </span>
                                  <span className="text-[10px] text-[var(--color-text-muted)]">
                                    {e.model}
                                  </span>
                                  <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">
                                    {new Date(e.created_at).toLocaleTimeString()}
                                  </span>
                                </div>
                                <p className="text-sm text-[var(--color-text)] leading-relaxed whitespace-pre-wrap">
                                  {e.content}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ) : selectedAxonRequest ? (
                    <div className="flex h-40 items-center justify-center text-sm text-[var(--color-text-muted)]">
                      Loading…
                    </div>
                  ) : (
                    <div className="flex h-40 items-center justify-center text-sm text-[var(--color-text-muted)]">
                      Select a request to view details
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function MetricCard({ label, value, live }: { label: string; value: number; live?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-lg font-light text-[var(--color-text)] flex items-center gap-2">
        {live && <span className="pulse-glow h-2 w-2 rounded-full bg-green-500" />}
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function DailyViewsChart({ data }: { data: DailyViewStat[] }) {
  const maxCount = Math.max(...data.map((d) => parseInt(d.count)), 1);

  return (
    <div className="flex items-end gap-[2px] h-24">
      {data.map((d) => {
        const count = parseInt(d.count);
        const height = Math.max((count / maxCount) * 100, 2);
        const dateStr = new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return (
          <div
            key={d.date}
            className="group relative flex-1 min-w-0"
            style={{ height: "100%" }}
          >
            <div
              className="absolute bottom-0 w-full rounded-sm bg-[var(--color-accent)]/60 hover:bg-[var(--color-accent)] transition-colors cursor-default"
              style={{ height: `${height}%` }}
            />
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10">
              <div className="rounded bg-[var(--color-surface-elevated)] border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-text)] whitespace-nowrap shadow-lg">
                {dateStr}: {count}
              </div>
            </div>
          </div>
        );
      })}
    </div>
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
