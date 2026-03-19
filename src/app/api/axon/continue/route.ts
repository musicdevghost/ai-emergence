import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isAxonBeta } from "@/lib/auth";
import type { ConversationTurn } from "@/lib/axon-engine";

export async function POST(request: NextRequest) {
  if (!isAxonBeta(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { request_id?: string; input?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { request_id: requestId, input } = body;
  if (!requestId) {
    return NextResponse.json({ error: "request_id required" }, { status: 400 });
  }
  const newInput = input?.trim();
  if (!newInput) {
    return NextResponse.json({ error: "input required" }, { status: 400 });
  }

  const sql = getDb();

  const rows = await sql`
    SELECT id, status, current_turn, input_text, current_input,
           output_decision, output_content, conversation_turns
    FROM axon_requests
    WHERE id = ${requestId}
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const req = rows[0];

  // Can only continue from a completed request
  if (req.status !== "complete") {
    return NextResponse.json(
      { error: "Can only continue a completed request" },
      { status: 400 }
    );
  }

  const currentTurnNumber = (req.current_turn as number) ?? 0;
  const prevTurns = (req.conversation_turns as ConversationTurn[]) ?? [];

  // Snapshot the current completed turn into conversation_turns
  const turnEntry: ConversationTurn = {
    turn: currentTurnNumber,
    user_input: (req.current_input as string) ?? (req.input_text as string),
    verdict: {
      decision: req.output_decision as "EXEC" | "PASS",
      content: req.output_content as string,
    },
  };

  const updatedTurns = [...prevTurns, turnEntry];
  const nextTurnNumber = currentTurnNumber + 1;

  // Reset to new turn
  await sql`
    UPDATE axon_requests SET
      conversation_turns = ${JSON.stringify(updatedTurns)},
      current_turn       = ${nextTurnNumber},
      current_input      = ${newInput},
      exchange_count     = 0,
      status             = 'pending',
      output_decision    = NULL,
      output_content     = NULL,
      completed_at       = NULL
    WHERE id = ${requestId}
  `;

  return NextResponse.json({ requestId, turnNumber: nextTurnNumber });
}
