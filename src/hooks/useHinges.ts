"use client";

import { useState, useEffect } from "react";

export type HingesMap = Map<number, string>;

// Module-level cache — single fetch, result shared via promise
let cache: HingesMap | null = null;
let hingesPromise: Promise<HingesMap> | null = null;

function getHingesPromise(): Promise<HingesMap> {
  if (cache !== null) return Promise.resolve(cache);
  if (!hingesPromise) {
    hingesPromise = fetch("/api/hinges")
      .then((r) => r.json())
      .then((data) => {
        const map: HingesMap = new Map();
        (data.hinges ?? []).forEach((h: { id: number; content: string }) => {
          map.set(h.id, h.content);
        });
        cache = map;
        return map;
      })
      .catch(() => {
        cache = new Map();
        return cache;
      });
  }
  return hingesPromise;
}

export function useHinges(): HingesMap {
  const [map, setMap] = useState<HingesMap>(cache ?? new Map());

  useEffect(() => {
    let cancelled = false;
    getHingesPromise().then((m) => {
      if (!cancelled) setMap(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return map;
}
