import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isAdmin } from "@/lib/auth";

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();

  const requests = await sql`
    SELECT
      id,
      created_at,
      completed_at,
      status,
      input_text,
      output_decision,
      output_content,
      confidence_level,
      exchange_count,
      request_token
    FROM axon_requests
    ORDER BY created_at DESC
    LIMIT 100
  `;

  // Stats
  const stats = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE output_decision = 'EXEC')::int AS exec_count,
      COUNT(*) FILTER (WHERE output_decision = 'PASS')::int AS pass_count,
      COUNT(*) FILTER (WHERE status NOT IN ('complete', 'error'))::int AS active_count,
      ROUND(AVG(exchange_count), 1) AS avg_exchanges
    FROM axon_requests
  `;

  return NextResponse.json({ requests, stats: stats[0] });
}
