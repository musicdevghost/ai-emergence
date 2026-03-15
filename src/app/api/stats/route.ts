import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

const PAGE_SIZE = 5;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const offset = (page - 1) * PAGE_SIZE;
  const iterationFilter = searchParams.get("iteration");

  const sql = getDb();

  // Build session queries with optional iteration filter
  const hasFilter = iterationFilter && iterationFilter !== "all";

  const [
    sessionsResult,
    exchangesResult,
    agentStats,
    totalSessionsCount,
    recentSessions,
    iterations,
  ] = await Promise.all([
    sql`SELECT COUNT(*) as count FROM sessions WHERE status = 'complete'`,
    sql`SELECT COUNT(*) as count FROM exchanges`,
    sql`
      SELECT agent, COUNT(*) as count
      FROM exchanges
      GROUP BY agent
      ORDER BY count DESC
    `,
    hasFilter
      ? sql`SELECT COUNT(*) as count FROM sessions WHERE iteration_id = ${parseInt(iterationFilter, 10)}`
      : sql`SELECT COUNT(*) as count FROM sessions`,
    hasFilter
      ? sql`
          SELECT s.id, s.created_at, s.completed_at, s.status, s.seed_thread,
                 s.extracted_thread, s.exchange_count, s.iteration_id,
                 i.number as iteration_number, i.name as iteration_name
          FROM sessions s
          LEFT JOIN iterations i ON s.iteration_id = i.id
          WHERE s.iteration_id = ${parseInt(iterationFilter, 10)}
          ORDER BY s.created_at DESC
          LIMIT ${PAGE_SIZE} OFFSET ${offset}
        `
      : sql`
          SELECT s.id, s.created_at, s.completed_at, s.status, s.seed_thread,
                 s.extracted_thread, s.exchange_count, s.iteration_id,
                 i.number as iteration_number, i.name as iteration_name
          FROM sessions s
          LEFT JOIN iterations i ON s.iteration_id = i.id
          ORDER BY s.created_at DESC
          LIMIT ${PAGE_SIZE} OFFSET ${offset}
        `,
    sql`SELECT id, number, name, tagline, description, notable_moments, conclusion, started_at, ended_at FROM iterations ORDER BY number ASC`,
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
    iterations,
    pagination: {
      page,
      pageSize: PAGE_SIZE,
      totalSessions: total,
      totalPages: Math.ceil(total / PAGE_SIZE),
    },
  });
}
