import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isAxonBeta } from "@/lib/auth";
import {
  runOneAxonExchange,
  type AxonExchange,
  type AxonContext,
  type ConversationTurn,
} from "@/lib/axon-engine";
import type { AxonRole } from "@/lib/axon-agents";

// Each call runs one LLM exchange — single focused call well within 30s
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  if (!isAxonBeta(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requestId = request.nextUrl.searchParams.get("request_id");
  if (!requestId) {
    return NextResponse.json({ error: "request_id required" }, { status: 400 });
  }

  const sql = getDb();

  const requests = await sql`
    SELECT id, status, input_text, exchange_count, output_decision, output_content,
           context_text, context_file_name, context_file_type, context_file_data,
           current_turn, current_input, conversation_turns
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

  const currentTurnNumber = (req.current_turn as number) ?? 0;

  // Get previous exchanges for THIS turn only (within-turn context)
  const prevRows = await sql`
    SELECT agent, content
    FROM axon_exchanges
    WHERE request_id = ${requestId}
      AND turn_number = ${currentTurnNumber}
    ORDER BY exchange_number ASC
  `;

  const previousExchanges = prevRows.map((r) => ({
    agent: r.agent as AxonRole,
    content: r.content as string,
  }));

  const exchangeNumber = req.exchange_count as number;

  // Build context — only pass file data on exchange 0 of turn 0
  const context: AxonContext = {};
  if (req.context_text) context.text = req.context_text as string;
  if (req.context_file_name && req.context_file_type) {
    context.file = {
      name: req.context_file_name as string,
      type: req.context_file_type as string,
      data: (exchangeNumber === 0 && currentTurnNumber === 0
        ? req.context_file_data
        : null) as string,
    };
  }

  // Conversation history from previous turns
  const conversationHistory = (req.conversation_turns as ConversationTurn[]) ?? [];

  // Current turn's input (follow-up text, or original input for turn 0)
  const currentInput = (req.current_input as string) ?? (req.input_text as string);

  try {
    const result = await runOneAxonExchange(
      requestId,
      currentInput,
      previousExchanges,
      exchangeNumber,
      context,
      currentTurnNumber,
      conversationHistory
    );

    // When complete, read output_content back from DB — guarantees full stored value
    let verdictContent: string | null = result.finalContent ?? null;
    if (result.isComplete) {
      const updated = await sql`
        SELECT output_content, output_decision FROM axon_requests WHERE id = ${requestId}
      `;
      if (updated.length > 0) {
        verdictContent = updated[0].output_content as string | null;
      }
    }

    return NextResponse.json({
      done: result.isComplete,
      exchange: {
        agent: result.role,
        content: result.content,
        exchange_number: exchangeNumber,
        skipped: result.skipped,
      } satisfies AxonExchange,
      decision: result.decision ?? null,
      content: verdictContent,
    });
  } catch (error) {
    console.error("AXON process error:", error);
    await sql`
      UPDATE axon_requests SET status = 'error' WHERE id = ${requestId}
    `;
    return NextResponse.json({ error: "Exchange failed" }, { status: 500 });
  }
}
