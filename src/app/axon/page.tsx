"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { AXON_AGENTS, type AxonRole } from "@/lib/axon-agents";
import { renderContent } from "@/components/ExchangeBubble";

/** Render markdown text with paragraph/line-break support */
function renderMarkdown(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => (
    <span key={i}>
      {renderContent(line)}
      {i < lines.length - 1 && <br />}
    </span>
  ));
}

interface AxonExchange {
  agent: AxonRole;
  content: string;
  exchange_number: number;
  skipped: boolean;
}

type PageState = "gate" | "input" | "running" | "result";

const EXAMPLE_TASKS = [
  "What is 1+1?",
  "What is real?",
  "Find patterns in Fibonacci stopping times",
];

const REVEAL_DELAY_MIN = 2500;
const REVEAL_DELAY_MAX = 5000;

function randomDelay() {
  return REVEAL_DELAY_MIN + Math.random() * (REVEAL_DELAY_MAX - REVEAL_DELAY_MIN);
}

export default function AxonPage() {
  const [state, setState] = useState<PageState>("gate");
  const [authChecked, setAuthChecked] = useState(false);

  // Gate state
  const [tokenInput, setTokenInput] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // Input state
  const [taskInput, setTaskInput] = useState("");

  // Running + result state
  const [allExchanges, setAllExchanges] = useState<AxonExchange[]>([]);
  const [visibleExchanges, setVisibleExchanges] = useState<AxonExchange[]>([]);
  const [decision, setDecision] = useState<"EXEC" | "PASS" | null>(null);
  const [resultContent, setResultContent] = useState("");
  const [showTyping, setShowTyping] = useState(false);
  const [submittedTask, setSubmittedTask] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);
  const revealTimer = useRef<NodeJS.Timeout | null>(null);
  const revealIndex = useRef(0);

  // Check auth on mount
  useEffect(() => {
    fetch("/api/axon/auth")
      .then((r) => r.json())
      .then((data) => {
        if (data.authenticated) setState("input");
      })
      .catch(() => {})
      .finally(() => setAuthChecked(true));
  }, []);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visibleExchanges.length, showTyping, decision]);

  // Reveal exchanges one by one
  const revealNext = useCallback((exchanges: AxonExchange[]) => {
    const idx = revealIndex.current;
    if (idx >= exchanges.length) {
      setShowTyping(false);
      return;
    }

    const next = exchanges[idx];

    if (next.skipped) {
      revealTimer.current = setTimeout(() => {
        revealIndex.current = idx + 1;
        setVisibleExchanges((prev) => [...prev, next]);
        revealNext(exchanges);
      }, 800);
      return;
    }

    setShowTyping(true);
    const delay = randomDelay();
    revealTimer.current = setTimeout(() => {
      revealIndex.current = idx + 1;
      setShowTyping(false);
      setVisibleExchanges((prev) => [...prev, next]);
      revealNext(exchanges);
    }, delay);
  }, []);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);
    try {
      const res = await fetch("/api/axon/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenInput }),
      });
      if (res.ok) {
        setState("input");
      } else {
        setAuthError("Invalid token.");
      }
    } catch {
      setAuthError("Connection error. Try again.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRun = async (task: string) => {
    if (!task.trim()) return;

    const taskText = task.trim();
    setSubmittedTask(taskText);
    setTaskInput("");
    setAllExchanges([]);
    setVisibleExchanges([]);
    setDecision(null);
    setResultContent("");
    setShowTyping(true);
    revealIndex.current = 0;
    if (revealTimer.current) clearTimeout(revealTimer.current);

    setState("running");

    try {
      const res = await fetch("/api/axon/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: taskText }),
      });

      if (res.status === 401) {
        setState("gate");
        return;
      }

      if (!res.ok) {
        setState("input");
        setTaskInput(taskText);
        return;
      }

      const data = await res.json();
      const exchanges: AxonExchange[] = data.exchanges || [];
      setAllExchanges(exchanges);
      setDecision(data.decision);
      setResultContent(data.content);
      setShowTyping(false);

      // Start revealing exchanges with animation
      setState("result");
      revealIndex.current = 0;
      setVisibleExchanges([]);
      revealNext(exchanges);
    } catch {
      setState("input");
      setTaskInput(taskText);
    }
  };

  const handleRunAnother = () => {
    if (revealTimer.current) clearTimeout(revealTimer.current);
    revealIndex.current = 0;
    setVisibleExchanges([]);
    setAllExchanges([]);
    setDecision(null);
    setResultContent("");
    setShowTyping(false);
    setState("input");
  };

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-1.5 w-1.5 rounded-full bg-[var(--color-text-muted)] animate-pulse" />
      </div>
    );
  }

  // STATE 1 — Beta gate
  if (state === "gate") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-2 text-center">
            <h1 className="text-2xl font-light tracking-[0.15em] text-[var(--color-text)]">
              AXON
            </h1>
            <p className="text-xs text-[var(--color-text-muted)]">
              Multi-agent epistemic decision system
            </p>
          </div>

          <form onSubmit={handleAuth} className="space-y-3">
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Beta access token"
              className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent)] transition-colors"
              autoFocus
            />
            {authError && (
              <p className="text-xs text-red-400">{authError}</p>
            )}
            <button
              type="submit"
              disabled={authLoading || !tokenInput}
              className="w-full rounded border border-[var(--color-accent)] px-4 py-2.5 text-sm text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {authLoading ? "Verifying..." : "Enter"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // STATE 2 — Input form
  if (state === "input") {
    return (
      <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
        <header className="border-b border-[var(--color-border)] px-6 py-4">
          <div className="mx-auto flex max-w-2xl items-baseline gap-3">
            <span className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--color-text)]">
              AXON
            </span>
            <span className="text-[10px] text-[var(--color-text-muted)]">
              EpistemicGate · Beta
            </span>
          </div>
        </header>

        <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12 space-y-8">
          <div className="space-y-2">
            <h2 className="text-lg font-light text-[var(--color-text)]">
              Enter a task or question
            </h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              AXON reasons until it reaches a decision or admits it doesn&apos;t know
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleRun(taskInput);
            }}
            className="space-y-4"
          >
            <textarea
              value={taskInput}
              onChange={(e) => setTaskInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleRun(taskInput);
                }
              }}
              placeholder="What should AXON reason about?"
              rows={4}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent)] transition-colors resize-none"
              autoFocus
            />

            <div className="flex flex-wrap gap-2">
              {EXAMPLE_TASKS.map((task) => (
                <button
                  key={task}
                  type="button"
                  onClick={() => handleRun(task)}
                  className="rounded-full border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors"
                >
                  {task}
                </button>
              ))}
            </div>

            <button
              type="submit"
              disabled={!taskInput.trim()}
              className="rounded border border-[var(--color-accent)] px-6 py-2.5 text-sm text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Run AXON
            </button>
          </form>
        </main>
      </div>
    );
  }

  // STATE 3 — Running + Result
  const isRunning = state === "running";
  const nextAgent: AxonRole =
    visibleExchanges.length > 0
      ? (["explorer", "validator", "monitor", "resolver"][
          visibleExchanges.length % 4
        ] as AxonRole)
      : "explorer";

  const allRevealed =
    !isRunning &&
    !showTyping &&
    visibleExchanges.length === allExchanges.length;

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
      <header className="border-b border-[var(--color-border)] px-6 py-4">
        <div className="mx-auto flex max-w-2xl items-baseline gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--color-text)]">
            AXON
          </span>
          <span className="text-[10px] text-[var(--color-text-muted)]">
            EpistemicGate · Beta
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 space-y-6">
        {/* Task display */}
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
          <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
            Task
          </p>
          <p className="text-sm text-[var(--color-text)]">{submittedTask}</p>
        </div>

        {/* Exchanges */}
        <div className="space-y-2">
          {visibleExchanges.map((exchange) => (
            <AxonBubble key={exchange.exchange_number} exchange={exchange} />
          ))}
        </div>

        {/* Typing indicator */}
        {showTyping && (
          <AxonTypingIndicator
            agent={isRunning ? "explorer" : nextAgent}
            isRunning={isRunning}
          />
        )}

        {/* Verdict card */}
        {allRevealed && decision && (
          <VerdictCard decision={decision} content={resultContent} />
        )}

        {/* Run another */}
        {allRevealed && decision && (
          <div className="flex justify-center pt-4">
            <button
              onClick={handleRunAnother}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
            >
              ← Run another
            </button>
          </div>
        )}

        <div ref={bottomRef} />
      </main>
    </div>
  );
}

function AxonBubble({ exchange }: { exchange: AxonExchange }) {
  const agent = AXON_AGENTS[exchange.agent];

  if (exchange.skipped) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: agent.color }}
        >
          {agent.name}
        </span>
        <span className="text-[10px] text-[var(--color-text-muted)] italic">
          chose silence
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 px-2">
        <span
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: agent.color }}
        >
          {agent.name}
        </span>
        <span className="text-[10px] text-[var(--color-text-muted)]">
          #{exchange.exchange_number + 1}
        </span>
      </div>
      <div
        className="mx-2 rounded-lg border px-4 py-3"
        style={{ borderColor: agent.color + "33" }}
      >
        <p className="text-sm leading-relaxed text-[var(--color-text)]">
          {renderMarkdown(exchange.content)}
        </p>
      </div>
    </div>
  );
}

function AxonTypingIndicator({
  agent,
  isRunning,
}: {
  agent: AxonRole;
  isRunning: boolean;
}) {
  const agentInfo = AXON_AGENTS[agent];

  if (isRunning) {
    return (
      <div className="flex items-center gap-3 px-2 py-3">
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full animate-pulse"
              style={{
                backgroundColor: "var(--color-text-muted)",
                animationDelay: `${i * 150}ms`,
              }}
            />
          ))}
        </div>
        <span className="text-xs text-[var(--color-text-muted)]">
          AXON is reasoning...
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-2 py-2">
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full animate-pulse"
            style={{
              backgroundColor: agentInfo.color,
              animationDelay: `${i * 150}ms`,
            }}
          />
        ))}
      </div>
      <span
        className="text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: agentInfo.color }}
      >
        {agentInfo.name}
      </span>
      <span className="text-[10px] text-[var(--color-text-muted)]">
        is thinking...
      </span>
    </div>
  );
}

function VerdictCard({
  decision,
  content,
}: {
  decision: "EXEC" | "PASS";
  content: string;
}) {
  const isExec = decision === "EXEC";

  return (
    <div
      className="rounded-xl border-2 p-6 space-y-4"
      style={{
        borderColor: isExec ? "#2e7d6a" : "#8a6a00",
        backgroundColor: isExec ? "#2e7d6a0d" : "#8a6a000d",
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: isExec ? "#2e7d6a" : "#8a6a00" }}
        />
        <span
          className="text-xs font-semibold uppercase tracking-[0.2em]"
          style={{ color: isExec ? "#2e7d6a" : "#8a6a00" }}
        >
          {isExec ? "VERDICT: EXEC" : "VERDICT: PASS"}
        </span>
      </div>

      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
          {isExec ? "Answer" : "Finding"}
        </p>
        <p className="text-sm leading-relaxed text-[var(--color-text)]">
          {renderMarkdown(content)}
        </p>
      </div>

      {!isExec && (
        <p className="text-[10px] text-[var(--color-text-muted)] border-t border-[var(--color-border)] pt-3">
          Insufficient confidence to execute — the agents established what they
          could but could not reach a reliable conclusion.
        </p>
      )}
    </div>
  );
}
