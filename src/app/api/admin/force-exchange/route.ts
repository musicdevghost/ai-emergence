import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { getActiveSession, runNextExchange } from "@/lib/engine";
import { AGENTS } from "@/lib/agents";

export const maxDuration = 60;

/**
 * POST /api/admin/force-exchange
 *
 * Immediately runs the next exchange, bypassing the session gap timer.
 * If no session is active, clears the next_session_at on the last completed
 * session so getActiveSession() creates a new one, then fires the first exchange.
 */
export async function POST(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();

  // If no active session, clear the gap timer on the last completed one
  const active = await sql`
    SELECT id FROM sessions WHERE status IN ('active', 'paused') LIMIT 1
  `;

  if (active.length === 0) {
    await sql`
      UPDATE sessions
      SET next_session_at = NOW() - INTERVAL '1 second'
      WHERE id = (
        SELECT id FROM sessions
        WHERE status = 'complete'
        ORDER BY completed_at DESC
        LIMIT 1
      )
    `;
  }

  const session = await getActiveSession({ silent: true });

  if (!session) {
    return NextResponse.json({ error: "Could not create or find a session" }, { status: 500 });
  }

  if (session.status === "paused") {
    return NextResponse.json({ error: "Session is paused — resume it first" }, { status: 409 });
  }

  const result = await runNextExchange(session);

  return NextResponse.json({
    ok: true,
    sessionId: session.id,
    isNewSession: active.length === 0,
    exchange: {
      number: result.exchangeNumber + 1,
      agent: AGENTS[result.role].name,
      skipped: result.skipped,
      content: result.content,
    },
  });
}
