"use client";

import React from "react";
import { AGENTS, type AgentRole } from "@/lib/agents";

interface ExchangeBubbleProps {
  agent: AgentRole;
  content: string;
  exchangeNumber: number;
  exchangeId: string;
  isNew?: boolean;
  skipped?: boolean;
}

/** Render basic markdown: **bold**, *italic*, and nested **bold with *italic* inside** */
export function renderContent(text: string): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  // Match **bold** or *italic* (bold first to avoid conflicts)
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Add plain text before this match
    if (match.index > lastIndex) {
      result.push(<span key={`t${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>);
    }

    if (match[1] !== undefined) {
      // **bold** — recursively render inner content for nested *italic*
      result.push(
        <strong key={`b${match.index}`} className="font-semibold">
          {renderInlineItalic(match[1], match.index)}
        </strong>
      );
    } else if (match[2] !== undefined) {
      // *italic*
      result.push(
        <em key={`i${match.index}`} className="italic text-[var(--color-text-muted)]">
          {match[2]}
        </em>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining plain text
  if (lastIndex < text.length) {
    result.push(<span key={`t${lastIndex}`}>{text.slice(lastIndex)}</span>);
  }

  return result;
}

/** Render *italic* within already-matched bold text */
function renderInlineItalic(text: string, parentIndex: number): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  const regex = /\*(.+?)\*/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push(<span key={`bi${parentIndex}_${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>);
    }
    result.push(
      <em key={`bie${parentIndex}_${match.index}`} className="italic">
        {match[1]}
      </em>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    result.push(<span key={`bi${parentIndex}_${lastIndex}`}>{text.slice(lastIndex)}</span>);
  }

  return result.length > 0 ? result : [<span key={`bi${parentIndex}_0`}>{text}</span>];
}

/**
 * Strip Witness signal tokens from content before display.
 * [HINGE:] and [PROPOSAL:] are extracted to the admin panel — they should
 * not appear in the dialogue view. Raw text is preserved in the DB.
 */
function scrubDisplayContent(raw: string): string {
  return raw
    .replace(/\[HINGE:[\s\S]*?\](?=\s|$)/g, "")
    .replace(/\[PROPOSAL:[\s\S]*?\](?=\s|$)/g, "")
    .trim();
}

export function ExchangeBubble({
  agent,
  content,
  exchangeNumber,
  isNew = false,
  skipped = false,
}: ExchangeBubbleProps) {
  const config = AGENTS[agent];
  const displayContent = scrubDisplayContent(content);

  if (skipped) {
    return (
      <div className={`group px-4 py-2 ${isNew ? "line-fade" : ""}`}>
        <div className="flex items-center gap-2">
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: config.color }}
          >
            {config.name}
          </span>
          <span className="text-[10px] text-[var(--color-text-muted)]">
            #{exchangeNumber + 1}
          </span>
          <span className="text-[10px] italic text-[var(--color-text-muted)] opacity-60">
            chose silence
          </span>
        </div>
      </div>
    );
  }

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
          {renderContent(displayContent)}
        </p>
      </div>
    </div>
  );
}
