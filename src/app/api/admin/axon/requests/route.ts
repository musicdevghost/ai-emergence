import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isAdmin } from "@/lib/auth";

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const version = searchParams.get("version"); // "v1" | "v2" | null

  const sql = getDb();

  // Version is derived: v2 = has any executor exchange, v1 = no executor exchange
  const [requestsRaw, statsRaw, v2CountRaw, totalCountRaw] = await Promise.all([
    // Requests list — filtered by version if provided, version column always derived
    version === "v2"
      ? sql`
          SELECT r.*, 'v2' AS version
          FROM axon_requests r
          WHERE EXISTS (
            SELECT 1 FROM axon_exchanges e WHERE e.request_id = r.id AND e.agent = 'executor'
          )
          ORDER BY r.created_at DESC
          LIMIT 100
        `
      : version === "v1"
      ? sql`
          SELECT r.*, 'v1' AS version
          FROM axon_requests r
          WHERE NOT EXISTS (
            SELECT 1 FROM axon_exchanges e WHERE e.request_id = r.id AND e.agent = 'executor'
          )
          ORDER BY r.created_at DESC
          LIMIT 100
        `
      : sql`
          SELECT r.*,
            CASE WHEN EXISTS (
              SELECT 1 FROM axon_exchanges e WHERE e.request_id = r.id AND e.agent = 'executor'
            ) THEN 'v2' ELSE 'v1' END AS version
          FROM axon_requests r
          ORDER BY r.created_at DESC
          LIMIT 100
        `,

    // Stats — scoped to the active version filter
    version === "v2"
      ? sql`
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE output_decision = 'EXEC')::int AS exec_count,
            COUNT(*) FILTER (WHERE output_decision = 'PASS')::int AS pass_count,
            COUNT(*) FILTER (WHERE status NOT IN ('complete', 'error'))::int AS active_count,
            ROUND(AVG(exchange_count), 1) AS avg_exchanges
          FROM axon_requests r
          WHERE EXISTS (
            SELECT 1 FROM axon_exchanges e WHERE e.request_id = r.id AND e.agent = 'executor'
          )
        `
      : version === "v1"
      ? sql`
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE output_decision = 'EXEC')::int AS exec_count,
            COUNT(*) FILTER (WHERE output_decision = 'PASS')::int AS pass_count,
            COUNT(*) FILTER (WHERE status NOT IN ('complete', 'error'))::int AS active_count,
            ROUND(AVG(exchange_count), 1) AS avg_exchanges
          FROM axon_requests r
          WHERE NOT EXISTS (
            SELECT 1 FROM axon_exchanges e WHERE e.request_id = r.id AND e.agent = 'executor'
          )
        `
      : sql`
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE output_decision = 'EXEC')::int AS exec_count,
            COUNT(*) FILTER (WHERE output_decision = 'PASS')::int AS pass_count,
            COUNT(*) FILTER (WHERE status NOT IN ('complete', 'error'))::int AS active_count,
            ROUND(AVG(exchange_count), 1) AS avg_exchanges
          FROM axon_requests r
        `,

    // Always from full dataset — used to label version pills
    sql`SELECT COUNT(DISTINCT request_id)::int AS count FROM axon_exchanges WHERE agent = 'executor'`,
    sql`SELECT COUNT(*)::int AS count FROM axon_requests`,
  ]);

  const v2Count = (v2CountRaw[0].count as number) ?? 0;
  const totalAll = (totalCountRaw[0].count as number) ?? 0;

  return NextResponse.json({
    requests: requestsRaw,
    stats: {
      ...statsRaw[0],
      v1_count: totalAll - v2Count,
      v2_count: v2Count,
    },
  });
}
