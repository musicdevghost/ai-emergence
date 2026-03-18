import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/** GET /api/exchanges?session_id=...&after=N — poll for new exchanges */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("session_id");
  const after = parseInt(searchParams.get("after") || "-1", 10);

  if (!sessionId) {
    return NextResponse.json({ error: "session_id required" }, { status: 400 });
  }

  const sql = getDb();

  const exchanges = await sql`
    SELECT id, exchange_number, agent, content, skipped, created_at
    FROM exchanges
    WHERE session_id = ${sessionId} AND exchange_number > ${after}
    ORDER BY exchange_number ASC
  `;

  // Also return current session status
  const sessions = await sql`
    SELECT status, exchange_count FROM sessions WHERE id = ${sessionId}
  `;

  return NextResponse.json({
    exchanges,
    sessionStatus: sessions[0]?.status || "unknown",
    exchangeCount: sessions[0]?.exchange_count || 0,
  });
}
