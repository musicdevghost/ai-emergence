import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/** GET /api/session — returns the current or most recent session with exchanges */
export async function GET() {
  const sql = getDb();

  // Get the most recent active or recently completed session
  const sessions = await sql`
    SELECT * FROM sessions
    WHERE status IN ('active', 'paused', 'complete')
    ORDER BY
      CASE WHEN status = 'active' THEN 0
           WHEN status = 'paused' THEN 1
           ELSE 2 END,
      created_at DESC
    LIMIT 1
  `;

  if (sessions.length === 0) {
    return NextResponse.json({ session: null, exchanges: [] });
  }

  const session = sessions[0];

  const exchanges = await sql`
    SELECT id, exchange_number, agent, content, created_at
    FROM exchanges
    WHERE session_id = ${session.id}
    ORDER BY exchange_number ASC
  `;

  return NextResponse.json({ session, exchanges });
}
