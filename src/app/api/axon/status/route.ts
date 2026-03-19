import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isAxonBeta } from "@/lib/auth";

export async function GET(request: NextRequest) {
  if (!isAxonBeta(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requestId = request.nextUrl.searchParams.get("request_id");
  if (!requestId) {
    return NextResponse.json({ error: "request_id required" }, { status: 400 });
  }

  const sql = getDb();

  const [requests, exchanges] = await Promise.all([
    sql`
      SELECT id, status, exchange_count, output_decision, output_content,
             conversation_turns, current_turn, current_input, input_text
      FROM axon_requests
      WHERE id = ${requestId}
    `,
    sql`
      SELECT id, exchange_number, agent, model, content, skipped, created_at, turn_number
      FROM axon_exchanges
      WHERE request_id = ${requestId}
      ORDER BY turn_number ASC, exchange_number ASC
    `,
  ]);

  if (requests.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const req = requests[0];

  return NextResponse.json({
    status: req.status,
    exchanges,
    decision: req.output_decision,
    content: req.output_content,
    exchange_count: req.exchange_count,
    conversation_turns: req.conversation_turns ?? [],
    current_turn: req.current_turn ?? 0,
    current_input: req.current_input ?? null,
    input_text: req.input_text,
  });
}
