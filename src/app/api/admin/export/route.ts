import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isAdmin } from "@/lib/auth";

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessionId = request.nextUrl.searchParams.get("session_id");

  const sql = getDb();

  if (sessionId) {
    // Export single session
    const sessions = await sql`SELECT * FROM sessions WHERE id = ${sessionId}`;
    const exchanges = await sql`
      SELECT * FROM exchanges
      WHERE session_id = ${sessionId}
      ORDER BY exchange_number ASC
    `;
    const annotations = await sql`
      SELECT * FROM annotations
      WHERE session_id = ${sessionId} OR exchange_id = ANY(
        SELECT id FROM exchanges WHERE session_id = ${sessionId}
      )
    `;

    return NextResponse.json({
      session: sessions[0],
      exchanges,
      annotations,
      exportedAt: new Date().toISOString(),
    });
  }

  // Export all sessions
  const sessions = await sql`SELECT * FROM sessions ORDER BY created_at ASC`;
  const exchanges = await sql`SELECT * FROM exchanges ORDER BY created_at ASC`;

  return NextResponse.json({
    sessions,
    exchanges,
    exportedAt: new Date().toISOString(),
  });
}
