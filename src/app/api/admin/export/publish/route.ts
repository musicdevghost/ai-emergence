import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { put, list } from "@vercel/blob";

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();

  // Gather all data
  const [sessions, exchanges, iterations] = await Promise.all([
    sql`SELECT id, created_at, completed_at, status, seed_thread, extracted_thread,
               exchange_count, is_baseline, iteration_id, key_moments
        FROM sessions ORDER BY created_at ASC`,
    sql`SELECT id, session_id, exchange_number, agent, model, content, created_at
        FROM exchanges ORDER BY created_at ASC`,
    sql`SELECT id, number, name, tagline, description, notable_moments, conclusion,
               started_at, ended_at
        FROM iterations ORDER BY number ASC`,
  ]);

  const exportData = {
    meta: {
      exportedAt: new Date().toISOString(),
      totalSessions: sessions.length,
      totalExchanges: exchanges.length,
      totalIterations: iterations.length,
    },
    iterations,
    sessions,
    exchanges,
  };

  const json = JSON.stringify(exportData, null, 2);

  // Delete previous exports to avoid blob storage buildup
  try {
    const existing = await list({ prefix: "exports/" });
    for (const blob of existing.blobs) {
      // We don't need to delete — overwriting with the same path handles it
      // But list is useful for diagnostics
    }
  } catch {
    // Ignore list errors
  }

  // Upload to Vercel Blob with a stable path
  const blob = await put("exports/emergence-full-export.json", json, {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
  });

  return NextResponse.json({
    ok: true,
    url: blob.url,
    size: json.length,
    sessions: sessions.length,
    exchanges: exchanges.length,
  });
}
