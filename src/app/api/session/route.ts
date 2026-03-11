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

  // If session is complete, include next_session_at for countdown timer
  let nextSessionAt = session.next_session_at || null;
  if (session.status === "complete" && !nextSessionAt) {
    // Legacy session without stored time — check if a newer session exists
    const newer = await sql`
      SELECT created_at FROM sessions
      WHERE created_at > ${session.completed_at}
      ORDER BY created_at ASC LIMIT 1
    `;
    if (newer.length === 0) {
      // No next session yet, estimate from completed_at + 3.5h
      const est = new Date(new Date(session.completed_at).getTime() + 3.5 * 60 * 60 * 1000);
      nextSessionAt = est.toISOString();
    }
  }

  return NextResponse.json({ session: { ...session, next_session_at: nextSessionAt }, exchanges });
}
