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

  // Get iteration info
  const iterationRows = session.iteration_id
    ? await sql`SELECT number, name FROM iterations WHERE id = ${session.iteration_id}`
    : [];
  const iteration = iterationRows.length > 0
    ? { number: iterationRows[0].number, name: iterationRows[0].name }
    : null;

  const exchanges = await sql`
    SELECT id, exchange_number, agent, content, skipped, created_at
    FROM exchanges
    WHERE session_id = ${session.id}
    ORDER BY exchange_number ASC
  `;

  // If session has a seed_thread, fetch key_moments from the session that produced it
  let prevKeyMoments: string[] | null = null;
  if (session.seed_thread) {
    const prevSession = await sql`
      SELECT key_moments FROM sessions
      WHERE extracted_thread = ${session.seed_thread} AND status = 'complete'
      ORDER BY completed_at DESC LIMIT 1
    `;
    if (prevSession.length > 0 && prevSession[0].key_moments) {
      prevKeyMoments = prevSession[0].key_moments as string[];
    }
  }

  // Check if there is an active (not ended) iteration
  const activeIterationRows = await sql`
    SELECT id FROM iterations WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1
  `;
  const hasActiveIteration = activeIterationRows.length > 0;

  // If session is complete, include next_session_at for countdown timer
  let nextSessionAt = session.next_session_at || null;
  if (session.status === "complete" && !nextSessionAt && hasActiveIteration) {
    // Legacy session without stored time — check if a newer session exists
    const newer = await sql`
      SELECT created_at FROM sessions
      WHERE created_at > ${session.completed_at}
      ORDER BY created_at ASC LIMIT 1
    `;
    if (newer.length === 0) {
      // Active iteration exists — next session is coming, estimate from completed_at + 3.5h
      const est = new Date(new Date(session.completed_at).getTime() + 3.5 * 60 * 60 * 1000);
      nextSessionAt = est.toISOString();
    }
  }
  // If no active iteration: iteration was manually ended, nextSessionAt stays null

  return NextResponse.json({
    session: { ...session, next_session_at: nextSessionAt, iteration, prev_key_moments: prevKeyMoments },
    exchanges,
    hasActiveIteration,
  });
}
