import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

const PAGE_SIZE = 5;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const offset = (page - 1) * PAGE_SIZE;

  const sql = getDb();

  const [sessionsResult, exchangesResult, agentStats, totalSessionsCount, recentSessions] =
    await Promise.all([
      sql`SELECT COUNT(*) as count FROM sessions WHERE status = 'complete'`,
      sql`SELECT COUNT(*) as count FROM exchanges`,
      sql`
        SELECT agent, COUNT(*) as count
        FROM exchanges
        GROUP BY agent
        ORDER BY count DESC
      `,
      sql`SELECT COUNT(*) as count FROM sessions`,
      sql`
        SELECT id, created_at, completed_at, status, seed_thread, extracted_thread, exchange_count
        FROM sessions
        ORDER BY created_at DESC
        LIMIT ${PAGE_SIZE} OFFSET ${offset}
      `,
    ]);

  // Get active session info
  const activeSessions = await sql`
    SELECT id, exchange_count, status FROM sessions
    WHERE status = 'active'
    LIMIT 1
  `;

  const total = parseInt(totalSessionsCount[0].count as string);

  return NextResponse.json({
    totalSessions: parseInt(sessionsResult[0].count as string),
    totalExchanges: parseInt(exchangesResult[0].count as string),
    agentStats,
    recentSessions,
    activeSession: activeSessions[0] || null,
    pagination: {
      page,
      pageSize: PAGE_SIZE,
      totalSessions: total,
      totalPages: Math.ceil(total / PAGE_SIZE),
    },
  });
}
