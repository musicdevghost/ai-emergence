"use client";

import { useState, useEffect } from "react";

export type HingesMap = Map<number, string>;

// Module-level cache shared across all component instances
let cache: HingesMap | null = null;
const listeners = new Set<(m: HingesMap) => void>();
let fetchStarted = false;

function loadHinges() {
  if (fetchStarted) return;
  fetchStarted = true;
  fetch("/api/hinges")
    .then((r) => r.json())
    .then((data) => {
      const map: HingesMap = new Map();
      (data.hinges ?? []).forEach((h: { id: number; content: string }) => {
        map.set(h.id, h.content);
      });
      cache = map;
      listeners.forEach((fn) => fn(map));
      listeners.clear();
    })
    .catch(() => {
      cache = new Map();
      listeners.forEach((fn) => fn(new Map()));
      listeners.clear();
    });
}

export function useHinges(): HingesMap {
  const [map, setMap] = useState<HingesMap>(cache ?? new Map());

  useEffect(() => {
    if (cache !== null) {
      setMap(cache);
      return;
    }
    listeners.add(setMap);
    loadHinges();
    return () => {
      listeners.delete(setMap);
    };
  }, []);

  return map;
}
