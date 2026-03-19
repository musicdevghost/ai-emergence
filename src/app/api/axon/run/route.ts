import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isAxonBeta } from "@/lib/auth";

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
    VALUES (${input}, 'pending')
    RETURNING id
  `;

  return NextResponse.json({ requestId: requests[0].id });
}
