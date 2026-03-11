import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isAdmin } from "@/lib/auth";

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const sessions = await sql`
    SELECT * FROM sessions
    ORDER BY created_at DESC
    LIMIT 50
  `;

  return NextResponse.json({ sessions });
}

/** PATCH — pause/resume/end a session */
export async function PATCH(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId, action } = await request.json();

  if (!sessionId || !["pause", "resume", "end"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const sql = getDb();

  if (action === "pause") {
    await sql`UPDATE sessions SET status = 'paused' WHERE id = ${sessionId}`;
  } else if (action === "resume") {
    await sql`UPDATE sessions SET status = 'active' WHERE id = ${sessionId}`;
  } else if (action === "end") {
    await sql`
      UPDATE sessions SET status = 'complete', completed_at = NOW()
      WHERE id = ${sessionId}
    `;
  }

  return NextResponse.json({ ok: true, action, sessionId });
}
