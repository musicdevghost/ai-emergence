"use client";

import React from "react";
import { GroundRef } from "./GroundRef";
import { useHinges, type HingesMap } from "@/hooks/useHinges";

// Visual config — color and avatar per agent. Side is determined by position in the exchange list.
const BUBBLE_CONFIG: Record<string, { name: string; color: string; avatar: string }> = {
  thinker:    { name: "The Thinker",    color: "#6B8AFF", avatar: "🧠" },
  challenger: { name: "The Challenger", color: "#FF6B6B", avatar: "⚔️" },
  observer:   { name: "The Observer",   color: "#6BFFB8", avatar: "👁"  },
  anchor:     { name: "The Anchor",     color: "#FFB86B", avatar: "⚓" },
  witness:    { name: "The Witness",    color: "#B86BFF", avatar: "🌀" },
};

interface ExchangeBubbleProps {
  agent: string;
  content: string;
  exchangeNumber: number;
  exchangeId?: string;
  isNew?: boolean;
  skipped?: boolean;
  index?: number;
}

/** Render basic markdown: **bold**, *italic*, and nested **bold with *italic* inside** */
export function renderContent(text: string): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push(<span key={`t${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>);
    }
    if (match[1] !== undefined) {
      result.push(
        <strong key={`b${match.index}`} className="font-semibold">
          {renderInlineItalic(match[1], match.index)}
        </strong>
      );
    } else if (match[2] !== undefined) {
      result.push(
        <em key={`i${match.index}`} className="italic opacity-80">{match[2]}</em>
      );
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    result.push(<span key={`t${lastIndex}`}>{text.slice(lastIndex)}</span>);
  }
  return result;
}

function renderInlineItalic(text: string, parentIndex: number): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  const regex = /\*(.+?)\*/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push(<span key={`bi${parentIndex}_${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>);
    }
    result.push(<em key={`bie${parentIndex}_${match.index}`} className="italic">{match[1]}</em>);
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

interface MatchedRef {
  start: number;
  end: number;
  numbers: number[];
  label: string;
}

/**
 * Parse all ground references from text.
 * Handles:
 *   - Singles:  "Ground 9", "Ground Point 9", "Ground Rule 9", "Ground #9"
 *   - Ranges:   "Ground 16 through 18", "Ground 16-18", "Ground 16 to 18"
 *   - Lists:    "Grounds 16, 17, and 18"
 * Maps to hinge ID directly (Ground 9 = hinge id 9).
 */
function parseGroundRefs(text: string): MatchedRef[] {
  const refs: MatchedRef[] = [];

  // 1. Ranges: "Ground(s) [Point|Rule|#] N through/to/-/– M"
  const rangeRe = /grounds?\s*(?:point|rule|#)?\s*(\d{1,2})\s*(?:through|to|[-–])\s*(\d{1,2})/gi;
  let m: RegExpExecArray | null;
  while ((m = rangeRe.exec(text)) !== null) {
    const a = parseInt(m[1]);
    const b = parseInt(m[2]);
    const numbers: number[] = [];
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) numbers.push(i);
    refs.push({ start: m.index, end: m.index + m[0].length, numbers, label: m[0] });
  }

  // 2. Comma/and lists: "Grounds 16, 17, and 18" or "Grounds 16, 17 and 18"
  const listRe = /grounds?\s*(?:point|rule|#)?\s*(\d{1,2})(?:\s*,\s*(\d{1,2}))+(?:\s*,?\s*and\s*(\d{1,2}))?/gi;
  while ((m = listRe.exec(text)) !== null) {
    const isOverlap = refs.some((r) => m!.index >= r.start && m!.index < r.end);
    if (!isOverlap) {
      const numStr = m[0].replace(/grounds?\s*(?:point|rule|#)?\s*/i, "");
      const numbers = numStr.split(/[\s,and]+/).map((s) => parseInt(s)).filter((n) => !isNaN(n));
      refs.push({ start: m.index, end: m.index + m[0].length, numbers, label: m[0] });
    }
  }

  // 3. Singles: "Ground [Point|Rule|#] N"
  const singleRe = /ground\s*(?:point|rule|#)?\s*(\d{1,2})/gi;
  while ((m = singleRe.exec(text)) !== null) {
    const isOverlap = refs.some((r) => m!.index >= r.start && m!.index < r.end);
    if (!isOverlap) {
      refs.push({ start: m.index, end: m.index + m[0].length, numbers: [parseInt(m[1])], label: m[0] });
    }
  }

  return refs.sort((a, b) => a.start - b.start);
}

/**
 * Render exchange text with ground references replaced by interactive GroundRef components.
 * Non-ref segments get standard bold/italic rendering.
 */
export function renderExchangeContent(text: string, hingesMap: HingesMap): React.ReactNode[] {
  const refs = parseGroundRefs(text);
  if (refs.length === 0) return renderContent(text);

  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  for (const ref of refs) {
    if (ref.start > cursor) {
      nodes.push(...renderContent(text.slice(cursor, ref.start)));
    }

    ref.numbers.forEach((num, i) => {
      const content = hingesMap.get(num);
      const label = ref.numbers.length === 1 ? ref.label : `Ground ${num}`;
      nodes.push(
        <GroundRef key={`gr-${ref.start}-${i}`} number={num} content={content} label={label} />
      );
      if (i < ref.numbers.length - 1) {
        nodes.push(<span key={`sep-${ref.start}-${i}`}> · </span>);
      }
    });

    cursor = ref.end;
  }

  if (cursor < text.length) {
    nodes.push(...renderContent(text.slice(cursor)));
  }

  return nodes;
}

export function ExchangeBubble({
  agent,
  content,
  exchangeNumber,
  isNew = false,
  skipped = false,
  index = 0,
}: ExchangeBubbleProps) {
  const config = BUBBLE_CONFIG[agent] ?? { name: agent, color: "#888", avatar: "?" };
  const hingesMap = useHinges();

  const isLeft = index % 2 === 0;
  const color = config.color;

  const isSilent =
    skipped ||
    content.includes("[HINGE:") ||
    content.includes("[PROPOSAL:") ||
    content.includes("[PASS]");

  const displayContent = isSilent ? "" : scrubDisplayContent(content);

  const animClass = isLeft ? "bubble-slide-left" : "bubble-slide-right";
  const animDelay = `${index * 0.05}s`;

  return (
    <div
      className={`flex items-start gap-[10px] mb-4 ${isNew ? animClass : ""} ${isLeft ? "pr-12 flex-row" : "pl-12 flex-row-reverse"}`}
      style={isNew ? { animationDelay: animDelay } : undefined}
    >
      {/* Avatar */}
      <div
        className="shrink-0 flex items-center justify-center rounded-full text-base mt-0.5"
        style={{
          width: 36,
          height: 36,
          background: `${color}20`,
          border: `2px solid ${color}40`,
          fontSize: 16,
        }}
      >
        {config.avatar}
      </div>

      {/* Name + Bubble */}
      <div className="max-w-[85%] min-w-[60px]">
        <div
          className="mb-1 text-[11px] font-semibold uppercase tracking-[0.5px]"
          style={{
            color,
            textAlign: isLeft ? "left" : "right",
            fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
          }}
        >
          {config.name}
        </div>

        <div
          style={{
            background: isSilent
              ? "transparent"
              : isLeft
              ? "rgba(255,255,255,0.06)"
              : "rgba(255,255,255,0.03)",
            border: isSilent
              ? `1px dashed ${color}30`
              : `1px solid ${color}15`,
            borderRadius: isLeft ? "4px 16px 16px 16px" : "16px 4px 16px 16px",
            padding: isSilent ? "8px 14px" : "12px 16px",
            color: isSilent ? `${color}60` : "rgba(255,255,255,0.85)",
            fontSize: 14,
            lineHeight: 1.55,
            fontStyle: isSilent ? "italic" : "normal",
            fontFamily: "'Inter', -apple-system, sans-serif",
          }}
        >
          {isSilent ? "chose silence" : renderExchangeContent(displayContent, hingesMap)}
        </div>
      </div>
    </div>
  );
}
