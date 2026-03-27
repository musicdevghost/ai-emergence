import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

function getCutoff(range: string): string {
  if (range === "all") return new Date("2020-01-01").toISOString();
  const days = parseInt(range) || 7;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") || "7";
  const cutoff = getCutoff(range);

  const sql = getDb();

  // Run all queries, each wrapped so a single failure doesn't kill the endpoint
  const safeQuery = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn(); } catch { return fallback; }
  };

  const [
    passRates,
    agentPasses,
    hingeStats,
    sessionsSinceLastHinge,
    avgExchanges,
    groundRefs,
    geoCountries,
    geoCities,
    hingesOverTime,
    returnVisitors,
    avgTimeByPath,
  ] = await Promise.all([
    // Pass rate by iteration
    safeQuery(() => sql`
      SELECT
        i.number as iteration,
        i.name,
        COUNT(e.id) as total_exchanges,
        COUNT(e.id) FILTER (WHERE e.skipped = true) as passes,
        ROUND(
          COUNT(e.id) FILTER (WHERE e.skipped = true)::numeric /
          NULLIF(COUNT(e.id), 0) * 100, 1
        ) as pass_pct
      FROM exchanges e
      JOIN sessions s ON e.session_id = s.id
      JOIN iterations i ON s.iteration_id = i.id
      GROUP BY i.number, i.name
      ORDER BY i.number
    `, []),

    // Per-agent pass rate, current iteration, within range
    safeQuery(() => sql`
      SELECT
        e.agent,
        COUNT(e.id) as total,
        COUNT(e.id) FILTER (WHERE e.skipped = true) as passes,
        ROUND(
          COUNT(e.id) FILTER (WHERE e.skipped = true)::numeric /
          NULLIF(COUNT(e.id), 0) * 100, 1
        ) as pass_pct
      FROM exchanges e
      JOIN sessions s ON e.session_id = s.id
      WHERE s.iteration_id = (
        SELECT id FROM iterations WHERE ended_at IS NULL ORDER BY number DESC LIMIT 1
      )
        AND s.created_at > ${cutoff}
      GROUP BY e.agent
      ORDER BY e.agent
    `, []),

    // Hinge stats
    safeQuery(async () => {
      const rows = await sql`
        SELECT
          COUNT(*) FILTER (WHERE confirmed = true) as confirmed,
          COUNT(*) FILTER (WHERE confirmed = false AND rejection_reason IS NOT NULL) as rejected,
          COUNT(*) FILTER (WHERE confirmed = false AND rejection_reason IS NULL) as pending
        FROM hinges
      `;
      return rows[0] ?? null;
    }, null),

    // Sessions since last confirmed hinge
    safeQuery(async () => {
      const rows = await sql`
        SELECT COUNT(*) as count
        FROM sessions
        WHERE status = 'complete'
          AND created_at > COALESCE(
            (
              SELECT MAX(s2.created_at)
              FROM hinges h
              JOIN sessions s2 ON h.session_id = s2.id
              WHERE h.confirmed = true
            ),
            '2020-01-01'
          )
      `;
      return parseInt(rows[0]?.count ?? "0");
    }, 0),

    // Avg exchanges per session (current iteration, within range)
    safeQuery(async () => {
      const rows = await sql`
        SELECT ROUND(AVG(exchange_count), 1) as avg
        FROM sessions
        WHERE status = 'complete'
          AND iteration_id = (
            SELECT id FROM iterations WHERE ended_at IS NULL ORDER BY number DESC LIMIT 1
          )
          AND created_at > ${cutoff}
      `;
      return rows[0]?.avg ?? null;
    }, null),

    // Most referenced hinges
    safeQuery(() => sql`
      SELECT
        h.id,
        LEFT(h.content, 80) as preview,
        COUNT(e.id) as reference_count
      FROM hinges h
      CROSS JOIN LATERAL (
        SELECT id FROM exchanges
        WHERE content ILIKE '%ground ' || h.id || '%'
          OR content ILIKE '%ground point ' || h.id || '%'
          OR content ILIKE '%ground rule ' || h.id || '%'
      ) e
      WHERE h.confirmed = true
      GROUP BY h.id, h.content
      ORDER BY reference_count DESC
      LIMIT 10
    `, []),

    // Geo: top countries
    safeQuery(() => sql`
      SELECT country, COUNT(*) as views
      FROM page_views
      WHERE country IS NOT NULL
        AND created_at > ${cutoff}
      GROUP BY country
      ORDER BY views DESC
      LIMIT 20
    `, []),

    // Geo: top cities
    safeQuery(() => sql`
      SELECT city, country, COUNT(*) as views
      FROM page_views
      WHERE city IS NOT NULL
        AND created_at > ${cutoff}
      GROUP BY city, country
      ORDER BY views DESC
      LIMIT 20
    `, []),

    // Hinges over time (weekly)
    safeQuery(() => sql`
      SELECT
        to_char(DATE_TRUNC('week', created_at), 'YYYY-MM-DD') as week,
        COUNT(*) FILTER (WHERE confirmed = true) as confirmed,
        COUNT(*) FILTER (WHERE confirmed = false AND rejection_reason IS NOT NULL) as rejected
      FROM hinges
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY week
    `, []),

    // Return visitors within range (viewed on >1 distinct day)
    safeQuery(async () => {
      const rows = await sql`
        SELECT COUNT(DISTINCT persistent_viewer_id) as count
        FROM (
          SELECT persistent_viewer_id
          FROM page_views
          WHERE persistent_viewer_id IS NOT NULL
            AND created_at > ${cutoff}
          GROUP BY persistent_viewer_id
          HAVING COUNT(DISTINCT DATE(created_at)) > 1
        ) returning_visitors
      `;
      return parseInt(rows[0]?.count ?? "0");
    }, null),

    // Avg time on page by path within range (from heartbeat_log)
    safeQuery(() => sql`
      SELECT
        path,
        ROUND(AVG(heartbeat_count * 30), 0) as avg_seconds
      FROM (
        SELECT viewer_id, path, COUNT(*) as heartbeat_count
        FROM heartbeat_log
        WHERE created_at > ${cutoff}
        GROUP BY viewer_id, path
      ) per_visit
      GROUP BY path
      ORDER BY avg_seconds DESC
      LIMIT 10
    `, []),
  ]);

  return NextResponse.json({
    passRates,
    agentPasses,
    hingeStats,
    sessionsSinceLastHinge,
    avgExchangesPerSession: avgExchanges,
    groundRefs,
    geoCountries,
    geoCities,
    hingesOverTime,
    returnVisitors,
    avgTimeByPath,
  });
}
