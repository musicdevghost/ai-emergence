import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isAdmin } from "@/lib/auth";

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requestId = request.nextUrl.searchParams.get("request_id");
  const sql = getDb();

  if (requestId) {
    // Export single AXON request
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

  // Export all AXON requests
  const [requests, exchanges] = await Promise.all([
    sql`SELECT * FROM axon_requests ORDER BY created_at ASC`,
    sql`SELECT * FROM axon_exchanges ORDER BY turn_number ASC, exchange_number ASC`,
  ]);

  // Nest exchanges inside their requests
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
      totalRequests: requests.length,
      totalExchanges: exchanges.length,
      execCount: requests.filter((r) => r.output_decision === "EXEC").length,
      passCount: requests.filter((r) => r.output_decision === "PASS").length,
    },
    requests: requestsWithExchanges,
  });
}
