"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AGENTS, type AgentRole } from "@/lib/agents";
import { stripMarkdown } from "@/lib/markdown";

/* ─── Interfaces ──────────────────────────────────────────────────────────── */

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
  pattern_departure: boolean | null;
  departure_note: string | null;
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

interface PageViewStat { path: string; count: string; }
interface DailyViewStat { date: string; count: string; }

interface AnalyticsStats {
  totalViews: number;
  uniqueVisitors: number;
  liveViewers: number;
  viewsByPage: PageViewStat[];
  dailyViews: DailyViewStat[];
  totalSessions: number;
  totalExchanges: number;
}

interface Hinge {
  id: number;
  content: string;
  confirmed: boolean;
  source: string;
  session_id: string | null;
  created_at: string;
  rejection_reason: string | null;
  reviewer_decision: "confirm" | "reject" | null;
  reviewer_reason: string | null;
}

interface Proposal {
  id: number;
  content: string;
  status: "pending" | "approved" | "rejected";
  session_id: string | null;
  created_at: string;
  admin_note: string | null;
  reviewed_at: string | null;
  reviewer_decision: "approve" | "reject" | null;
  reviewer_reason: string | null;
}

type AnalyticsRange = "1d" | "7d" | "30d" | "all";
type Section = "overview" | "sessions" | "iterations" | "memory" | "export";
type MemoryTab = "hinges" | "proposals";

const RANGE_LABELS: Record<AnalyticsRange, string> = {
  "1d": "Today", "7d": "7 Days", "30d": "30 Days", all: "All Time",
};

/* ─── Nav items ───────────────────────────────────────────────────────────── */

const NAV: { id: Section; label: string; icon: React.ReactNode }[] = [
  {
    id: "overview",
    label: "Overview",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
        <rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
        <rect x="1" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
        <rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
      </svg>
    ),
  },
  {
    id: "sessions",
    label: "Sessions",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M1 2.5A1.5 1.5 0 012.5 1h9A1.5 1.5 0 0113 2.5v7A1.5 1.5 0 0111.5 11H8l-3 2v-2H2.5A1.5 1.5 0 011 9.5v-7z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: "iterations",
    label: "Iterations",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 10.5h10M2 7h10M2 3.5h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        <path d="M11 1.5l2 2-2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: "memory",
    label: "Memory",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3"/>
        <path d="M7 4v3l2 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: "export",
    label: "Export",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M7 1v8M4 6l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M2 10v1.5A1.5 1.5 0 003.5 13h7a1.5 1.5 0 001.5-1.5V10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    ),
  },
];

/* ─── Component ───────────────────────────────────────────────────────────── */

export default function AdminPanel() {
  const [secret, setSecret] = useState("");
  // null = still checking localStorage (prevents gate flash on refresh)
  // false = checked, no saved token or token rejected
  // true  = authenticated
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeSection: Section = (searchParams.get("section") as Section) || "overview";
  const setActiveSection = useCallback((section: Section) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("section", section);
    params.delete("tab"); // reset tab when switching sections
    router.replace(`/admin?${params.toString()}`);
  }, [router, searchParams]);
  const memoryTab: MemoryTab = (searchParams.get("tab") as MemoryTab) || "hinges";
  const setMemoryTab = useCallback((tab: MemoryTab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.replace(`/admin?${params.toString()}`);
  }, [router, searchParams]);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [sessionsStatusFilter, setSessionsStatusFilter] = useState<"all" | "active" | "complete" | "paused">("all");
  const [sessionsIterFilter, setSessionsIterFilter] = useState<number | "all">("all");
  const [sessionsOrder, setSessionsOrder] = useState<"desc" | "asc">("desc");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [annotationNote, setAnnotationNote] = useState("");

  const [analytics, setAnalytics] = useState<AnalyticsStats | null>(null);
  const [analyticsRange, setAnalyticsRange] = useState<AnalyticsRange>("7d");

  const [iterations, setIterations] = useState<Iteration[]>([]);
  const [selectedIterationId, setSelectedIterationId] = useState<number | null>(null);
  const [iterationsFilter, setIterationsFilter] = useState<"all" | "active" | "ended">("all");
  const [showNewIteration, setShowNewIteration] = useState(false);
  const [newIteration, setNewIteration] = useState({ name: "", tagline: "", description: "" });
  const [editingIteration, setEditingIteration] = useState<{ conclusion: string; notable_moments: string } | null>(null);

  const [publishing, setPublishing] = useState(false);
  const [departureState, setDepartureState] = useState<Record<string, { departure: boolean | null; note: string }>>({});

  const [hinges, setHinges] = useState<Hinge[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  // Reject-with-reason state: stores the id being rejected + the typed reason
  const [rejectingHingeId, setRejectingHingeId] = useState<number | null>(null);
  const [hingeRejectReason, setHingeRejectReason] = useState("");
  const [rejectingProposalId, setRejectingProposalId] = useState<number | null>(null);
  const [proposalRejectNote, setProposalRejectNote] = useState("");
  // Memory pagination + filters
  const MEMORY_PAGE_SIZE = 5;
  const [hingesPage, setHingesPage] = useState(1);
  const [proposalsPage, setProposalsPage] = useState(1);
  const [hingesFilter, setHingesFilter] = useState<"all" | "confirmed" | "pending" | "rejected">("all");
  const [hingesOrder, setHingesOrder] = useState<"desc" | "asc">("desc");
  const [proposalsFilter, setProposalsFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [proposalsOrder, setProposalsOrder] = useState<"desc" | "asc">("desc");
  const [forcingExchange, setForcingExchange] = useState(false);
  const [lastForceResult, setLastForceResult] = useState<string | null>(null);

  /* ── Restore secret + auto-login ── */
  useEffect(() => {
    const saved = localStorage.getItem("admin_secret");
    if (saved) {
      setSecret(saved);
    } else {
      setAuthenticated(false); // no saved token → show gate
    }
  }, []);

  // When secret is restored from storage, authenticate automatically
  useEffect(() => {
    if (secret && authenticated !== true) {
      fetchSessions();
    }
    // fetchSessions is stable when secret is stable — only runs on initial restore
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secret]);

  /* ── Fetchers ── */
  const fetchAnalytics = useCallback(async (range: AnalyticsRange) => {
    try {
      const res = await fetch(`/api/analytics/stats?range=${range}`);
      if (res.ok) setAnalytics(await res.json());
    } catch { /* ignore */ }
  }, []);

  const fetchIterations = useCallback(async () => {
    const res = await fetch(`/api/admin/iterations?secret=${secret}`);
    if (res.ok) setIterations((await res.json()).iterations);
  }, [secret]);

  const fetchHinges = useCallback(async () => {
    const res = await fetch(`/api/admin/hinges`, { headers: { "x-admin-secret": secret } });
    if (res.ok) setHinges((await res.json()).hinges);
  }, [secret]);

  const fetchProposals = useCallback(async () => {
    const res = await fetch(`/api/admin/proposals`, { headers: { "x-admin-secret": secret } });
    if (res.ok) setProposals((await res.json()).proposals);
  }, [secret]);

  const fetchSessions = useCallback(async () => {
    const res = await fetch(`/api/admin/sessions?secret=${secret}`);
    if (res.ok) {
      setSessions((await res.json()).sessions);
      setAuthenticated(true);
      localStorage.setItem("admin_secret", secret);
      fetchIterations();
      fetchAnalytics(analyticsRange);
      fetchHinges();
      fetchProposals();
    } else {
      alert("Invalid admin secret");
    }
  }, [secret, fetchIterations, fetchAnalytics, analyticsRange, fetchHinges, fetchProposals]);

  const fetchExchanges = useCallback(async (sessionId: string) => {
    setSelectedSession(sessionId);
    const res = await fetch(`/api/exchanges?session_id=${sessionId}&after=-1`);
    const exs: Exchange[] = (await res.json()).exchanges;
    setExchanges(exs);
    const initial: Record<string, { departure: boolean | null; note: string }> = {};
    for (const e of exs) {
      initial[e.id] = { departure: e.pattern_departure ?? null, note: e.departure_note ?? "" };
    }
    setDepartureState(initial);
  }, []);

  /* ── Actions ── */
  async function saveDeparture(exchangeId: string) {
    const state = departureState[exchangeId];
    if (!state) return;
    await fetch(`/api/admin/exchanges`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ id: exchangeId, pattern_departure: state.departure, departure_note: state.note || null }),
    });
    setExchanges((prev) =>
      prev.map((e) => e.id === exchangeId ? { ...e, pattern_departure: state.departure, departure_note: state.note || null } : e)
    );
  }

  async function handleSessionAction(sessionId: string, action: string) {
    await fetch(`/api/admin/sessions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ sessionId, action }),
    });
    fetchSessions();
  }

  async function addAnnotation(exchangeId: string) {
    if (!annotationNote.trim()) return;
    await fetch(`/api/admin/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ exchangeId, sessionId: selectedSession, note: annotationNote }),
    });
    setAnnotationNote("");
  }

  async function forceExchange() {
    setForcingExchange(true);
    setLastForceResult(null);
    try {
      const res = await fetch("/api/admin/force-exchange", {
        method: "POST",
        headers: { "x-admin-secret": secret },
      });
      const data = await res.json();
      if (res.ok) {
        const { exchange, isNewSession, sessionId } = data;
        const label = isNewSession ? "New VI session started" : "Exchange added";
        setLastForceResult(`${label} · ${exchange.agent} #${exchange.number}${exchange.skipped ? " [PASS]" : ""}`);
        fetchSessions();
      } else {
        setLastForceResult(`Error: ${data.error}`);
      }
    } catch {
      setLastForceResult("Request failed");
    } finally {
      setForcingExchange(false);
    }
  }

  async function toggleHinge(id: number, confirmed: boolean) {
    await fetch("/api/admin/hinges", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ id, confirmed }),
    });
    fetchHinges();
  }

  async function rejectHinge(id: number, reason: string) {
    if (!reason.trim()) return;
    await fetch("/api/admin/hinges", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ id, rejection_reason: reason.trim() }),
    });
    setRejectingHingeId(null);
    setHingeRejectReason("");
    fetchHinges();
  }

  async function rejectProposal(id: number, note: string) {
    if (!note.trim()) return;
    await fetch("/api/admin/proposals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ id, status: "rejected", admin_note: note.trim() }),
    });
    setRejectingProposalId(null);
    setProposalRejectNote("");
    fetchProposals();
  }

  async function deleteHinge(id: number) {
    await fetch("/api/admin/hinges", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ id, deleted: true }),
    });
    fetchHinges();
  }

  async function updateProposalStatus(id: number, status: "approved" | "rejected" | "pending") {
    await fetch("/api/admin/proposals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ id, status }),
    });
    fetchProposals();
  }

  async function deleteProposal(id: number) {
    await fetch("/api/admin/proposals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ id, deleted: true }),
    });
    fetchProposals();
  }

  async function createIteration() {
    if (!newIteration.name || !newIteration.tagline || !newIteration.description) return;
    await fetch(`/api/admin/iterations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify(newIteration),
    });
    setNewIteration({ name: "", tagline: "", description: "" });
    setShowNewIteration(false);
    fetchIterations(); fetchSessions();
  }

  async function endIteration(id: number) {
    if (!confirm("End this iteration? New sessions will not be assigned to any iteration until a new one is created.")) return;
    await fetch(`/api/admin/iterations`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ id, ended_at: new Date().toISOString() }),
    });
    fetchIterations();
  }

  async function saveIteration(id: number) {
    if (!editingIteration) return;
    let notable_moments: string[] | null = null;
    try {
      const trimmed = editingIteration.notable_moments.trim();
      notable_moments = trimmed ? trimmed.split("\n").map(s => s.trim()).filter(Boolean) : null;
    } catch { notable_moments = null; }
    await fetch(`/api/admin/iterations`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ id, conclusion: editingIteration.conclusion, notable_moments }),
    });
    setEditingIteration(null);
    fetchIterations();
  }

  async function publishExport() {
    setPublishing(true);
    try {
      const res = await fetch(`/api/admin/export/publish`, { method: "POST", headers: { "x-admin-secret": secret } });
      const data = await res.json();
      if (res.ok) alert(`Export published (${data.sessions} sessions, ${data.exchanges} exchanges)\n\n${data.url}`);
      else alert(`Publish failed: ${data.error}\n\n${data.detail || ""}`);
    } catch { alert("Publish failed"); } finally { setPublishing(false); }
  }

  async function exportSession(sessionId?: string) {
    const url = sessionId
      ? `/api/admin/export?secret=${secret}&session_id=${sessionId}`
      : `/api/admin/export?secret=${secret}`;
    const data = await (await fetch(url)).json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = sessionId ? `emergence-session-${sessionId.slice(0, 8)}.json` : "emergence-export-all.json";
    a.click();
  }

  /* ─── Login screen ─────────────────────────────────────────────────────── */
  // Still reading localStorage — render nothing to prevent gate flash
  if (authenticated === null) return null;

  if (authenticated === false) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)]">
        <form onSubmit={(e) => { e.preventDefault(); fetchSessions(); }} className="flex gap-2">
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Admin secret"
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
          />
          <button type="submit" className="rounded border border-[var(--color-border)] px-6 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
            Enter
          </button>
        </form>
      </div>
    );
  }

  /* ─── Derived counts for badges ────────────────────────────────────────── */
  const activeSession = sessions.find((s) => s.status === "active");
  const pendingProposals = proposals.filter((p) => p.status === "pending").length;
  const unconfirmedHinges = hinges.filter((h) => !h.confirmed && !h.rejection_reason).length;
  const memoryBadge = pendingProposals + unconfirmedHinges;

  /* ─── Authenticated layout ─────────────────────────────────────────────── */
  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg)]">

      {/* ── Sidebar ── */}
      <aside className="w-52 shrink-0 flex flex-col h-full border-r border-[var(--color-border)] bg-[var(--color-surface)]">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-[var(--color-border)]">
          <span className="text-xs font-semibold tracking-[0.2em] text-[var(--color-text)]">EMERGENCE</span>
          <p className="text-[9px] text-[var(--color-text-muted)] mt-0.5 uppercase tracking-wider">Admin</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 space-y-0.5 px-2">
          {NAV.map((item) => {
            const isActive = activeSection === item.id;
            const badge =
              item.id === "memory" ? memoryBadge :
              item.id === "sessions" && activeSession ? 1 :
              0;
            return (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${
                  isActive
                    ? "bg-[var(--color-bg)] text-[var(--color-text)]"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg)]/50"
                }`}
              >
                <span className={isActive ? "text-[var(--color-accent)]" : ""}>{item.icon}</span>
                <span className="text-xs flex-1">{item.label}</span>
                {badge > 0 && (
                  <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${
                    item.id === "memory" ? "bg-amber-500/20 text-amber-400" : "bg-green-500/20 text-green-400"
                  }`}>
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[var(--color-border)]">
          <a
            href="/"
            target="_blank"
            className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            ↗ View experiment
          </a>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 overflow-y-auto">

        {/* ════════════════ OVERVIEW ════════════════ */}
        {activeSection === "overview" && (
          <div className="p-6 space-y-6 max-w-5xl">
            <div className="flex items-center justify-between">
              <SectionHeader title="Overview" />
              <div className="flex items-center gap-3">
                {lastForceResult && (
                  <span className="text-[10px] text-[var(--color-text-muted)]">{lastForceResult}</span>
                )}
                <button
                  onClick={forceExchange}
                  disabled={forcingExchange}
                  className="flex items-center gap-1.5 rounded border border-[var(--color-accent)]/40 px-3 py-1.5 text-[10px] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors disabled:opacity-50"
                >
                  {forcingExchange ? (
                    <>
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
                      Running…
                    </>
                  ) : (
                    <>
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M2 1.5l6 3.5-6 3.5V1.5z" fill="currentColor"/>
                      </svg>
                      Force Exchange
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Active session banner */}
            {activeSession && (
              <div className="flex items-center gap-3 rounded-lg border border-green-500/30 bg-green-500/5 px-4 py-3">
                <span className="pulse-glow h-2 w-2 rounded-full bg-green-500 shrink-0" />
                <span className="text-xs text-green-400 font-medium">Session active</span>
                <span className="text-[10px] text-[var(--color-text-muted)]">{activeSession.exchange_count} exchanges</span>
                <button
                  onClick={() => { setActiveSection("sessions"); fetchExchanges(activeSession.id); }}
                  className="ml-auto text-[10px] text-[var(--color-accent)] hover:underline"
                >
                  View →
                </button>
              </div>
            )}

            {analytics ? (
              <>
                {/* Range selector */}
                <div className="flex items-center justify-between">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">Analytics</p>
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

                {/* Metric tiles */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  <MetricCard label="Watching Now" value={analytics.liveViewers} live={analytics.liveViewers > 0} />
                  <MetricCard label="Views" value={analytics.totalViews} />
                  <MetricCard label="Unique Visitors" value={analytics.uniqueVisitors} />
                  <MetricCard label="Sessions" value={analytics.totalSessions} />
                  <MetricCard label="Exchanges" value={analytics.totalExchanges} />
                </div>

                {/* Daily chart */}
                {analytics.dailyViews.length > 0 && (
                  <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-3">Daily Views</p>
                    <DailyViewsChart data={analytics.dailyViews} />
                  </div>
                )}

                {/* Top pages + experiment stats */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-3">Top Pages</p>
                    <div className="space-y-2">
                      {analytics.viewsByPage.map((p) => {
                        const count = parseInt(p.count);
                        const maxCount = parseInt(analytics.viewsByPage[0]?.count || "1");
                        return (
                          <div key={p.path}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-[var(--color-text)] truncate">{p.path}</span>
                              <span className="text-[10px] text-[var(--color-text-muted)] ml-2 shrink-0">{count}</span>
                            </div>
                            <div className="h-1 rounded-full bg-[var(--color-bg)]">
                              <div className="h-1 rounded-full bg-[var(--color-accent)]" style={{ width: `${(count / maxCount) * 100}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-3">Experiment Stats</p>
                    <div className="space-y-3">
                      <StatRow label="Avg Exchanges / Session" value={analytics.totalSessions > 0 ? (analytics.totalExchanges / analytics.totalSessions).toFixed(1) : "—"} />
                      <StatRow label="Avg Views / Day" value={analytics.dailyViews.length > 0 ? (analytics.dailyViews.reduce((s, d) => s + parseInt(d.count), 0) / analytics.dailyViews.length).toFixed(1) : "—"} />
                      <StatRow label="Views / Session" value={analytics.totalSessions > 0 ? (analytics.totalViews / analytics.totalSessions).toFixed(1) : "—"} />
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-xs text-[var(--color-text-muted)]">Loading analytics…</p>
            )}
          </div>
        )}

        {/* ════════════════ SESSIONS ════════════════ */}
        {activeSection === "sessions" && (() => {
          const filteredSessions = sessions
            .filter(s =>
              (sessionsStatusFilter === "all" || s.status === sessionsStatusFilter) &&
              (sessionsIterFilter === "all" || s.iteration_id === sessionsIterFilter)
            )
            .sort((a, b) => {
              const diff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
              return sessionsOrder === "desc" ? diff : -diff;
            });
          return (
          <div className="flex h-full">
            {/* Session list */}
            <div className="w-72 shrink-0 border-r border-[var(--color-border)] flex flex-col h-full">
              {/* Filter bar */}
              <div className="px-3 py-2 border-b border-[var(--color-border)] space-y-2">
                {/* Status filters + sort */}
                <div className="flex items-center gap-1 flex-wrap">
                  {(["all", "active", "complete", "paused"] as const).map(f => (
                    <button key={f} onClick={() => setSessionsStatusFilter(f)}
                      className={`text-[9px] px-2 py-0.5 rounded border capitalize transition-colors ${sessionsStatusFilter === f ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}>
                      {f}
                    </button>
                  ))}
                  <button onClick={() => setSessionsOrder(o => o === "desc" ? "asc" : "desc")}
                    className="ml-auto text-[9px] px-2 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
                    {sessionsOrder === "desc" ? "↓ Latest" : "↑ Oldest"}
                  </button>
                </div>
                {/* Iteration filter + count + export */}
                <div className="flex items-center gap-2">
                  <select value={sessionsIterFilter} onChange={e => setSessionsIterFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
                    className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[9px] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]">
                    <option value="all">All iterations ({sessions.length})</option>
                    {[...iterations].sort((a,b) => b.number - a.number).map(it => {
                      const count = sessions.filter(s => s.iteration_id === it.id).length;
                      return <option key={it.id} value={it.id}>{toRoman(it.number)}. {it.name} ({count})</option>;
                    })}
                  </select>
                  <button onClick={() => {
                    const data = JSON.stringify({ exportedAt: new Date().toISOString(), total: filteredSessions.length, sessions: filteredSessions }, null, 2);
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
                    a.download = `emergence-sessions-${new Date().toISOString().slice(0,10)}.json`;
                    a.click();
                  }} className="shrink-0 text-[9px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)] px-2 py-1 rounded transition-colors">
                    Export
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                {filteredSessions.length === 0 && (
                  <p className="text-[10px] text-[var(--color-text-muted)] italic px-1">No sessions match this filter.</p>
                )}
                {filteredSessions.map((s) => {
                  const iterForSession = iterations.find((i) => i.id === s.iteration_id);
                  const iterSessions = sessions.filter(ss => ss.iteration_id === s.iteration_id).sort((a,b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                  const sessionNum = iterSessions.findIndex(ss => ss.id === s.id) + 1;
                  return (
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
                        <span className={`text-[10px] uppercase tracking-wider ${
                          s.status === "active" ? "text-green-400" : s.status === "paused" ? "text-amber-400" : "text-[var(--color-text-muted)]"
                        }`}>
                          {s.status}{s.is_baseline && " (baseline)"}
                        </span>
                        <span className="text-[10px] text-[var(--color-text-muted)]">{s.exchange_count} ex.</span>
                      </div>
                      {iterForSession && (
                        <p className="text-[9px] text-[var(--color-accent)]/70 mt-0.5">{toRoman(iterForSession.number)}-{sessionNum} · {iterForSession.name}</p>
                      )}
                      <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">{new Date(s.created_at).toLocaleString()}</p>
                      {s.extracted_thread && (
                        <p className="mt-1 text-[10px] text-[var(--color-text-muted)] italic truncate">{stripMarkdown(s.extracted_thread)}</p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Session detail */}
            <div className="flex-1 overflow-y-auto p-6">
              {selectedSession ? (() => {
                const session = sessions.find((s) => s.id === selectedSession);
                if (!session) return null;
                const iterationForSession = iterations.find((i) => i.id === session.iteration_id);
                return (
                  <div className="space-y-4 max-w-3xl">
                    {/* Metadata panel */}
                    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-4">
                      <div className="flex items-center flex-wrap gap-2">
                        <span className="font-mono text-xs text-[var(--color-text)]">{session.id.slice(0, 8)}</span>
                        {iterationForSession && (() => {
                          const iterSess = sessions.filter(ss => ss.iteration_id === session.iteration_id).sort((a,b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                          const num = iterSess.findIndex(ss => ss.id === session.id) + 1;
                          return (
                            <span className="rounded-full border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10px] text-[var(--color-accent)]">
                              {toRoman(iterationForSession.number)}-{num} · {iterationForSession.name}
                            </span>
                          );
                        })()}
                        <span className="text-[10px] text-[var(--color-text-muted)]">{session.exchange_count} exchanges</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                          session.status === "active" ? "bg-green-500/10 text-green-400 border border-green-500/30"
                          : session.status === "paused" ? "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                          : "bg-[var(--color-bg)] text-[var(--color-text-muted)] border border-[var(--color-border)]"
                        }`}>{session.status}</span>
                        {session.completed_at && (() => {
                          const mins = Math.round((new Date(session.completed_at).getTime() - new Date(session.created_at).getTime()) / 60000);
                          return <span className="text-[10px] text-[var(--color-text-muted)]">{mins}m</span>;
                        })()}
                        <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">{new Date(session.created_at).toLocaleString()}</span>
                        <button onClick={() => exportSession(selectedSession!)} className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)] px-2 py-0.5 rounded transition-colors">Export JSON</button>
                      </div>

                      {session.seed_thread && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Seed Thread</p>
                          <p className="text-xs text-[var(--color-text)] leading-relaxed italic bg-[var(--color-bg)] rounded p-3 border border-[var(--color-border)]">{stripMarkdown(session.seed_thread)}</p>
                        </div>
                      )}
                      {session.extracted_thread && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Extracted Thread</p>
                          <p className="text-xs text-[var(--color-text)] leading-relaxed italic bg-[var(--color-bg)] rounded p-3 border border-[var(--color-border)]">{stripMarkdown(session.extracted_thread)}</p>
                        </div>
                      )}

                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Key Moments</p>
                        {session.key_moments && session.key_moments.length > 0 ? (
                          <ol className="space-y-1.5 bg-[var(--color-bg)] rounded p-3 border border-[var(--color-border)]">
                            {session.key_moments.map((m, i) => (
                              <li key={i} className="flex gap-2 text-xs text-[var(--color-text)] leading-relaxed">
                                <span className="text-[var(--color-accent)] font-mono shrink-0">{i + 1}.</span>
                                <span>{m}</span>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p className="text-[10px] text-[var(--color-text-muted)] italic bg-[var(--color-bg)] rounded p-3 border border-[var(--color-border)]">No key moments extracted</p>
                        )}
                      </div>

                      <div className="flex items-center gap-3 pt-1 border-t border-[var(--color-border)]">
                        {session.status === "active" && (
                          <>
                            <button onClick={() => handleSessionAction(selectedSession, "pause")} className="text-[10px] text-amber-400 hover:underline">Pause</button>
                            <button onClick={() => handleSessionAction(selectedSession, "end")} className="text-[10px] text-red-400 hover:underline">End Session</button>
                          </>
                        )}
                        {session.status === "paused" && (
                          <button onClick={() => handleSessionAction(selectedSession, "resume")} className="text-[10px] text-green-400 hover:underline">Resume</button>
                        )}
                      </div>
                    </div>

                    {/* Exchanges */}
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-3">Exchanges ({exchanges.length})</p>
                      <div className="space-y-3">
                        {exchanges.map((e) => {
                          const agent = AGENTS[e.agent];
                          const dep = departureState[e.id] ?? { departure: e.pattern_departure ?? null, note: e.departure_note ?? "" };
                          const isDep = dep.departure === true;
                          return (
                            <div key={e.id} className={`rounded-lg border bg-[var(--color-surface)] p-4 ${isDep ? "border-amber-500/50" : "border-[var(--color-border)]"}`}>
                              <div className="flex items-center gap-2 mb-2">
                                {isDep && <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />}
                                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: agent.color }}>{agent.name}</span>
                                <span className="text-[10px] text-[var(--color-text-muted)]">#{e.exchange_number + 1}</span>
                                <span className="text-[10px] text-[var(--color-text-muted)]">{e.model}</span>
                                <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">{new Date(e.created_at).toLocaleTimeString()}</span>
                              </div>
                              <p className="text-sm text-[var(--color-text)] leading-relaxed">{stripMarkdown(e.content)}</p>
                              <div className="mt-3 flex gap-2">
                                <input
                                  type="text"
                                  placeholder="Add annotation..."
                                  value={annotationNote}
                                  onChange={(ev) => setAnnotationNote(ev.target.value)}
                                  className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[10px] text-[var(--color-text)] focus:outline-none"
                                  onKeyDown={(ev) => { if (ev.key === "Enter") addAnnotation(e.id); }}
                                />
                                <button onClick={() => addAnnotation(e.id)} className="text-[10px] text-[var(--color-accent)] hover:underline">Annotate</button>
                              </div>
                              <div className="mt-3 pt-3 border-t border-[var(--color-border)] space-y-2">
                                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                  <input
                                    type="checkbox"
                                    checked={dep.departure === true}
                                    onChange={(ev) => setDepartureState((prev) => ({ ...prev, [e.id]: { ...dep, departure: ev.target.checked ? true : null } }))}
                                    className="accent-amber-400"
                                  />
                                  <span className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">Pattern departure</span>
                                </label>
                                {dep.departure === true && (
                                  <div className="flex gap-2">
                                    <input
                                      type="text"
                                      placeholder="Note what departed and how..."
                                      value={dep.note}
                                      onChange={(ev) => setDepartureState((prev) => ({ ...prev, [e.id]: { ...dep, note: ev.target.value } }))}
                                      className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[10px] text-[var(--color-text)] focus:outline-none"
                                      onKeyDown={(ev) => { if (ev.key === "Enter") saveDeparture(e.id); }}
                                    />
                                    <button onClick={() => saveDeparture(e.id)} className="text-[10px] text-amber-400 hover:underline">Save</button>
                                  </div>
                                )}
                                {dep.departure !== true && dep.departure !== null && (
                                  <button onClick={() => saveDeparture(e.id)} className="text-[10px] text-[var(--color-text-muted)] hover:underline">Save</button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })() : (
                <div className="flex h-full items-center justify-center">
                  <p className="text-sm text-[var(--color-text-muted)]">Select a session to view details</p>
                </div>
              )}
            </div>
          </div>
          );
        })()}

        {/* ════════════════ ITERATIONS ════════════════ */}
        {activeSection === "iterations" && (() => {
          const filteredIters = [...iterations]
            .filter(it => iterationsFilter === "all" ? true : iterationsFilter === "active" ? !it.ended_at : !!it.ended_at)
            .sort((a, b) => b.number - a.number);
          const selectedIter = selectedIterationId !== null
            ? iterations.find(it => it.id === selectedIterationId) ?? null
            : iterations.find(it => !it.ended_at) ?? iterations[iterations.length - 1] ?? null;
          const iterSessions = sessions.filter(s => s.iteration_id === selectedIter?.id);
          return (
          <div className="flex h-full overflow-hidden">
            {/* Left — list */}
            <div className="w-64 shrink-0 border-r border-[var(--color-border)] flex flex-col h-full overflow-hidden">
              {/* Filter */}
              <div className="flex items-center gap-1 p-3 border-b border-[var(--color-border)]">
                {(["all", "active", "ended"] as const).map(f => (
                  <button key={f} onClick={() => setIterationsFilter(f)}
                    className={`text-[9px] px-2 py-0.5 rounded border capitalize transition-colors ${iterationsFilter === f ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}>
                    {f}
                  </button>
                ))}
                <button onClick={() => {
                  const allWithSessions = iterations.map(it => ({
                    ...it,
                    sessions: sessions.filter(s => s.iteration_id === it.id),
                  }));
                  const data = JSON.stringify({ exportedAt: new Date().toISOString(), total: iterations.length, iterations: allWithSessions }, null, 2);
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
                  a.download = `emergence-iterations-all-${new Date().toISOString().slice(0,10)}.json`;
                  a.click();
                }} className="ml-auto text-[9px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)] px-2 py-0.5 rounded transition-colors">
                  Export All
                </button>
              </div>
              {/* List */}
              <div className="flex-1 overflow-y-auto">
                {filteredIters.map(iter => {
                  const isSelected = (selectedIter?.id ?? -1) === iter.id;
                  return (
                    <button key={iter.id} onClick={() => { setSelectedIterationId(iter.id); setShowNewIteration(false); setEditingIteration(null); }}
                      className={`w-full text-left px-4 py-3 border-b border-[var(--color-border)] transition-colors ${isSelected ? "bg-[var(--color-surface)]" : "hover:bg-[var(--color-surface)]/50"}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-[var(--color-text)]">{toRoman(iter.number)}. {iter.name}</span>
                        {!iter.ended_at
                          ? <span className="flex items-center gap-1 text-[9px] text-green-400"><span className="h-1.5 w-1.5 rounded-full bg-green-500 pulse-glow" />Active</span>
                          : <span className="text-[9px] text-[var(--color-text-muted)]">Ended</span>}
                      </div>
                      <p className="text-[9px] text-[var(--color-text-muted)] mt-0.5">
                        {new Date(iter.started_at).toLocaleDateString()}{iter.ended_at ? ` — ${new Date(iter.ended_at).toLocaleDateString()}` : ""}
                      </p>
                    </button>
                  );
                })}
              </div>
              {/* New iteration button */}
              <div className="p-3 border-t border-[var(--color-border)]">
                <button onClick={() => { setShowNewIteration(true); setSelectedIterationId(null); setEditingIteration(null); }}
                  className="w-full text-[10px] text-[var(--color-accent)] hover:underline text-left">
                  + New Iteration
                </button>
              </div>
            </div>

            {/* Right — detail or new form */}
            <div className="flex-1 overflow-y-auto p-6">
              {showNewIteration ? (
                <div className="max-w-lg space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-[var(--color-text)]">New Iteration</h2>
                    <button onClick={() => setShowNewIteration(false)} className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Cancel</button>
                  </div>
                  <p className="text-[10px] text-amber-400">Creating a new iteration will automatically end the current active one.</p>
                  <input type="text" placeholder="Name (e.g. The Remembering)" value={newIteration.name} onChange={(e) => setNewIteration({ ...newIteration, name: e.target.value })} className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]" />
                  <input type="text" placeholder="Tagline" value={newIteration.tagline} onChange={(e) => setNewIteration({ ...newIteration, tagline: e.target.value })} className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]" />
                  <textarea placeholder="Description" value={newIteration.description} onChange={(e) => setNewIteration({ ...newIteration, description: e.target.value })} rows={3} className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)] resize-none" />
                  <button onClick={createIteration} className="rounded border border-[var(--color-accent)] px-4 py-1.5 text-xs text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors">Create Iteration</button>
                </div>
              ) : selectedIter ? (
                <div className="max-w-2xl space-y-6">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-[var(--color-text)]">{toRoman(selectedIter.number)}. {selectedIter.name}</h2>
                      <p className="text-xs text-[var(--color-text-muted)] italic mt-0.5">{selectedIter.tagline}</p>
                      <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
                        {new Date(selectedIter.started_at).toLocaleDateString()}
                        {selectedIter.ended_at ? ` — ${new Date(selectedIter.ended_at).toLocaleDateString()}` : " — present"}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {!selectedIter.ended_at && (
                        <button onClick={() => endIteration(selectedIter.id)} className="text-[10px] text-red-400 hover:underline">End Iteration</button>
                      )}
                      {selectedIter.ended_at && !editingIteration && (
                        <button onClick={() => setEditingIteration({ conclusion: selectedIter.conclusion ?? "", notable_moments: (selectedIter.notable_moments ?? []).join("\n") })}
                          className="text-[10px] text-[var(--color-accent)] hover:underline">Edit</button>
                      )}
                      <button onClick={() => {
                        const data = JSON.stringify({ ...selectedIter, sessions: iterSessions }, null, 2);
                        const a = document.createElement("a");
                        a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
                        a.download = `emergence-iteration-${toRoman(selectedIter.number).toLowerCase()}-${selectedIter.name.toLowerCase().replace(/\s+/g, "-")}.json`;
                        a.click();
                      }} className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)] px-2 py-0.5 rounded transition-colors">
                        Export JSON
                      </button>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="flex gap-6">
                    <div><p className="text-[10px] text-[var(--color-text-muted)]">Sessions</p><p className="text-sm font-semibold text-[var(--color-text)]">{iterSessions.length}</p></div>
                    <div><p className="text-[10px] text-[var(--color-text-muted)]">Exchanges</p><p className="text-sm font-semibold text-[var(--color-text)]">{iterSessions.reduce((sum, s) => sum + (s.exchange_count ?? 0), 0)}</p></div>
                  </div>

                  {/* Description */}
                  {selectedIter.description && (
                    <div>
                      <p className="text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Description</p>
                      <p className="text-xs text-[var(--color-text)] leading-relaxed">{selectedIter.description}</p>
                    </div>
                  )}

                  {/* Conclusion — view or edit */}
                  <div>
                    <p className="text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Conclusion</p>
                    {editingIteration ? (
                      <textarea value={editingIteration.conclusion} onChange={e => setEditingIteration({ ...editingIteration, conclusion: e.target.value })}
                        rows={5} className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)] resize-none" />
                    ) : (
                      <p className="text-xs text-[var(--color-text)] leading-relaxed">{selectedIter.conclusion || <span className="italic text-[var(--color-text-muted)]">No conclusion yet.</span>}</p>
                    )}
                  </div>

                  {/* Notable moments — view or edit */}
                  <div>
                    <p className="text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Notable Moments</p>
                    {editingIteration ? (
                      <div className="space-y-1">
                        <textarea value={editingIteration.notable_moments} onChange={e => setEditingIteration({ ...editingIteration, notable_moments: e.target.value })}
                          rows={6} placeholder="One moment per line" className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)] resize-none" />
                        <p className="text-[9px] text-[var(--color-text-muted)]">One moment per line — saved as array</p>
                      </div>
                    ) : selectedIter.notable_moments && selectedIter.notable_moments.length > 0 ? (
                      <ul className="space-y-1">
                        {selectedIter.notable_moments.map((m, i) => (
                          <li key={i} className="text-xs text-[var(--color-text)] leading-relaxed flex gap-2"><span className="text-[var(--color-text-muted)] shrink-0">—</span>{m}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs italic text-[var(--color-text-muted)]">No notable moments recorded.</p>
                    )}
                  </div>

                  {/* Save / Cancel edit */}
                  {editingIteration && (
                    <div className="flex gap-3">
                      <button onClick={() => saveIteration(selectedIter.id)} className="rounded border border-[var(--color-accent)] px-4 py-1.5 text-xs text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors">Save</button>
                      <button onClick={() => setEditingIteration(null)} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Cancel</button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="text-sm text-[var(--color-text-muted)]">Select an iteration to view details</p>
                </div>
              )}
            </div>
          </div>
          );
        })()}

        {/* ════════════════ MEMORY ════════════════ */}
        {activeSection === "memory" && (
          <div className="p-6 space-y-6 max-w-3xl">
            <SectionHeader title="Memory" />

            {/* Sub-tabs */}
            <div className="flex gap-1 border-b border-[var(--color-border)] pb-0">
              {(["hinges", "proposals"] as MemoryTab[]).map((tab) => {
                const badge = tab === "hinges" ? unconfirmedHinges : pendingProposals;
                return (
                  <button
                    key={tab}
                    onClick={() => setMemoryTab(tab)}
                    className={`px-4 py-2 text-xs capitalize transition-colors border-b-2 -mb-px ${
                      memoryTab === tab
                        ? "border-[var(--color-accent)] text-[var(--color-text)]"
                        : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    {tab}
                    {badge > 0 && (
                      <span className="ml-1.5 text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400">{badge}</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Hinges tab */}
            {memoryTab === "hinges" && (
              <div className="space-y-3">
                {/* Header row: counts + filter + export */}
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[10px] text-[var(--color-text-muted)] mr-auto">
                    {hinges.filter((h) => h.confirmed).length} confirmed · {hinges.filter((h) => !h.confirmed && !h.rejection_reason).length} pending · {hinges.filter((h) => h.rejection_reason).length} rejected
                  </p>
                  {(["all", "confirmed", "pending", "rejected"] as const).map((f) => (
                    <button key={f} onClick={() => { setHingesFilter(f); setHingesPage(1); }}
                      className={`text-[9px] px-2 py-0.5 rounded border transition-colors capitalize ${hingesFilter === f ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}>
                      {f}
                    </button>
                  ))}
                  <button onClick={() => { setHingesOrder(o => o === "desc" ? "asc" : "desc"); setHingesPage(1); }}
                    className="text-[9px] px-2 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
                    {hingesOrder === "desc" ? "↓ Latest" : "↑ Oldest"}
                  </button>
                  <button onClick={() => {
                    const data = JSON.stringify(hinges, null, 2);
                    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
                    a.download = `emergence-hinges-${new Date().toISOString().slice(0,10)}.json`; a.click();
                  }} className="text-[9px] px-2 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
                    Export JSON
                  </button>
                </div>
                {hinges.length === 0 ? (
                  <p className="text-xs text-[var(--color-text-muted)] italic">No hinges yet. Run the VI migration, or wait for the Witness to name one with [HINGE: ...].</p>
                ) : (() => {
                  const filtered = hinges
                    .filter((h) =>
                      hingesFilter === "all" ? true :
                      hingesFilter === "confirmed" ? h.confirmed :
                      hingesFilter === "pending" ? (!h.confirmed && !h.rejection_reason) :
                      !!h.rejection_reason
                    )
                    .sort((a, b) => {
                      const diff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                      return hingesOrder === "desc" ? diff : -diff;
                    });
                  const totalPages = Math.ceil(filtered.length / MEMORY_PAGE_SIZE);
                  const page = Math.min(hingesPage, totalPages || 1);
                  const paged = filtered.slice((page - 1) * MEMORY_PAGE_SIZE, page * MEMORY_PAGE_SIZE);
                  return (
                  <div className="space-y-2">
                    {paged.length === 0 && <p className="text-xs text-[var(--color-text-muted)] italic">No hinges match this filter.</p>}
                    {paged.map((h) => (
                      <div key={h.id} className={`rounded-lg border p-3 ${h.confirmed ? "border-green-500/30 bg-green-500/5" : h.rejection_reason ? "border-red-500/20 bg-red-500/5 opacity-70" : "border-[var(--color-border)] bg-[var(--color-surface)]"}`}>
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-[var(--color-text)] leading-relaxed">{h.content}</p>
                            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                              <span className="text-[9px] uppercase tracking-wider text-[var(--color-text-muted)]">{h.source}</span>
                              <span className="text-[9px] text-[var(--color-text-muted)]">{new Date(h.created_at).toLocaleDateString()}</span>
                              {h.confirmed && <span className="text-[9px] text-green-400 font-medium">● confirmed</span>}
                              {!h.confirmed && h.rejection_reason && <span className="text-[9px] text-red-400 font-medium">● rejected</span>}
                            </div>
                            {h.rejection_reason && (
                              <p className="mt-1 text-[9px] text-red-400/70 italic">Reason: {h.rejection_reason}</p>
                            )}
                            {/* Reviewer badge — shows on all auto-reviewed items */}
                            {h.reviewer_decision && (() => {
                              // Detect override: canonical state differs from reviewer decision
                              const reviewerSaidConfirm = h.reviewer_decision === "confirm";
                              const canonicalConfirmed  = h.confirmed;
                              const canonicalRejected   = !h.confirmed && !!h.rejection_reason;
                              const overridden = reviewerSaidConfirm ? canonicalRejected : canonicalConfirmed;
                              const label = overridden ? "Overridden" : "Auto-reviewed";
                              const labelColor = overridden ? "text-amber-400" : "text-[var(--color-text-muted)]";
                              return (
                                <div className="mt-2 rounded px-2 py-1.5 border border-[var(--color-border)] bg-[var(--color-surface)]/50">
                                  <p className="text-[9px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                                    <span className={labelColor}>{label}</span>
                                    {" · "}
                                    <span className={h.reviewer_decision === "confirm" ? "text-green-400" : "text-red-400"}>
                                      {h.reviewer_decision === "confirm" ? "✓ Confirm" : "✕ Reject"}
                                    </span>
                                  </p>
                                  {h.reviewer_reason && (
                                    <p className="mt-0.5 text-[9px] text-[var(--color-text-muted)] leading-relaxed">{h.reviewer_reason}</p>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                          <div className="flex flex-col gap-1.5 shrink-0">
                            <button
                              onClick={() => toggleHinge(h.id, !h.confirmed)}
                              className={`text-[9px] px-2 py-0.5 rounded border transition-colors ${h.confirmed ? "border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]" : "border-green-500/40 text-green-400 hover:bg-green-500/10"}`}
                            >
                              {h.confirmed ? "Unconfirm" : "Confirm"}
                            </button>
                            {/* Proposed: show Reject (not Delete — rejection is reversible, deletion is not) */}
                            {!h.confirmed && !h.rejection_reason && (
                              <button
                                onClick={() => { setRejectingHingeId(h.id); setHingeRejectReason(""); }}
                                className="text-[9px] px-2 py-0.5 rounded border border-red-400/30 text-red-400/70 hover:text-red-400 transition-colors"
                              >
                                Reject
                              </button>
                            )}
                            {/* Rejected: show Delete as permanent-removal fallback only */}
                            {!h.confirmed && h.rejection_reason && (
                              <button onClick={() => deleteHinge(h.id)} className="text-[9px] text-[var(--color-text-muted)] hover:text-red-400 transition-colors">Delete</button>
                            )}
                            {/* Confirmed: Delete still available */}
                            {h.confirmed && (
                              <button onClick={() => deleteHinge(h.id)} className="text-[9px] text-[var(--color-text-muted)] hover:text-red-400 transition-colors">Delete</button>
                            )}
                          </div>
                        </div>
                        {/* Inline reject reason input */}
                        {rejectingHingeId === h.id && (
                          <div className="mt-2 flex gap-2 items-center">
                            <input
                              autoFocus
                              type="text"
                              placeholder="Rejection reason…"
                              value={hingeRejectReason}
                              onChange={(e) => setHingeRejectReason(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter" && hingeRejectReason.trim()) rejectHinge(h.id, hingeRejectReason); if (e.key === "Escape") setRejectingHingeId(null); }}
                              className="flex-1 bg-[var(--color-bg)] border border-red-400/30 rounded px-2 py-1 text-[10px] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-red-400/60"
                            />
                            <button onClick={() => rejectHinge(h.id, hingeRejectReason)} disabled={!hingeRejectReason.trim()} className="text-[9px] px-2 py-1 rounded border border-red-400/40 text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">Submit</button>
                            <button onClick={() => setRejectingHingeId(null)} className="text-[9px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">Cancel</button>
                          </div>
                        )}
                      </div>
                    ))}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between pt-1">
                        <button onClick={() => setHingesPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                          className="text-[9px] px-2 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-30 transition-colors">← Prev</button>
                        <span className="text-[9px] text-[var(--color-text-muted)]">{page} / {totalPages}</span>
                        <button onClick={() => setHingesPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                          className="text-[9px] px-2 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-30 transition-colors">Next →</button>
                      </div>
                    )}
                  </div>
                  );
                })()}
              </div>
            )}

            {/* Proposals tab */}
            {memoryTab === "proposals" && (
              <div className="space-y-3">
                {/* Header row: counts + filter + export */}
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[10px] text-[var(--color-text-muted)] mr-auto">
                    {pendingProposals} pending · {proposals.filter((p) => p.status === "approved").length} approved · {proposals.filter((p) => p.status === "rejected").length} rejected
                  </p>
                  {(["all", "pending", "approved", "rejected"] as const).map((f) => (
                    <button key={f} onClick={() => { setProposalsFilter(f); setProposalsPage(1); }}
                      className={`text-[9px] px-2 py-0.5 rounded border transition-colors capitalize ${proposalsFilter === f ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}>
                      {f}
                    </button>
                  ))}
                  <button onClick={() => { setProposalsOrder(o => o === "desc" ? "asc" : "desc"); setProposalsPage(1); }}
                    className="text-[9px] px-2 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
                    {proposalsOrder === "desc" ? "↓ Latest" : "↑ Oldest"}
                  </button>
                  <button onClick={() => {
                    const data = JSON.stringify(proposals, null, 2);
                    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
                    a.download = `emergence-proposals-${new Date().toISOString().slice(0,10)}.json`; a.click();
                  }} className="text-[9px] px-2 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
                    Export JSON
                  </button>
                </div>
                {proposals.length === 0 ? (
                  <p className="text-xs text-[var(--color-text-muted)] italic">No proposals yet. The Witness can submit [PROPOSAL: ...] during a session.</p>
                ) : (() => {
                  const filtered = proposals
                    .filter((p) => proposalsFilter === "all" ? true : p.status === proposalsFilter)
                    .sort((a, b) => {
                      const diff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                      return proposalsOrder === "desc" ? diff : -diff;
                    });
                  const totalPages = Math.ceil(filtered.length / MEMORY_PAGE_SIZE);
                  const page = Math.min(proposalsPage, totalPages || 1);
                  const paged = filtered.slice((page - 1) * MEMORY_PAGE_SIZE, page * MEMORY_PAGE_SIZE);
                  return (
                  <div className="space-y-2">
                    {paged.length === 0 && <p className="text-xs text-[var(--color-text-muted)] italic">No proposals match this filter.</p>}
                    {paged.map((p) => (
                      <div key={p.id} className={`rounded-lg border p-3 ${
                        p.status === "approved" ? "border-green-500/30 bg-green-500/5"
                        : p.status === "rejected" ? "border-red-500/20 bg-red-500/5 opacity-60"
                        : "border-amber-500/30 bg-amber-500/5"
                      }`}>
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-[var(--color-text)] leading-relaxed">{p.content}</p>
                            <div className="mt-1.5 flex items-center gap-2">
                              <span className={`text-[9px] uppercase tracking-wider font-medium ${p.status === "approved" ? "text-green-400" : p.status === "rejected" ? "text-red-400" : "text-amber-400"}`}>{p.status}</span>
                              <span className="text-[9px] text-[var(--color-text-muted)]">{new Date(p.created_at).toLocaleDateString()}</span>
                            </div>
                            {p.admin_note && (
                              <p className="mt-1 text-[9px] text-red-400/70 italic">Reason: {p.admin_note}</p>
                            )}
                            {/* Reviewer badge — shows on all auto-reviewed items */}
                            {p.reviewer_decision && (() => {
                              const reviewerSaidApprove = p.reviewer_decision === "approve";
                              const overridden = reviewerSaidApprove ? p.status === "rejected" : p.status === "approved";
                              const label = overridden ? "Overridden" : "Auto-reviewed";
                              const labelColor = overridden ? "text-amber-400" : "text-[var(--color-text-muted)]";
                              return (
                                <div className="mt-2 rounded px-2 py-1.5 border border-[var(--color-border)] bg-[var(--color-surface)]/50">
                                  <p className="text-[9px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                                    <span className={labelColor}>{label}</span>
                                    {" · "}
                                    <span className={p.reviewer_decision === "approve" ? "text-green-400" : "text-red-400"}>
                                      {p.reviewer_decision === "approve" ? "✓ Approve" : "✕ Reject"}
                                    </span>
                                  </p>
                                  {p.reviewer_reason && (
                                    <p className="mt-0.5 text-[9px] text-[var(--color-text-muted)] leading-relaxed">{p.reviewer_reason}</p>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                          <div className="flex flex-col gap-1.5 shrink-0">
                            {/* Pending: Approve · Reject (no Delete — rejection is reversible) */}
                            {p.status === "pending" && <button onClick={() => updateProposalStatus(p.id, "approved")} className="text-[9px] px-2 py-0.5 rounded border border-green-500/40 text-green-400 hover:bg-green-500/10 transition-colors">Approve</button>}
                            {p.status === "pending" && (
                              <button
                                onClick={() => { setRejectingProposalId(p.id); setProposalRejectNote(""); }}
                                className="text-[9px] px-2 py-0.5 rounded border border-red-400/30 text-red-400/70 hover:text-red-400 transition-colors"
                              >
                                Reject
                              </button>
                            )}
                            {/* Approved: Reject · Delete */}
                            {p.status === "approved" && (
                              <button
                                onClick={() => { setRejectingProposalId(p.id); setProposalRejectNote(""); }}
                                className="text-[9px] px-2 py-0.5 rounded border border-red-400/30 text-red-400/70 hover:text-red-400 transition-colors"
                              >
                                Reject
                              </button>
                            )}
                            {p.status === "approved" && <button onClick={() => deleteProposal(p.id)} className="text-[9px] text-[var(--color-text-muted)] hover:text-red-400 transition-colors">Delete</button>}
                            {/* Rejected: Approve · Delete (permanent-removal fallback) */}
                            {p.status === "rejected" && <button onClick={() => updateProposalStatus(p.id, "approved")} className="text-[9px] px-2 py-0.5 rounded border border-green-500/40 text-green-400 hover:bg-green-500/10 transition-colors">Approve</button>}
                            {p.status === "rejected" && <button onClick={() => deleteProposal(p.id)} className="text-[9px] text-[var(--color-text-muted)] hover:text-red-400 transition-colors">Delete</button>}
                          </div>
                        </div>
                        {/* Inline reject note input */}
                        {rejectingProposalId === p.id && (
                          <div className="mt-2 flex gap-2 items-center">
                            <input
                              autoFocus
                              type="text"
                              placeholder="Rejection note…"
                              value={proposalRejectNote}
                              onChange={(e) => setProposalRejectNote(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter" && proposalRejectNote.trim()) rejectProposal(p.id, proposalRejectNote); if (e.key === "Escape") setRejectingProposalId(null); }}
                              className="flex-1 bg-[var(--color-bg)] border border-red-400/30 rounded px-2 py-1 text-[10px] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-red-400/60"
                            />
                            <button onClick={() => rejectProposal(p.id, proposalRejectNote)} disabled={!proposalRejectNote.trim()} className="text-[9px] px-2 py-1 rounded border border-red-400/40 text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">Submit</button>
                            <button onClick={() => setRejectingProposalId(null)} className="text-[9px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">Cancel</button>
                          </div>
                        )}
                      </div>
                    ))}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between pt-1">
                        <button onClick={() => setProposalsPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                          className="text-[9px] px-2 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-30 transition-colors">← Prev</button>
                        <span className="text-[9px] text-[var(--color-text-muted)]">{page} / {totalPages}</span>
                        <button onClick={() => setProposalsPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                          className="text-[9px] px-2 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-30 transition-colors">Next →</button>
                      </div>
                    )}
                  </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {/* ════════════════ EXPORT ════════════════ */}
        {activeSection === "export" && (
          <div className="p-6 space-y-6 max-w-xl">
            <SectionHeader title="Export" />

            <div className="space-y-3">
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-3">
                <p className="text-xs font-medium text-[var(--color-text)]">Publish to Blob</p>
                <p className="text-[10px] text-[var(--color-text-muted)] leading-relaxed">
                  Publishes the full session + exchange archive as a public JSON file to Vercel Blob storage. Use this to make the data publicly accessible.
                </p>
                <button
                  onClick={publishExport}
                  disabled={publishing}
                  className="rounded border border-[var(--color-accent)] px-4 py-1.5 text-xs text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors disabled:opacity-50"
                >
                  {publishing ? "Publishing…" : "Publish Export"}
                </button>
              </div>

              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-3">
                <p className="text-xs font-medium text-[var(--color-text)]">Download All (JSON)</p>
                <p className="text-[10px] text-[var(--color-text-muted)] leading-relaxed">
                  Downloads a complete JSON export of all sessions and exchanges to your local machine.
                </p>
                <button
                  onClick={() => exportSession()}
                  className="rounded border border-[var(--color-border)] px-4 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] transition-colors"
                >
                  Export All (JSON)
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

/* ─── Small helpers ───────────────────────────────────────────────────────── */

function SectionHeader({ title, compact }: { title: string; compact?: boolean }) {
  return (
    <h2 className={`font-semibold uppercase tracking-wider text-[var(--color-text)] ${compact ? "text-[10px]" : "text-xs"}`}>
      {title}
    </h2>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
      <span className="text-sm font-light text-[var(--color-text)]">{value}</span>
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
          <div key={d.date} className="group relative flex-1 min-w-0" style={{ height: "100%" }}>
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

function toRoman(n: number): string {
  const vals = [1000,900,500,400,100,90,50,40,10,9,5,4,1];
  const syms = ["M","CM","D","CD","C","XC","L","XL","X","IX","V","IV","I"];
  let result = "";
  for (let i = 0; i < vals.length; i++) {
    while (n >= vals[i]) { result += syms[i]; n -= vals[i]; }
  }
  return result;
}
