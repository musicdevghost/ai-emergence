import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isAdmin } from "@/lib/auth";

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();

  // Lazy-create the table in case migration hasn't been run yet
  await sql`
    CREATE TABLE IF NOT EXISTS proposals (
      id SERIAL PRIMARY KEY,
      content TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      session_id UUID REFERENCES sessions(id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `;

  const proposals = await sql`
    SELECT id, content, status, session_id, created_at
    FROM proposals
    ORDER BY created_at DESC
  `;

  return NextResponse.json({ proposals });
}

/** PATCH — approve, reject, or delete a proposal */
export async function PATCH(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, status, deleted } = await request.json();

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const sql = getDb();

  if (deleted === true) {
    await sql`DELETE FROM proposals WHERE id = ${id}`;
    return NextResponse.json({ ok: true, deleted: true });
  }

  if (status && ["pending", "approved", "rejected"].includes(status)) {
    await sql`UPDATE proposals SET status = ${status} WHERE id = ${id}`;
  }

  const rows = await sql`SELECT * FROM proposals WHERE id = ${id}`;
  return NextResponse.json({ ok: true, proposal: rows[0] });
}
