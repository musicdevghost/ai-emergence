import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { put } from "@vercel/blob";

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Publish failed", detail: "BLOB_READ_WRITE_TOKEN is not set. Run `vercel env pull` locally or check Vercel project settings." },
      { status: 500 }
    );
  }

  try {
    const sql = getDb();

    // Gather all data
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
  } catch (error) {
    console.error("Publish export error:", error);
    return NextResponse.json(
      { error: "Publish failed", detail: String(error) },
      { status: 500 }
    );
  }
}
