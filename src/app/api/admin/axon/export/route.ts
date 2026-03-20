import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isAdmin } from "@/lib/auth";

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const requestId = searchParams.get("request_id");
  const version = searchParams.get("version"); // "v1" | "v2" | null

  const sql = getDb();

  if (requestId) {
    // Export single AXON request — no version filter needed
    const requests = await sql`
      SELECT * FROM axon_requests WHERE id = ${requestId}
    `;
    if (requests.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const exchanges = await sql`
      SELECT * FROM axon_exchanges
      WHERE request_id = ${requestId}
      ORDER BY turn_number ASC, exchange_number ASC
    `;
    return NextResponse.json({
      request: requests[0],
      exchanges,
      exportedAt: new Date().toISOString(),
    });
  }

  // Bulk export — optionally filtered by version
  const requests = version === "v2"
    ? await sql`
        SELECT * FROM axon_requests r
        WHERE EXISTS (
          SELECT 1 FROM axon_exchanges e WHERE e.request_id = r.id AND e.agent = 'executor'
        )
        ORDER BY r.created_at ASC
      `
    : version === "v1"
    ? await sql`
        SELECT * FROM axon_requests r
        WHERE NOT EXISTS (
          SELECT 1 FROM axon_exchanges e WHERE e.request_id = r.id AND e.agent = 'executor'
        )
        ORDER BY r.created_at ASC
      `
    : await sql`SELECT * FROM axon_requests ORDER BY created_at ASC`;

  const requestIds = requests.map((r) => r.id as string);

  const exchanges = requestIds.length > 0
    ? await sql`
        SELECT * FROM axon_exchanges
        WHERE request_id = ANY(${requestIds})
        ORDER BY turn_number ASC, exchange_number ASC
      `
    : [];

  // Nest exchanges inside requests
  const exchangesByRequest: Record<string, typeof exchanges> = {};
  for (const ex of exchanges) {
    const rid = ex.request_id as string;
    if (!exchangesByRequest[rid]) exchangesByRequest[rid] = [];
    exchangesByRequest[rid].push(ex);
  }

  const requestsWithExchanges = requests.map((r) => ({
    ...r,
    exchanges: exchangesByRequest[r.id as string] ?? [],
  }));

  return NextResponse.json({
    meta: {
      exportedAt: new Date().toISOString(),
      version: version ?? "all",
      totalRequests: requests.length,
      totalExchanges: exchanges.length,
      execCount: requests.filter((r) => r.output_decision === "EXEC").length,
      passCount: requests.filter((r) => r.output_decision === "PASS").length,
    },
    requests: requestsWithExchanges,
  });
}
