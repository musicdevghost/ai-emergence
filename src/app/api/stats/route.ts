import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const sql = getDb();

  const [sessionsResult, exchangesResult, agentStats, recentSessions] =
    await Promise.all([
      sql`SELECT COUNT(*) as count FROM sessions WHERE status = 'complete'`,
      sql`SELECT COUNT(*) as count FROM exchanges`,
      sql`
        SELECT agent, COUNT(*) as count
        FROM exchanges
        GROUP BY agent
        ORDER BY count DESC
      `,
      sql`
        SELECT id, created_at, completed_at, status, seed_thread, extracted_thread, exchange_count
        FROM sessions
        ORDER BY created_at DESC
        LIMIT 20
      `,
    ]);

  // Get active session info
  const activeSessions = await sql`
    SELECT id, exchange_count, status FROM sessions
    WHERE status = 'active'
    LIMIT 1
  `;

  return NextResponse.json({
    totalSessions: parseInt(sessionsResult[0].count as string),
    totalExchanges: parseInt(exchangesResult[0].count as string),
    agentStats,
    recentSessions,
    activeSession: activeSessions[0] || null,
  });
}
