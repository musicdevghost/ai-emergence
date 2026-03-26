"use client";

import React, { useRef, useState, useEffect } from "react";

interface GroundRefProps {
  number: number;
  content: string | undefined;
  label: string; // original matched text e.g. "Ground Rule 4"
}

export function GroundRef({ number, content, label }: GroundRefProps) {
  const [hovered, setHovered] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({
    left: "50%",
    transform: "translateX(-50%)",
  });
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);

  // If no matching hinge, render plain text
  if (!content) {
    return <span>{label}</span>;
  }

  // Adjust tooltip position to avoid viewport overflow
  useEffect(() => {
    if (!hovered || !wrapperRef.current || !tooltipRef.current) return;
    const wRect = wrapperRef.current.getBoundingClientRect();
    const tRect = tooltipRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const margin = 8;

    let left = "50%";
    let transform = "translateX(-50%)";

    const centeredLeft = wRect.left + wRect.width / 2 - tRect.width / 2;
    if (centeredLeft < margin) {
      const shift = margin - centeredLeft;
      transform = `translateX(calc(-50% + ${shift}px))`;
    } else if (centeredLeft + tRect.width > vw - margin) {
      const shift = centeredLeft + tRect.width - (vw - margin);
      transform = `translateX(calc(-50% - ${shift}px))`;
    }

    setTooltipStyle({ left, transform });
  }, [hovered]);

  return (
    <span
      ref={wrapperRef}
      style={{ position: "relative", display: "inline" }}
    >
      {/* The reference text */}
      <span
        style={{
          color: "rgba(255,255,255,0.55)",
          borderBottom: "1px dotted rgba(255,255,255,0.25)",
          cursor: "default",
          transition: "color 0.15s",
          ...(hovered ? { color: "rgba(255,255,255,0.85)" } : {}),
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => setExpanded((v) => !v)}
      >
        {label}
      </span>

      {/* Desktop tooltip */}
      {hovered && (
        <span
          ref={tooltipRef}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            ...tooltipStyle,
            background: "#13131f",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
            padding: "8px 10px",
            width: "min(400px, 90vw)",
            fontSize: 13,
            color: "rgba(255,255,255,0.72)",
            lineHeight: 1.55,
            zIndex: 50,
            pointerEvents: "none",
            animation: "groundRefFadeIn 0.15s ease",
            display: "block",
          }}
        >
          <span
            style={{
              display: "block",
              fontSize: 10,
              letterSpacing: "0.08em",
              color: "rgba(255,255,255,0.3)",
              marginBottom: 5,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            GROUND {number}
          </span>
          {content}
        </span>
      )}

      {/* Mobile inline expansion */}
      {expanded && (
        <span
          style={{
            display: "block",
            marginTop: 6,
            marginBottom: 6,
            padding: "8px 10px",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 6,
            fontSize: 13,
            color: "rgba(255,255,255,0.68)",
            lineHeight: 1.55,
          }}
        >
          <span
            style={{
              display: "block",
              fontSize: 10,
              letterSpacing: "0.08em",
              color: "rgba(255,255,255,0.3)",
              marginBottom: 5,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            GROUND {number}
          </span>
          {content}
        </span>
      )}
    </span>
  );
}
