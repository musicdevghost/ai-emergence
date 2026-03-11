import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isAdmin } from "@/lib/auth";

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { exchangeId, sessionId, note } = await request.json();

  if (!note || (!exchangeId && !sessionId)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const sql = getDb();
  await sql`
    INSERT INTO annotations (exchange_id, session_id, note)
    VALUES (${exchangeId || null}, ${sessionId || null}, ${note})
  `;

  return NextResponse.json({ ok: true });
}

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const annotations = await sql`
    SELECT * FROM annotations ORDER BY created_at DESC LIMIT 100
  `;

  return NextResponse.json({ annotations });
}
