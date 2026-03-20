"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
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

// ─── Types ───────────────────────────────────────────────────────────────────

interface AxonExchange {
  agent: AxonRole;
  content: string;
  exchange_number: number;
  skipped: boolean;
  turn_number?: number;
  streaming?: boolean;
}

interface CompletedTurn {
  turnNumber: number;
  userInput: string;
  exchanges: AxonExchange[];
  decision: "EXEC" | "PASS";
  content: string;
  elapsedSeconds: number | null;
}

type PageState = "gate" | "input" | "running" | "result";
type ContextTab = "file" | "text";

interface ContextFile {
  name: string;
  type: string;
  data: string; // base64
  size: number;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB — images
const MAX_PDF_BYTES = 200 * 1024;        // 200 KB — client-side gate before server extraction
const MAX_TEXT_CHARS = 8000;             // ~2k tokens — paste text budget
const ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"];

const EXAMPLE_TASKS = [
  "What is 1+1?",
  "What is real?",
  "Find patterns in Fibonacci stopping times",
  "Analyse this contract",
  "Debug my reasoning",
  "Find the flaw in this argument",
];

// ─── Page ────────────────────────────────────────────────────────────────────

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

  // Conversation
  const [requestId, setRequestId] = useState<string | null>(null);
  const [currentTurnNumber, setCurrentTurnNumber] = useState(0);
  const [completedTurns, setCompletedTurns] = useState<CompletedTurn[]>([]);
  const [followUpInput, setFollowUpInput] = useState("");
  const [continueLoading, setContinueLoading] = useState(false);
  const [sessionStartTime] = useState(() => Date.now());
  const [originalTask, setOriginalTask] = useState("");

  // Context state
  const [contextTab, setContextTab] = useState<ContextTab>("file");
  const [contextFile, setContextFile] = useState<ContextFile | null>(null);
  const [contextText, setContextText] = useState("");
  const [contextFileError, setContextFileError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [pdfExtracting, setPdfExtracting] = useState(false);
  const [pdfExtractedFrom, setPdfExtractedFrom] = useState<string | null>(null);
  // Snapshot of context at run time (to show in running/result state)
  const [submittedContextFile, setSubmittedContextFile] = useState<ContextFile | null>(null);
  const [submittedContextText, setSubmittedContextText] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);
  const stopPolling = useRef(false);
  const runStartTime = useRef<number>(0);

  // Check auth on mount + check for ?session= URL param for restoration
  useEffect(() => {
    fetch("/api/axon/auth")
      .then((r) => r.json())
      .then(async (data) => {
        if (data.authenticated) {
          setState("input");
          // Check for session param
          const params = new URLSearchParams(window.location.search);
          const sessionId = params.get("session");
          if (sessionId) {
            await restoreSession(sessionId);
          }
        }
      })
      .catch(() => {})
      .finally(() => setAuthChecked(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Restore a session from URL param
  const restoreSession = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/axon/status?request_id=${sessionId}`);
      if (!res.ok) return;
      const data = await res.json();

      // Only restore completed sessions
      if (data.status !== "complete") return;

      const prevTurns: CompletedTurn[] = (data.conversation_turns ?? []).map(
        (t: { turn: number; user_input: string; verdict: { decision: "EXEC" | "PASS"; content: string } }) => ({
          turnNumber: t.turn,
          userInput: t.user_input,
          exchanges: (data.exchanges as AxonExchange[]).filter(
            (ex) => ex.turn_number === t.turn
          ),
          decision: t.verdict.decision,
          content: t.verdict.content,
          elapsedSeconds: null,
        })
      );

      const currentTurn = data.current_turn ?? 0;
      const currentExchanges = (data.exchanges as AxonExchange[]).filter(
        (ex) => (ex.turn_number ?? 0) === currentTurn
      );

      const firstTask = data.input_text as string;
      setOriginalTask(firstTask);
      setRequestId(sessionId);
      setCurrentTurnNumber(currentTurn);
      setCompletedTurns(prevTurns);
      setSubmittedTask(data.current_input ?? firstTask);
      setVisibleExchanges(currentExchanges);
      setDecision(data.decision);
      setResultContent(data.content ?? "");
      setState("result");

      // Update URL without duplicate push
      window.history.replaceState({}, "", `?session=${sessionId}`);
    } catch {
      // Silently fail — just start fresh
    }
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

  const handleFileSelect = async (file: File) => {
    setContextFileError("");
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setContextFileError("Unsupported file type. Use PDF, PNG, JPG, GIF, or WebP.");
      return;
    }

    // PDFs: extract text server-side, send as context_text instead of raw binary
    if (file.type === "application/pdf") {
      if (file.size > MAX_PDF_BYTES) {
        setContextFileError("PDF too large. Maximum is 200 KB — paste the relevant sections as text instead.");
        return;
      }
      setPdfExtracting(true);
      setPdfExtractedFrom(null);
      setContextFileError("");
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/axon/extract-pdf", { method: "POST", body: formData });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setContextFileError(err.error ?? "Failed to extract PDF text. Try pasting the text manually.");
          return;
        }
        const { text, pages, truncated } = await res.json() as { text: string; pages: number; truncated: boolean };
        setContextText(text);
        setPdfExtractedFrom(file.name);
        setContextTab("text");
        if (truncated) {
          setContextFileError(`Text truncated to 8,000 chars (PDF had ${pages} pages — paste only the relevant sections for full coverage).`);
        }
      } catch {
        setContextFileError("Failed to extract PDF text. Try pasting the text manually.");
      } finally {
        setPdfExtracting(false);
      }
      return;
    }

    // Images: send as base64 as before
    if (file.size > MAX_FILE_BYTES) {
      setContextFileError("File too large. Maximum size is 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      const base64 = result.split(",")[1];
      setContextFile({ name: file.name, type: file.type, data: base64, size: file.size });
    };
    reader.readAsDataURL(file);
  };

  /** Start a brand-new session (turn 0) */
  const handleRun = async (task: string) => {
    if (!task.trim()) return;
    const taskText = task.trim();

    // Snapshot context
    const ctxFile = contextFile;
    const ctxText = contextText.trim();
    setSubmittedContextFile(ctxFile);
    setSubmittedContextText(ctxText);

    setSubmittedTask(taskText);
    setOriginalTask(taskText);
    setTaskInput("");
    setVisibleExchanges([]);
    setDecision(null);
    setResultContent("");
    setRunError("");
    setShowTyping(false);
    setReasoningCollapsed(false);
    setElapsedSeconds(null);
    setCompletedTurns([]);
    setCurrentTurnNumber(0);
    setFollowUpInput("");
    setRequestId(null);
    stopPolling.current = false;
    runStartTime.current = Date.now();

    setState("running");

    // Build body with optional context
    const body: {
      input: string;
      context_text?: string;
      context_file?: { name: string; type: string; data: string };
    } = { input: taskText };
    if (ctxText) body.context_text = ctxText;
    if (ctxFile) body.context_file = { name: ctxFile.name, type: ctxFile.type, data: ctxFile.data };

    // Step 1: create the request
    let newRequestId: string;
    try {
      const res = await fetch("/api/axon/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401) { setState("gate"); return; }
      if (!res.ok) { setRunError("Failed to start. Try again."); setState("input"); setTaskInput(taskText); return; }
      const data = await res.json();
      newRequestId = data.requestId;
    } catch {
      setRunError("Connection error. Try again.");
      setState("input");
      setTaskInput(taskText);
      return;
    }

    setRequestId(newRequestId);

    await pollUntilDone(newRequestId, taskText, 0);
  };

  /** Continue with a follow-up question (new turn) */
  const handleContinue = async () => {
    if (!followUpInput.trim() || !requestId) return;
    const followUp = followUpInput.trim();

    setContinueLoading(true);

    // Snapshot the current turn into completedTurns
    const snapshot: CompletedTurn = {
      turnNumber: currentTurnNumber,
      userInput: submittedTask,
      exchanges: visibleExchanges,
      decision: decision!,
      content: resultContent,
      elapsedSeconds,
    };
    setCompletedTurns((prev) => [...prev, snapshot]);

    // Reset current turn state
    setSubmittedTask(followUp);
    setVisibleExchanges([]);
    setDecision(null);
    setResultContent("");
    setShowTyping(false);
    setReasoningCollapsed(false);
    setElapsedSeconds(null);
    setFollowUpInput("");
    stopPolling.current = false;
    runStartTime.current = Date.now();

    let nextTurn: number;
    try {
      const res = await fetch("/api/axon/continue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: requestId, input: followUp }),
      });
      if (!res.ok) {
        setRunError("Failed to continue. Try again.");
        setContinueLoading(false);
        return;
      }
      const data = await res.json();
      nextTurn = data.turnNumber as number;
    } catch {
      setRunError("Connection error. Try again.");
      setContinueLoading(false);
      return;
    }

    setCurrentTurnNumber(nextTurn);
    setContinueLoading(false);
    setState("running");

    await pollUntilDone(requestId, followUp, nextTurn);
  };

  /** Core polling loop — runs one exchange at a time until done */
  const pollUntilDone = async (
    reqId: string,
    taskText: string,
    turnNumber: number
  ) => {
    let exchangeCount = 0;
    while (!stopPolling.current) {
      const nextRole = AXON_TURN_ORDER[exchangeCount % AXON_TURN_ORDER.length];
      setTypingAgent(nextRole);
      setShowTyping(true);

      // ── Streaming path: Resolver ────────────────────────────────────────
      if (nextRole === "resolver") {
        let res: Response;
        try {
          res = await fetch(`/api/axon/process?request_id=${reqId}`);
          if (!res.ok) {
            if (res.status === 429) {
              const body = await res.json().catch(() => ({}));
              const resetAt = body.resetAt ? new Date(body.resetAt) : null;
              const mins = resetAt
                ? Math.ceil((resetAt.getTime() - Date.now()) / 60000)
                : null;
              setRunError(
                mins && mins > 0
                  ? `Rate limit reached. Try again in ~${mins} minute${mins === 1 ? "" : "s"}.`
                  : "Rate limit reached. Try again in a moment."
              );
            } else {
              setRunError("Engine error. Try again.");
            }
            setState("input");
            setTaskInput(taskText);
            return;
          }
        } catch {
          setRunError("Connection lost. Try again.");
          setState("input");
          setTaskInput(taskText);
          return;
        }

        setShowTyping(false);

        // Add resolver bubble with empty content — tokens stream into it
        setVisibleExchanges((prev) => [
          ...prev,
          {
            agent: "resolver" as AxonRole,
            content: "",
            exchange_number: exchangeCount,
            skipped: false,
            turn_number: turnNumber,
            streaming: true,
          },
        ]);

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamedContent = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split("\n\n");
            buffer = events.pop() ?? "";

            for (const rawEvent of events) {
              if (!rawEvent.startsWith("data: ")) continue;
              try {
                const payload = JSON.parse(rawEvent.slice(6)) as {
                  text?: string;
                  done?: boolean;
                  decision?: "EXEC" | "PASS";
                  content?: string;
                  error?: string;
                };

                if (payload.text) {
                  streamedContent += payload.text;
                  setVisibleExchanges((prev) => [
                    ...prev.slice(0, -1),
                    {
                      agent: "resolver" as AxonRole,
                      content: streamedContent,
                      exchange_number: exchangeCount,
                      skipped: false,
                      turn_number: turnNumber,
                      streaming: true,
                    },
                  ]);
                }

                if (payload.done) {
                  // Finalize resolver bubble (remove streaming cursor)
                  setVisibleExchanges((prev) => [
                    ...prev.slice(0, -1),
                    {
                      agent: "resolver" as AxonRole,
                      content: streamedContent,
                      exchange_number: exchangeCount,
                      skipped: false,
                      turn_number: turnNumber,
                      streaming: false,
                    },
                  ]);
                  setDecision(payload.decision ?? null);
                  setResultContent(payload.content ?? "");
                  setElapsedSeconds(Math.round((Date.now() - runStartTime.current) / 1000));
                  setState("result");
                  window.history.replaceState({}, "", `?session=${reqId}`);
                  return;
                }

                if (payload.error) {
                  setRunError("Resolver error. Try again.");
                  setState("input");
                  setTaskInput(taskText);
                  return;
                }
              } catch { /* ignore malformed SSE events */ }
            }
          }
        } catch {
          setRunError("Stream interrupted. Try again.");
          setState("input");
          setTaskInput(taskText);
          return;
        }
        break;
      }

      // ── Normal / parallel fetch ─────────────────────────────────────────
      let data: {
        done: boolean;
        exchange?: AxonExchange;
        exchanges?: AxonExchange[];
        parallel?: boolean;
        decision?: "EXEC" | "PASS";
        content?: string;
      };

      try {
        const res = await fetch(`/api/axon/process?request_id=${reqId}`);
        if (!res.ok) {
          if (res.status === 429) {
            const body = await res.json().catch(() => ({}));
            const resetAt = body.resetAt ? new Date(body.resetAt) : null;
            const mins = resetAt
              ? Math.ceil((resetAt.getTime() - Date.now()) / 60000)
              : null;
            setRunError(
              mins && mins > 0
                ? `Rate limit reached. Try again in ~${mins} minute${mins === 1 ? "" : "s"}.`
                : "Rate limit reached. Try again in a moment."
            );
          } else {
            setRunError("Engine error. Try again.");
          }
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

      if (data.parallel && data.exchanges) {
        // Validator + Monitor returned together
        for (const ex of data.exchanges) {
          setVisibleExchanges((prev) => [...prev, { ...ex, turn_number: turnNumber }]);
        }
        exchangeCount += 2;
      } else if (data.exchange) {
        setVisibleExchanges((prev) => [...prev, { ...data.exchange!, turn_number: turnNumber }]);
        exchangeCount++;
      }

      if (data.done) {
        setDecision(data.decision ?? null);
        setResultContent(data.content ?? "");
        setElapsedSeconds(Math.round((Date.now() - runStartTime.current) / 1000));
        setState("result");
        window.history.replaceState({}, "", `?session=${reqId}`);
        break;
      }
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
    setSubmittedContextFile(null);
    setSubmittedContextText("");
    setCompletedTurns([]);
    setCurrentTurnNumber(0);
    setFollowUpInput("");
    setRequestId(null);
    setOriginalTask("");
    // Clear session from URL
    window.history.replaceState({}, "", window.location.pathname);
    setState("input");
  };

  // ─── Elapsed session time display ─────────────────────────────────────────
  const sessionMinutes = Math.floor((Date.now() - sessionStartTime) / 60000);

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-1.5 w-1.5 rounded-full bg-[var(--color-text-muted)] animate-pulse" />
      </div>
    );
  }

  // ─── STATE 1 — Beta gate ──────────────────────────────────────────────────
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

  // ─── STATE 2 — Input form ─────────────────────────────────────────────────
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

            {/* Context section */}
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                Context <span className="normal-case not-italic opacity-50">(optional)</span>
              </p>

              {/* Tabs */}
              <div className="flex gap-1 text-[10px]">
                {(["file", "text"] as ContextTab[]).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setContextTab(tab)}
                    className={`px-3 py-1 rounded-full border transition-colors ${
                      contextTab === tab
                        ? "border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent)]/10"
                        : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    {tab === "file" ? "Upload file" : "Paste text"}
                  </button>
                ))}
              </div>

              {contextTab === "file" && (
                <div className="space-y-2">
                  {pdfExtracting ? (
                    <div className="flex items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-6">
                      <span className="text-xs text-[var(--color-text-muted)] animate-pulse">Extracting text from PDF…</span>
                    </div>
                  ) : contextFile ? (
                    <div className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
                      {contextFile.type.startsWith("image/") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`data:${contextFile.type};base64,${contextFile.data}`}
                          alt={contextFile.name}
                          className="h-10 w-10 rounded object-cover shrink-0"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded bg-[var(--color-bg)] border border-[var(--color-border)] flex items-center justify-center shrink-0">
                          <span className="text-[10px] font-mono text-[var(--color-text-muted)]">PDF</span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-[var(--color-text)] truncate">{contextFile.name}</p>
                        <p className="text-[10px] text-[var(--color-text-muted)]">
                          {(contextFile.size / 1024).toFixed(0)} KB
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setContextFile(null); setContextFileError(""); }}
                        className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors text-sm shrink-0"
                        aria-label="Remove file"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <label
                      className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 cursor-pointer transition-colors ${
                        isDragging
                          ? "border-[var(--color-accent)] bg-[var(--color-accent)]/5"
                          : "border-[var(--color-border)] hover:border-[var(--color-text-muted)]"
                      }`}
                      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDragging(false);
                        const file = e.dataTransfer.files[0];
                        if (file) handleFileSelect(file);
                      }}
                    >
                      <input
                        type="file"
                        className="sr-only"
                        accept=".pdf,.png,.jpg,.jpeg,.gif,.webp"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleFileSelect(file);
                        }}
                      />
                      <span className="text-[var(--color-text-muted)] text-xs">
                        Drop file here or click to upload
                      </span>
                      <span className="text-[10px] text-[var(--color-text-muted)] opacity-60">
                        PDF max 200 KB (text extracted) · Images max 5 MB
                      </span>
                    </label>
                  )}
                  {contextFileError && (
                    <p className="text-[10px] text-red-400">{contextFileError}</p>
                  )}
                </div>
              )}

              {contextTab === "text" && pdfExtractedFrom && (
                <p className="text-[10px] text-[var(--color-text-muted)]">
                  Extracted from: <span className="font-mono">{pdfExtractedFrom}</span>
                </p>
              )}

              {contextTab === "text" && (
                <div className="space-y-1">
                  <textarea
                    value={contextText}
                    onChange={(e) => setContextText(e.target.value)}
                    placeholder="Paste any relevant text, code, data or notes..."
                    rows={6}
                    maxLength={MAX_TEXT_CHARS}
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent)] transition-colors resize-none"
                  />
                  <p className={`text-[10px] text-right ${contextText.length >= MAX_TEXT_CHARS ? "text-red-400" : contextText.length > 7000 ? "text-yellow-500" : "text-[var(--color-text-muted)]"}`}>
                    {contextText.length.toLocaleString()} / {MAX_TEXT_CHARS.toLocaleString()} chars
                  </p>
                </div>
              )}
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

  // ─── STATES 3 & 4 — Running + Result (shared layout) ─────────────────────
  const totalTurns = completedTurns.length + 1; // completed + current

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
      <header className="border-b border-[var(--color-border)] px-6 py-4">
        <div className="mx-auto flex max-w-2xl items-baseline gap-3 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--color-text)]">
            AXON
          </span>
          {completedTurns.length > 0 ? (
            <>
              <span className="text-[10px] text-[var(--color-text-muted)]">
                {totalTurns} turn{totalTurns !== 1 ? "s" : ""}
              </span>
              <span className="text-[10px] text-[var(--color-text-muted)] opacity-40">·</span>
              <span className="text-[10px] text-[var(--color-text-muted)]">
                Started {sessionMinutes > 0 ? `${sessionMinutes}m ago` : "just now"}
              </span>
              {originalTask && (
                <>
                  <span className="text-[10px] text-[var(--color-text-muted)] opacity-40">·</span>
                  <span className="text-[10px] text-[var(--color-text-muted)] truncate max-w-[160px]">
                    {originalTask}
                  </span>
                </>
              )}
            </>
          ) : (
            <span className="text-[10px] text-[var(--color-text-muted)]">
              EpistemicGate · Beta
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 space-y-4">

        {/* ── Previous turns (collapsed cards) ── */}
        {completedTurns.map((turn) => (
          <PreviousTurnCard key={turn.turnNumber} turn={turn} />
        ))}

        {/* Turn divider — only shown when continuing */}
        {completedTurns.length > 0 && (
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-[var(--color-border)]" />
            <span className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">
              Turn {currentTurnNumber + 1}
            </span>
            <div className="flex-1 border-t border-[var(--color-border)]" />
          </div>
        )}

        {/* Current task */}
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
          <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
            {completedTurns.length > 0 ? "Follow-up" : "Task"}
          </p>
          <p className="text-sm text-[var(--color-text)]">{submittedTask}</p>
        </div>

        {/* Context badge — shown when context was submitted */}
        {(submittedContextFile || submittedContextText) && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-[10px] text-[var(--color-text-muted)]">
              <span className="opacity-60">⊕</span>
              {submittedContextFile
                ? submittedContextFile.type === "application/pdf"
                  ? `PDF: ${submittedContextFile.name}`
                  : `Image: ${submittedContextFile.name}`
                : "Text context provided"}
            </span>
          </div>
        )}

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

        {/* Exchange stream */}
        {!reasoningCollapsed && (
          <>
            <div className="space-y-2">
              {visibleExchanges.map((exchange) => (
                <AxonBubble key={`${exchange.turn_number ?? 0}-${exchange.exchange_number}`} exchange={exchange} />
              ))}
            </div>
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

        {/* ── Follow-up / continue section ── */}
        {state === "result" && decision && (
          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 border-t border-[var(--color-border)]" />
              <span className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">
                Continue
              </span>
              <div className="flex-1 border-t border-[var(--color-border)]" />
            </div>

            <div className="flex gap-2">
              <textarea
                value={followUpInput}
                onChange={(e) => setFollowUpInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleContinue();
                  }
                }}
                placeholder="Ask a follow-up question..."
                rows={2}
                className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent)] transition-colors resize-none"
              />
              <button
                onClick={handleContinue}
                disabled={!followUpInput.trim() || continueLoading}
                className="rounded-lg border border-[var(--color-accent)] px-4 py-2.5 text-sm text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed self-end"
              >
                {continueLoading ? "..." : "→"}
              </button>
            </div>
          </div>
        )}

        {/* Session URL + start over */}
        {state === "result" && decision && (
          <div className="flex items-center justify-between pt-2 pb-8">
            {requestId ? (
              <span className="text-[10px] text-[var(--color-text-muted)] opacity-50 font-mono truncate max-w-[60%]">
                session/{requestId.slice(0, 8)}
              </span>
            ) : (
              <span />
            )}
            <button
              onClick={handleRunAnother}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
            >
              ← New session
            </button>
          </div>
        )}

        <div ref={bottomRef} />
      </main>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PreviousTurnCard({ turn }: { turn: CompletedTurn }) {
  const [expanded, setExpanded] = useState(false);
  const isExec = turn.decision === "EXEC";

  return (
    <div
      className="rounded-lg border opacity-60 hover:opacity-80 transition-opacity"
      style={{ borderColor: isExec ? "#2e7d6a55" : "#8a6a0055" }}
    >
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <div
          className="h-1.5 w-1.5 rounded-full shrink-0"
          style={{ backgroundColor: isExec ? "#2e7d6a" : "#8a6a00" }}
        />
        <span className="text-[10px] uppercase tracking-wider font-semibold"
          style={{ color: isExec ? "#2e7d6a" : "#8a6a00" }}>
          Turn {turn.turnNumber + 1} · {turn.decision}
        </span>
        <span className="text-[10px] text-[var(--color-text-muted)] flex-1 truncate">
          {turn.userInput}
        </span>
        {turn.elapsedSeconds && (
          <span className="text-[10px] text-[var(--color-text-muted)] tabular-nums shrink-0">
            {turn.elapsedSeconds}s
          </span>
        )}
        <span
          className="text-[10px] text-[var(--color-text-muted)] transition-transform duration-150 inline-block shrink-0"
          style={{ transform: expanded ? "rotate(0deg)" : "rotate(-90deg)" }}
        >
          ▾
        </span>
      </button>

      {expanded && (
        <div className="border-t border-[var(--color-border)] px-4 py-3 space-y-3">
          <div className="space-y-2">
            {turn.exchanges.map((ex) => (
              <AxonBubble key={`prev-${turn.turnNumber}-${ex.exchange_number}`} exchange={ex} />
            ))}
          </div>
          <div
            className="rounded-lg border p-3 text-xs text-[var(--color-text)]"
            style={{ borderColor: isExec ? "#2e7d6a33" : "#8a6a0033" }}
          >
            <p className="text-[10px] uppercase tracking-wider mb-1"
              style={{ color: isExec ? "#2e7d6a" : "#8a6a00" }}>
              {isExec ? "Answer" : "Finding"}
            </p>
            <div className="leading-relaxed">{renderMarkdown(turn.content)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function AxonBubble({ exchange }: { exchange: AxonExchange }) {
  const agent = AXON_AGENTS[exchange.agent];
  // Auto-expand when streaming — stays expanded after streaming ends
  const [expanded, setExpanded] = useState(exchange.streaming ?? false);

  useEffect(() => {
    if (exchange.streaming) setExpanded(true);
  }, [exchange.streaming]);

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
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 px-2 py-1 rounded hover:bg-[var(--color-surface)] transition-colors text-left"
      >
        <span
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: agent.color }}
        >
          {agent.name}
        </span>
        <span className="text-[10px] text-[var(--color-text-muted)]">
          #{exchange.exchange_number + 1}
        </span>
        {exchange.streaming && (
          <span className="text-[10px] text-[var(--color-text-muted)] animate-pulse">
            streaming…
          </span>
        )}
        <span
          className="ml-auto text-[10px] text-[var(--color-text-muted)] transition-transform duration-150 inline-block"
          style={{ transform: expanded ? "rotate(0deg)" : "rotate(-90deg)" }}
        >
          ▾
        </span>
      </button>
      {expanded && (
        <div
          className="mx-2 rounded-lg border px-4 py-3"
          style={{ borderColor: agent.color + "33" }}
        >
          <p className="text-sm leading-relaxed text-[var(--color-text)]">
            {renderMarkdown(exchange.content)}
            {exchange.streaming && (
              <span className="inline-block w-0.5 h-4 bg-[var(--color-text)] animate-pulse ml-0.5 align-middle opacity-60" />
            )}
          </p>
        </div>
      )}
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
