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
      sql`SELECT * FROM sessions ORDER BY created_at ASC`,
      sql`SELECT * FROM exchanges ORDER BY created_at ASC`,
      sql`SELECT * FROM iterations ORDER BY number ASC`,
    ]);

    // Nest exchanges inside their sessions
    const exchangesBySession: Record<string, typeof exchanges> = {};
    for (const ex of exchanges) {
      const sid = ex.session_id as string;
      if (!exchangesBySession[sid]) exchangesBySession[sid] = [];
      exchangesBySession[sid].push(ex);
    }

    const sessionsWithExchanges = sessions.map((s) => ({
      ...s,
      exchanges: exchangesBySession[s.id as string] ?? [],
    }));

    const exportData = {
      meta: {
        exportedAt: new Date().toISOString(),
        totalSessions: sessions.length,
        totalExchanges: exchanges.length,
        totalIterations: iterations.length,
      },
      iterations,
      sessions: sessionsWithExchanges,
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
