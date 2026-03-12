"use client";

import { AGENTS, type AgentRole } from "@/lib/agents";

interface ExchangeBubbleProps {
  agent: AgentRole;
  content: string;
  exchangeNumber: number;
  exchangeId: string;
  isNew?: boolean;
}

/** Render basic markdown: **bold** and *italic* */
export function renderContent(text: string) {
  // Split into segments by **bold** and *italic* markers
  const parts: { text: string; bold?: boolean; italic?: boolean }[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Check for **bold**
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    // Check for *italic* (but not **)
    const italicMatch = remaining.match(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/);

    const boldIndex = boldMatch?.index ?? Infinity;
    const italicIndex = italicMatch?.index ?? Infinity;

    if (boldIndex === Infinity && italicIndex === Infinity) {
      parts.push({ text: remaining });
      break;
    }

    if (boldIndex <= italicIndex && boldMatch) {
      // Add text before bold
      if (boldIndex > 0) {
        parts.push({ text: remaining.slice(0, boldIndex) });
      }
      parts.push({ text: boldMatch[1], bold: true });
      remaining = remaining.slice(boldIndex + boldMatch[0].length);
    } else if (italicMatch) {
      // Add text before italic
      if (italicIndex > 0) {
        parts.push({ text: remaining.slice(0, italicIndex) });
      }
      parts.push({ text: italicMatch[1], italic: true });
      remaining = remaining.slice(italicIndex + italicMatch[0].length);
    }
  }

  return parts.map((part, i) => {
    if (part.bold) {
      return (
        <strong key={i} className="font-semibold">
          {part.text}
        </strong>
      );
    }
    if (part.italic) {
      return (
        <em key={i} className="italic text-[var(--color-text-muted)]">
          {part.text}
        </em>
      );
    }
    return <span key={i}>{part.text}</span>;
  });
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
          {renderContent(content)}
        </p>
      </div>
    </div>
  );
}
