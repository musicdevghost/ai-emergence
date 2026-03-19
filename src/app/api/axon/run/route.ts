import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runAxon } from "@/lib/axon-engine";
import { isAxonBeta } from "@/lib/auth";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!isAxonBeta(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { input?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const input = body.input?.trim();
  if (!input) {
    return NextResponse.json({ error: "Input required" }, { status: 400 });
  }

  const sql = getDb();

  const requests = await sql`
    INSERT INTO axon_requests (input_text, status)
    VALUES (${input}, 'running')
    RETURNING id
  `;
  const requestId = requests[0].id as string;

  try {
    const result = await runAxon(requestId, input);
    return NextResponse.json({ requestId, ...result });
  } catch (error) {
    console.error("AXON engine error:", error);
    await sql`
      UPDATE axon_requests SET status = 'error' WHERE id = ${requestId}
    `;
    return NextResponse.json({ error: "Engine error" }, { status: 500 });
  }
}
