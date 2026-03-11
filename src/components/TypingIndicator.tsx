"use client";

import { AGENTS, type AgentRole } from "@/lib/agents";

export function TypingIndicator({ agent }: { agent: AgentRole }) {
  const config = AGENTS[agent];
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span
        className="text-xs font-medium uppercase tracking-wider"
        style={{ color: config.color }}
      >
        {config.name}
      </span>
      <div className="flex gap-1">
        <span
          className="typing-dot h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: config.color }}
        />
        <span
          className="typing-dot h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: config.color }}
        />
        <span
          className="typing-dot h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: config.color }}
        />
      </div>
    </div>
  );
}
