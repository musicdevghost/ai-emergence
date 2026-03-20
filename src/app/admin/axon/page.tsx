"use client";

import { useEffect, useState, useCallback } from "react";
import { AXON_AGENTS, type AxonRole } from "@/lib/axon-agents";
import Link from "next/link";

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
  version: "v1" | "v2";
}

interface AxonExchange {
  id: string;
  exchange_number: number;
  agent: AxonRole;
  model: string;
  content: string;
  skipped: boolean;
  created_at: string;
  turn_number?: number;
}

interface AxonStats {
  total: number;
  exec_count: number;
  pass_count: number;
  active_count: number;
  avg_exchanges: string;
  v1_count: number;
  v2_count: number;
}

const SESSION_KEY = "admin_secret";

const VERSION_COLORS = {
  v1: "text-amber-400 border-amber-400/30 bg-amber-400/10",
  v2: "text-blue-400 border-blue-400/30 bg-blue-400/10",
};

export default function AxonAdminPage() {
  const [secret, setSecret] = useState("");
  const [authenticated, setAuthenticated] = useState(false);

  const [requests, setRequests] = useState<AxonRequest[]>([]);
  const [stats, setStats] = useState<AxonStats | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exchanges, setExchanges] = useState<AxonExchange[]>([]);
  const [detail, setDetail] = useState<AxonRequest | null>(null);
  const [versionFilter, setVersionFilter] = useState<"all" | "v1" | "v2">("all");

  // Restore secret from sessionStorage on mount
  useEffect(() => {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) setSecret(saved);
  }, []);

  const fetchRequests = useCallback(async (s: string, version: string = "all") => {
    const params = new URLSearchParams({ secret: s });
    if (version !== "all") params.set("version", version);
    const res = await fetch(`/api/admin/axon/requests?${params}`);
    if (res.ok) {
      const data = await res.json();
      setRequests(data.requests);
      setStats(data.stats);
    }
  }, []);

  const fetchDetail = useCallback(async (requestId: string, s: string) => {
    setSelectedId(requestId);
    setExchanges([]);
    setDetail(null);
    const res = await fetch(`/api/admin/axon/detail?secret=${s}&request_id=${requestId}`);
    if (res.ok) {
      const data = await res.json();
      setExchanges(data.exchanges);
      setDetail(data.request);
    }
  }, []);

  const handleLogin = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const res = await fetch(`/api/admin/axon/requests?secret=${secret}`);
      if (res.ok) {
        const data = await res.json();
        setRequests(data.requests);
        setStats(data.stats);
        setAuthenticated(true);
        sessionStorage.setItem(SESSION_KEY, secret);
      } else {
        alert("Invalid admin secret");
      }
    },
    [secret]
  );

  // Auto-login if secret is in sessionStorage
  useEffect(() => {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved && !authenticated) {
      fetch(`/api/admin/axon/requests?secret=${saved}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data) {
            setSecret(saved);
            setRequests(data.requests);
            setStats(data.stats);
            setAuthenticated(true);
          }
        })
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeVersion = useCallback(async (v: "all" | "v1" | "v2") => {
    setVersionFilter(v);
    setSelectedId(null);
    setDetail(null);
    setExchanges([]);
    await fetchRequests(secret, v);
  }, [secret, fetchRequests]);

  async function exportAxon(requestId?: string) {
    const params = new URLSearchParams({ secret });
    if (requestId) {
      params.set("request_id", requestId);
    } else if (versionFilter !== "all") {
      params.set("version", versionFilter);
    }
    const res = await fetch(`/api/admin/axon/export?${params}`);
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = requestId
      ? `axon-request-${requestId.slice(0, 8)}.json`
      : versionFilter !== "all"
      ? `axon-export-${versionFilter}.json`
      : "axon-export-all.json";
    a.click();
  }

  // ── Login screen ──────────────────────────────────────────────────────────
  if (!authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)]">
        <form onSubmit={handleLogin} className="flex gap-2">
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

  // ── Main ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <header className="border-b border-[var(--color-border)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--color-text)]">
              AXON Admin
            </h1>
            <Link
              href="/admin"
              className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors uppercase tracking-wider"
            >
              ← Experiment
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => fetchRequests(secret, versionFilter)}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
            >
              Refresh
            </button>
            <button
              onClick={() => exportAxon()}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
            >
              Export {versionFilter !== "all" ? versionFilter.toUpperCase() : "All"} (JSON)
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6 space-y-6">
        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <MetricCard label="Total Requests" value={stats.total} />
            <MetricCard label="EXEC" value={stats.exec_count} />
            <MetricCard label="PASS" value={stats.pass_count} />
            <MetricCard label="Active / Pending" value={stats.active_count} live={stats.active_count > 0} />
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">Avg Exchanges</p>
              <p className="mt-1 text-lg font-light text-[var(--color-text)]">{stats.avg_exchanges ?? "—"}</p>
            </div>
          </div>
        )}

        {/* Version filter pills */}
        {stats && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => changeVersion("all")}
              className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-wider border transition-colors ${
                versionFilter === "all"
                  ? "border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent)]/10"
                  : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-text-muted)]"
              }`}
            >
              All ({stats.v1_count + stats.v2_count})
            </button>
            <button
              onClick={() => changeVersion("v1")}
              className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-wider border transition-colors ${
                versionFilter === "v1"
                  ? VERSION_COLORS.v1
                  : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-text-muted)]"
              }`}
            >
              v1 — Classic ({stats.v1_count})
            </button>
            <button
              onClick={() => changeVersion("v2")}
              className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-wider border transition-colors ${
                versionFilter === "v2"
                  ? VERSION_COLORS.v2
                  : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-text-muted)]"
              }`}
            >
              v2 — Executor ({stats.v2_count})
            </button>
          </div>
        )}

        {/* Request list + Detail */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* List */}
          <div className="lg:col-span-1 space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
              Requests ({requests.length})
            </p>
            <div className="space-y-2 max-h-[80vh] overflow-y-auto">
              {requests.length === 0 ? (
                <p className="text-[10px] text-[var(--color-text-muted)] italic py-4 text-center">
                  No AXON requests yet
                </p>
              ) : (
                requests.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => fetchDetail(r.id, secret)}
                    className={`w-full text-left rounded-lg border p-3 transition-colors ${
                      selectedId === r.id
                        ? "border-[var(--color-accent)] bg-[var(--color-surface-elevated)]"
                        : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-text-muted)]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
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
                        {/* Version badge */}
                        <span className={`rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider border ${VERSION_COLORS[r.version] ?? ""}`}>
                          {r.version}
                        </span>
                      </div>
                      <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">
                        {r.exchange_count} ex.
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                      {new Date(r.created_at).toLocaleString()}
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-text)] truncate">{r.input_text}</p>
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

          {/* Detail */}
          <div className="lg:col-span-2">
            {selectedId && detail ? (
              <div className="space-y-4">
                {/* Metadata */}
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-4">
                  <div className="flex items-center flex-wrap gap-2">
                    <span className="font-mono text-xs text-[var(--color-text)]">
                      {detail.id.slice(0, 8)}
                    </span>
                    <span className="text-[10px] text-[var(--color-text-muted)]">
                      {detail.exchange_count} exchanges
                    </span>
                    {detail.output_decision && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider border font-medium ${
                          detail.output_decision === "EXEC"
                            ? "bg-green-500/10 text-green-400 border-green-500/30"
                            : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                        }`}
                      >
                        {detail.output_decision}
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider border ${
                        detail.status === "complete"
                          ? "bg-[var(--color-bg)] text-[var(--color-text-muted)] border-[var(--color-border)]"
                          : detail.status === "running" || detail.status === "pending"
                            ? "bg-[var(--color-accent)]/10 text-[var(--color-accent)] border-[var(--color-accent)]/30"
                            : "bg-red-500/10 text-red-400 border-red-500/30"
                      }`}
                    >
                      {detail.status}
                    </span>
                    <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">
                      {new Date(detail.created_at).toLocaleString()}
                    </span>
                  </div>

                  {detail.request_token && (
                    <p className="text-[10px] font-mono text-[var(--color-text-muted)] opacity-60">
                      token: {detail.request_token.slice(0, 16)}…
                    </p>
                  )}

                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Input</p>
                    <p className="text-sm text-[var(--color-text)] leading-relaxed bg-[var(--color-bg)] rounded p-3 border border-[var(--color-border)]">
                      {detail.input_text}
                    </p>
                  </div>

                  {detail.output_content && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
                        {detail.output_decision === "EXEC" ? "Answer" : "Finding"}
                      </p>
                      <p className="text-sm text-[var(--color-text)] leading-relaxed bg-[var(--color-bg)] rounded p-3 border border-[var(--color-border)]">
                        {detail.output_content}
                      </p>
                    </div>
                  )}

                  {detail.completed_at && (
                    <p className="text-[10px] text-[var(--color-text-muted)]">
                      Resolved in{" "}
                      {Math.round(
                        (new Date(detail.completed_at).getTime() -
                          new Date(detail.created_at).getTime()) / 1000
                      )}s
                      {" · "}
                      {new Date(detail.completed_at).toLocaleTimeString()}
                    </p>
                  )}
                </div>

                {/* Exchanges */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                      Exchanges ({exchanges.length})
                    </h3>
                    <button
                      onClick={() => exportAxon(selectedId)}
                      className="text-[10px] text-[var(--color-text-muted)] hover:underline"
                    >
                      Export JSON
                    </button>
                  </div>
                  <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                    {exchanges.map((e) => {
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
                            {e.turn_number !== undefined && e.turn_number > 0 && (
                              <span className="text-[9px] text-[var(--color-text-muted)] opacity-60">
                                T{e.turn_number + 1}
                              </span>
                            )}
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
                            {e.turn_number !== undefined && e.turn_number > 0 && (
                              <span className="text-[10px] text-[var(--color-text-muted)] opacity-60">
                                · Turn {e.turn_number + 1}
                              </span>
                            )}
                            <span className="text-[10px] text-[var(--color-text-muted)]">{e.model}</span>
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
            ) : selectedId ? (
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
