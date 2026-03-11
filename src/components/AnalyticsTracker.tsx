"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

function getViewerId(): string {
  let id = sessionStorage.getItem("emergence_viewer_id");
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem("emergence_viewer_id", id);
  }
  return id;
}

export function AnalyticsTracker() {
  const pathname = usePathname();

  useEffect(() => {
    const viewerId = getViewerId();

    // Record page view
    fetch("/api/analytics/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pathname, viewerId }),
    }).catch(() => {});

    // Start heartbeat
    const sendHeartbeat = () => {
      fetch("/api/analytics/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viewerId, path: pathname }),
      }).catch(() => {});
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 30000);

    return () => clearInterval(interval);
  }, [pathname]);

  return null;
}
