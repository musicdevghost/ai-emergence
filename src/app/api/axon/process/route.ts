import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isAxonBeta } from "@/lib/auth";
import { runOneAxonExchange, type AxonExchange } from "@/lib/axon-engine";
import type { AxonRole } from "@/lib/axon-agents";

// Each call runs one LLM exchange — well within 30s per-function limit
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  if (!isAxonBeta(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { request_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const requestId = body.request_id;
  if (!requestId) {
    return NextResponse.json({ error: "request_id required" }, { status: 400 });
  }

  const sql = getDb();

  // Get the request
  const requests = await sql`
    SELECT id, status, input_text, exchange_count, output_decision, output_content
    FROM axon_requests
    WHERE id = ${requestId}
  `;

  if (requests.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const req = requests[0];

  // Already done — return final state immediately
  if (req.status === "complete" || req.status === "error") {
    return NextResponse.json({
      done: true,
      decision: req.output_decision,
      content: req.output_content,
    });
  }

  // Get previous exchanges for context
  const prevRows = await sql`
    SELECT agent, content
    FROM axon_exchanges
    WHERE request_id = ${requestId}
    ORDER BY exchange_number ASC
  `;

  const previousExchanges = prevRows.map((r) => ({
    agent: r.agent as AxonRole,
    content: r.content as string,
  }));

  const exchangeNumber = req.exchange_count as number;

  try {
    const result = await runOneAxonExchange(
      requestId,
      req.input_text as string,
      previousExchanges,
      exchangeNumber
    );

    return NextResponse.json({
      done: result.isComplete,
      exchange: {
        agent: result.role,
        content: result.content,
        exchange_number: exchangeNumber,
        skipped: result.skipped,
      } satisfies AxonExchange,
      decision: result.decision ?? null,
      content: result.finalContent ?? null,
    });
  } catch (error) {
    console.error("AXON process error:", error);
    await sql`
      UPDATE axon_requests SET status = 'error' WHERE id = ${requestId}
    `;
    return NextResponse.json({ error: "Exchange failed" }, { status: 500 });
  }
}
