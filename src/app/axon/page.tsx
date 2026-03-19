"use client";

import React, { useEffect, useRef, useState } from "react";
import { AXON_AGENTS, AXON_TURN_ORDER, type AxonRole } from "@/lib/axon-agents";
import { renderContent } from "@/components/ExchangeBubble";

const IS_TABLE_ROW = /^\|.+\|/;
const IS_TABLE_SEP = /^\|[-:| ]+\|$/;
const IS_RULE = /^[-*_]{3,}$/;

/** Render markdown — headings, lists, tables, blockquotes, rules, inline bold/italic */
function renderMarkdown(text: string) {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Table block — collect consecutive pipe-rows
    if (IS_TABLE_ROW.test(line)) {
      const tableLines: string[] = [];
      while (i < lines.length && IS_TABLE_ROW.test(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }
      const dataRows = tableLines
        .filter((l) => !IS_TABLE_SEP.test(l.trim()))
        .map((l) =>
          l
            .split("|")
            .slice(1, -1)
            .map((c) => c.trim())
        );
      if (dataRows.length > 0) {
        const header = dataRows[0];
        const body = dataRows.slice(1);
        nodes.push(
          <div key={key++} className="overflow-x-auto my-2">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  {header.map((cell, j) => (
                    <th
                      key={j}
                      className="px-3 py-1.5 text-left font-semibold border border-[var(--color-border)] text-[var(--color-text-muted)] bg-[var(--color-surface)]"
                    >
                      {renderContent(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className="px-3 py-1.5 border border-[var(--color-border)] text-[var(--color-text)]"
                      >
                        {renderContent(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      nodes.push(
        <div
          key={key++}
          className="border-l-2 border-[var(--color-accent)] pl-3 my-1 italic text-[var(--color-text-muted)]"
        >
          {renderContent(line.slice(2))}
        </div>
      );
      i++;
      continue;
    }

    // Math block $$...$$  (render as mono code — no LaTeX renderer)
    if (line.trim().startsWith("$$")) {
      const math = line.trim().replace(/^\$\$/, "").replace(/\$\$$/, "").trim();
      if (math) {
        nodes.push(
          <div
            key={key++}
            className="font-mono text-xs bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-3 py-1.5 my-1 text-[var(--color-text)]"
          >
            {math}
          </div>
        );
      }
      i++;
      continue;
    }

    // Heading ##
    if (/^#{1,3} /.test(line)) {
      nodes.push(
        <p key={key++} className="font-semibold text-[var(--color-text)] mt-3 mb-0.5">
          {renderContent(line.replace(/^#{1,3} /, ""))}
        </p>
      );
      i++;
      continue;
    }

    // Horizontal rule ---
    if (IS_RULE.test(line.trim())) {
      nodes.push(<hr key={key++} className="border-[var(--color-border)] my-3" />);
      i++;
      continue;
    }

    // Numbered list  1. item
    if (/^\d+\. /.test(line)) {
      const num = line.match(/^(\d+)\. /)?.[1];
      const content = line.replace(/^\d+\. /, "");
      nodes.push(
        <div key={key++} className="flex gap-2 leading-relaxed">
          <span className="text-[var(--color-text-muted)] shrink-0 select-none tabular-nums">
            {num}.
          </span>
          <span>{renderContent(content)}</span>
        </div>
      );
      i++;
      continue;
    }

    // Unordered list  - item
    if (/^[-*] /.test(line)) {
      nodes.push(
        <div key={key++} className="flex gap-2 leading-relaxed">
          <span className="text-[var(--color-text-muted)] shrink-0 select-none">–</span>
          <span>{renderContent(line.replace(/^[-*] /, ""))}</span>
        </div>
      );
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      nodes.push(<div key={key++} className="h-2" />);
      i++;
      continue;
    }

    // Regular text
    nodes.push(
      <span key={key++} className="block leading-relaxed">
        {renderContent(line)}
      </span>
    );
    i++;
  }

  return nodes;
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

export default function AxonPage() {
  const [state, setState] = useState<PageState>("gate");
  const [authChecked, setAuthChecked] = useState(false);

  // Gate
  const [tokenInput, setTokenInput] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // Input
  const [taskInput, setTaskInput] = useState("");

  // Running / result
  const [submittedTask, setSubmittedTask] = useState("");
  const [visibleExchanges, setVisibleExchanges] = useState<AxonExchange[]>([]);
  const [showTyping, setShowTyping] = useState(false);
  const [typingAgent, setTypingAgent] = useState<AxonRole>("explorer");
  const [decision, setDecision] = useState<"EXEC" | "PASS" | null>(null);
  const [resultContent, setResultContent] = useState("");
  const [runError, setRunError] = useState("");
  const [reasoningCollapsed, setReasoningCollapsed] = useState(false);

  const [elapsedSeconds, setElapsedSeconds] = useState<number | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const stopPolling = useRef(false);
  const runStartTime = useRef<number>(0);

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling.current = true;
    };
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
    setVisibleExchanges([]);
    setDecision(null);
    setResultContent("");
    setRunError("");
    setShowTyping(false);
    setReasoningCollapsed(false);
    setElapsedSeconds(null);
    stopPolling.current = false;
    runStartTime.current = Date.now();

    setState("running");

    // Step 1: create the request
    let requestId: string;
    try {
      const res = await fetch("/api/axon/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: taskText }),
      });
      if (res.status === 401) { setState("gate"); return; }
      if (!res.ok) { setRunError("Failed to start. Try again."); setState("input"); setTaskInput(taskText); return; }
      const data = await res.json();
      requestId = data.requestId;
    } catch {
      setRunError("Connection error. Try again.");
      setState("input");
      setTaskInput(taskText);
      return;
    }

    // Step 2: poll — each call runs one exchange
    let exchangeCount = 0;
    while (!stopPolling.current) {
      const nextRole = AXON_TURN_ORDER[exchangeCount % AXON_TURN_ORDER.length];
      setTypingAgent(nextRole);
      setShowTyping(true);

      let data: {
        done: boolean;
        exchange?: AxonExchange;
        decision?: "EXEC" | "PASS";
        content?: string;
      };

      try {
        const res = await fetch(`/api/axon/process?request_id=${requestId}`);
        if (!res.ok) {
          setRunError("Engine error. Try again.");
          setState("input");
          setTaskInput(taskText);
          return;
        }
        data = await res.json();
      } catch {
        setRunError("Connection lost. Try again.");
        setState("input");
        setTaskInput(taskText);
        return;
      }

      setShowTyping(false);

      if (data.exchange) {
        // Brief pause for the reveal animation
        await new Promise((r) => setTimeout(r, 300));
        setVisibleExchanges((prev) => [...prev, data.exchange!]);
        exchangeCount++;
      }

      if (data.done) {
        setDecision(data.decision ?? null);
        setResultContent(data.content ?? "");
        setElapsedSeconds(Math.round((Date.now() - runStartTime.current) / 1000));
        setState("result");
        break;
      }

      // Tiny gap before next exchange
      await new Promise((r) => setTimeout(r, 400));
    }
  };

  const handleRunAnother = () => {
    stopPolling.current = true;
    setVisibleExchanges([]);
    setDecision(null);
    setResultContent("");
    setShowTyping(false);
    setReasoningCollapsed(false);
    setElapsedSeconds(null);
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
            {authError && <p className="text-xs text-red-400">{authError}</p>}
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

          {runError && (
            <p className="text-xs text-red-400">{runError}</p>
          )}

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

  // STATE 3 — Running + Result (shared layout)
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

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 space-y-4">
        {/* Task */}
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
          <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
            Task
          </p>
          <p className="text-sm text-[var(--color-text)]">{submittedTask}</p>
        </div>

        {/* Collapse toggle — only shown once verdict is ready */}
        {state === "result" && decision && (
          <button
            onClick={() => setReasoningCollapsed((c) => !c)}
            className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors select-none"
          >
            <span
              className="inline-block transition-transform duration-200"
              style={{ transform: reasoningCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
            >
              ▾
            </span>
            {reasoningCollapsed
              ? `Show reasoning (${visibleExchanges.length} exchange${visibleExchanges.length !== 1 ? "s" : ""})`
              : "Collapse reasoning"}
          </button>
        )}

        {/* Exchange stream — hidden when collapsed */}
        {!reasoningCollapsed && (
          <>
            <div className="space-y-2">
              {visibleExchanges.map((exchange) => (
                <AxonBubble key={exchange.exchange_number} exchange={exchange} />
              ))}
            </div>

            {/* Typing indicator — shows while LLM is actually thinking */}
            {showTyping && <AxonTypingIndicator agent={typingAgent} />}
          </>
        )}

        {/* Verdict */}
        {state === "result" && decision && (
          <VerdictCard
            decision={decision}
            content={resultContent}
            elapsedSeconds={elapsedSeconds}
            exchangeCount={visibleExchanges.length}
          />
        )}

        {/* Run another */}
        {state === "result" && decision && (
          <div className="flex justify-center pt-4 pb-8">
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

function AxonTypingIndicator({ agent }: { agent: AxonRole }) {
  const agentInfo = AXON_AGENTS[agent];

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
  elapsedSeconds,
  exchangeCount,
}: {
  decision: "EXEC" | "PASS";
  content: string;
  elapsedSeconds: number | null;
  exchangeCount: number;
}) {
  const isExec = decision === "EXEC";

  const meta = [
    elapsedSeconds !== null && `${elapsedSeconds}s`,
    exchangeCount > 0 && `${exchangeCount} exchange${exchangeCount !== 1 ? "s" : ""}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="rounded-xl border-2 p-6 space-y-4"
      style={{
        borderColor: isExec ? "#2e7d6a" : "#8a6a00",
        backgroundColor: isExec ? "#2e7d6a0d" : "#8a6a000d",
      }}
    >
      <div className="flex items-center justify-between gap-3">
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
        {meta && (
          <span className="text-[10px] text-[var(--color-text-muted)] tabular-nums">
            {meta}
          </span>
        )}
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
