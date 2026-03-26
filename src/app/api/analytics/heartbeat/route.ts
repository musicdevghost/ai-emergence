import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const { viewerId, path } = await request.json();
    if (!viewerId) {
      return NextResponse.json({ error: "viewerId required" }, { status: 400 });
    }

    const sql = getDb();

    await Promise.all([
      // Upsert active presence
      sql`
        INSERT INTO active_viewers (viewer_id, path, last_seen)
        VALUES (${viewerId}, ${path || "/"}, NOW())
        ON CONFLICT (viewer_id) DO UPDATE SET last_seen = NOW(), path = ${path || "/"}
      `,
      // Log for time-on-page calculation
      sql`
        INSERT INTO heartbeat_log (viewer_id, path) VALUES (${viewerId}, ${path || "/"})
      `,
    ]);

    // Clean up stale viewers (>60s)
    await sql`DELETE FROM active_viewers WHERE last_seen < NOW() - INTERVAL '60 seconds'`;

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Heartbeat error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
