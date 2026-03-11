"use client";

import { useEffect, useState, useCallback } from "react";
import { AGENTS, type AgentRole } from "@/lib/agents";

interface Session {
  id: string;
  created_at: string;
  completed_at: string | null;
  status: string;
  seed_thread: string | null;
  extracted_thread: string | null;
  exchange_count: number;
  is_baseline: boolean;
}

interface Exchange {
  id: string;
  exchange_number: number;
  agent: AgentRole;
  model: string;
  content: string;
  created_at: string;
}

export default function AdminPage() {
  const [secret, setSecret] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [annotationNote, setAnnotationNote] = useState("");

  const fetchSessions = useCallback(async () => {
    const res = await fetch(`/api/admin/sessions?secret=${secret}`);
    if (res.ok) {
      const data = await res.json();
      setSessions(data.sessions);
      setAuthenticated(true);
    } else {
      alert("Invalid admin secret");
    }
  }, [secret]);

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
              onClick={() => exportSession()}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
            >
              Export All (JSON)
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
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
                      {s.extracted_thread}
                    </p>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Exchange detail */}
          <div className="lg:col-span-2">
            {selectedSession ? (
              <div>
                <div className="mb-4 flex items-center gap-3">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                    Exchanges
                  </h2>
                  {sessions.find((s) => s.id === selectedSession)?.status ===
                    "active" && (
                    <>
                      <button
                        onClick={() =>
                          handleSessionAction(selectedSession, "pause")
                        }
                        className="text-[10px] text-amber-400 hover:underline"
                      >
                        Pause
                      </button>
                      <button
                        onClick={() =>
                          handleSessionAction(selectedSession, "end")
                        }
                        className="text-[10px] text-red-400 hover:underline"
                      >
                        End
                      </button>
                    </>
                  )}
                  {sessions.find((s) => s.id === selectedSession)?.status ===
                    "paused" && (
                    <button
                      onClick={() =>
                        handleSessionAction(selectedSession, "resume")
                      }
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

                <div className="space-y-3 max-h-[75vh] overflow-y-auto">
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
                          {e.content}
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
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-[var(--color-text-muted)]">
                Select a session to view exchanges
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
