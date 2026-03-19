import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isAdmin } from "@/lib/auth";

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requestId = request.nextUrl.searchParams.get("request_id");
  if (!requestId) {
    return NextResponse.json({ error: "request_id required" }, { status: 400 });
  }

  const sql = getDb();

  const [requests, exchanges] = await Promise.all([
    sql`
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
      WHERE id = ${requestId}
    `,
    sql`
      SELECT
        id,
        exchange_number,
        agent,
        model,
        content,
        skipped,
        created_at
      FROM axon_exchanges
      WHERE request_id = ${requestId}
      ORDER BY exchange_number ASC
    `,
  ]);

  if (requests.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ request: requests[0], exchanges });
}
