import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { put } from "@vercel/blob";

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sql = getDb();

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

    const blob = await put("exports/emergence-full-export.json", json, {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
    });

    return NextResponse.json({
      status: "ok",
      url: blob.url,
      size: json.length,
      sessions: sessions.length,
      exchanges: exchanges.length,
    });
  } catch (error) {
    console.error("Publish export cron error:", error);
    return NextResponse.json(
      { error: "Failed", detail: String(error) },
      { status: 500 }
    );
  }
}
