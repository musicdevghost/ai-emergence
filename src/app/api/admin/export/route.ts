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
      session: { ...sessions[0], exchanges, annotations },
      exportedAt: new Date().toISOString(),
    });
  }

  // Export all sessions
  const [sessions, exchanges, iterations, annotations, hinges, proposals] = await Promise.all([
    sql`SELECT * FROM sessions ORDER BY created_at ASC`,
    sql`SELECT * FROM exchanges ORDER BY created_at ASC`,
    sql`SELECT * FROM iterations ORDER BY number ASC`,
    sql`SELECT * FROM annotations ORDER BY created_at ASC`,
    sql`SELECT * FROM hinges ORDER BY created_at ASC`.catch(() => []),
    sql`SELECT * FROM proposals ORDER BY created_at ASC`.catch(() => []),
  ]);

  // Nest exchanges + annotations inside their sessions
  const exchangesBySession: Record<string, typeof exchanges> = {};
  for (const ex of exchanges) {
    const sid = ex.session_id as string;
    if (!exchangesBySession[sid]) exchangesBySession[sid] = [];
    exchangesBySession[sid].push(ex);
  }

  const annotationsBySession: Record<string, typeof annotations> = {};
  for (const an of annotations) {
    const sid = an.session_id as string;
    if (!annotationsBySession[sid]) annotationsBySession[sid] = [];
    annotationsBySession[sid].push(an);
  }

  const sessionsWithExchanges = sessions.map((s) => ({
    ...s,
    exchanges: exchangesBySession[s.id as string] ?? [],
    annotations: annotationsBySession[s.id as string] ?? [],
  }));

  return NextResponse.json({
    meta: {
      exportedAt: new Date().toISOString(),
      totalSessions: sessions.length,
      totalExchanges: exchanges.length,
      totalIterations: iterations.length,
      totalHinges: hinges.length,
      totalProposals: proposals.length,
    },
    iterations,
    hinges,
    proposals,
    sessions: sessionsWithExchanges,
  });
}
