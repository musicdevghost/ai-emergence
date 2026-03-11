"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { ExchangeBubble } from "@/components/ExchangeBubble";
import { TypingIndicator } from "@/components/TypingIndicator";
import { SessionHeader } from "@/components/SessionHeader";
import { TURN_ORDER, type AgentRole } from "@/lib/agents";

interface Exchange {
  id: string;
  exchange_number: number;
  agent: AgentRole;
  content: string;
  created_at: string;
}

interface Session {
  id: string;
  status: string;
  exchange_count: number;
  seed_thread: string | null;
  created_at: string;
}

const POLL_INTERVAL = 3000; // 3 seconds

export default function TheatrePage() {
  const [session, setSession] = useState<Session | null>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showTyping, setShowTyping] = useState(false);
  const [newExchangeIds, setNewExchangeIds] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const initialLoadDone = useRef(false);

  // Fetch initial session data
  useEffect(() => {
    async function fetchSession() {
      try {
        const res = await fetch("/api/session");
        const data = await res.json();
        if (data.session) {
          setSession(data.session);
          setExchanges(data.exchanges);
        }
      } catch (err) {
        console.error("Failed to fetch session:", err);
      } finally {
        setIsLoading(false);
        initialLoadDone.current = true;
      }
    }
    fetchSession();
  }, []);

  // Poll for new exchanges
  const poll = useCallback(async () => {
    if (!session || session.status === "complete") return;

    try {
      const lastExchange = exchanges.length > 0 ? exchanges[exchanges.length - 1].exchange_number : -1;
      const res = await fetch(
        `/api/exchanges?session_id=${session.id}&after=${lastExchange}`
      );
      const data = await res.json();

      if (data.exchanges.length > 0) {
        setNewExchangeIds(
          new Set(data.exchanges.map((e: Exchange) => e.id))
        );
        setExchanges((prev) => [...prev, ...data.exchanges]);
        setShowTyping(false);

        // Show typing indicator after a delay for the next agent
        setTimeout(() => {
          if (data.sessionStatus === "active") {
            setShowTyping(true);
          }
        }, 2000);
      } else if (data.sessionStatus === "active" && exchanges.length > 0) {
        // No new exchanges but session is active — show typing
        setShowTyping(true);
      }

      // Update session status
      if (data.sessionStatus && session.status !== data.sessionStatus) {
        setSession((prev) =>
          prev ? { ...prev, status: data.sessionStatus } : null
        );
      }
    } catch (err) {
      console.error("Poll error:", err);
    }
  }, [session, exchanges]);

  useEffect(() => {
    if (!session || session.status === "complete") return;
    const interval = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [poll, session]);

  // Auto-scroll to bottom on new exchanges
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [exchanges.length, showTyping]);

  // Clear "new" animation after it plays
  useEffect(() => {
    if (newExchangeIds.size > 0) {
      const timer = setTimeout(() => setNewExchangeIds(new Set()), 1000);
      return () => clearTimeout(timer);
    }
  }, [newExchangeIds]);

  const nextAgent: AgentRole =
    TURN_ORDER[exchanges.length % TURN_ORDER.length];

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-[var(--color-text-muted)]">
          Connecting to Emergence...
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
        <h1 className="text-lg font-semibold text-[var(--color-text)]">
          Emergence
        </h1>
        <p className="text-sm text-[var(--color-text-muted)] text-center max-w-md">
          The next session is being prepared. The agents will resume their
          dialogue shortly.
        </p>
        <span className="pulse-glow h-2 w-2 rounded-full bg-amber-500" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
      <SessionHeader
        status={session.status}
        exchangeCount={exchanges.length}
      />

      {/* Seed thread banner */}
      {session.seed_thread && (
        <div className="mx-auto max-w-2xl px-4 py-3 border-b border-[var(--color-border)]">
          <p className="text-xs text-[var(--color-text-muted)] italic">
            Thread from previous session: &ldquo;{session.seed_thread}&rdquo;
          </p>
        </div>
      )}

      {/* Exchange list */}
      <main className="mx-auto w-full max-w-2xl flex-1 py-4">
        <div className="space-y-1">
          {exchanges.map((exchange) => (
            <ExchangeBubble
              key={exchange.id}
              agent={exchange.agent as AgentRole}
              content={exchange.content}
              exchangeNumber={exchange.exchange_number}
              exchangeId={exchange.id}
              isNew={newExchangeIds.has(exchange.id)}
            />
          ))}
        </div>

        {/* Typing indicator */}
        {showTyping && session.status === "active" && (
          <TypingIndicator agent={nextAgent} />
        )}

        <div ref={bottomRef} />
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--color-border)] py-3 text-center">
        <p className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">
          You cannot intervene. You can only watch.
        </p>
      </footer>
    </div>
  );
}
