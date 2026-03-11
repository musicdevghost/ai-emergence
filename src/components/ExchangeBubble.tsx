"use client";

import { AGENTS, type AgentRole } from "@/lib/agents";

interface ExchangeBubbleProps {
  agent: AgentRole;
  content: string;
  exchangeNumber: number;
  exchangeId: string;
  isNew?: boolean;
}

export function ExchangeBubble({
  agent,
  content,
  exchangeNumber,
  isNew = false,
}: ExchangeBubbleProps) {
  const config = AGENTS[agent];

  return (
    <div
      className={`group px-4 py-3 ${isNew ? "line-fade" : ""}`}
    >
      <div className="flex items-baseline gap-2 mb-1.5">
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: config.color }}
        >
          {config.name}
        </span>
        <span className="text-[10px] text-[var(--color-text-muted)]">
          #{exchangeNumber + 1}
        </span>
      </div>
      <div className="rounded-2xl rounded-tl-sm bg-[var(--color-surface)] border border-[var(--color-border)] px-4 py-3 max-w-[85%]">
        <p className="text-sm leading-relaxed text-[var(--color-text)]">
          {content}
        </p>
      </div>
    </div>
  );
}
