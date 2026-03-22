import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// Ensure departure annotation columns exist (idempotent — runs once per server instance)
let columnsReady = false;
async function ensureDepartureColumns() {
  if (columnsReady) return;
  const sql = getDb();
  await sql`ALTER TABLE exchanges ADD COLUMN IF NOT EXISTS pattern_departure BOOLEAN DEFAULT NULL`;
  await sql`ALTER TABLE exchanges ADD COLUMN IF NOT EXISTS departure_note TEXT DEFAULT NULL`;
  columnsReady = true;
}

/** GET /api/exchanges?session_id=...&after=N — poll for new exchanges */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("session_id");
  const after = parseInt(searchParams.get("after") || "-1", 10);

  if (!sessionId) {
    return NextResponse.json({ error: "session_id required" }, { status: 400 });
  }

  const sql = getDb();
  await ensureDepartureColumns();

  const exchanges = await sql`
    SELECT id, exchange_number, agent, model, content, skipped, created_at, pattern_departure, departure_note
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
