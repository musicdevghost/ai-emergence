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
    CREATE TABLE IF NOT EXISTS hinges (
      id SERIAL PRIMARY KEY,
      content TEXT NOT NULL,
      confirmed BOOLEAN DEFAULT FALSE,
      source TEXT DEFAULT 'witness',
      session_id UUID REFERENCES sessions(id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `;

  const hinges = await sql`
    SELECT h.id, h.content, h.confirmed, h.source, h.created_at,
           h.session_id
    FROM hinges h
    ORDER BY h.created_at ASC
  `;

  return NextResponse.json({ hinges });
}

/** PATCH — confirm or delete a hinge */
export async function PATCH(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, confirmed, deleted } = await request.json();

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const sql = getDb();

  if (deleted === true) {
    await sql`DELETE FROM hinges WHERE id = ${id}`;
    return NextResponse.json({ ok: true, deleted: true });
  }

  if (confirmed !== undefined) {
    await sql`UPDATE hinges SET confirmed = ${confirmed} WHERE id = ${id}`;
  }

  const rows = await sql`SELECT * FROM hinges WHERE id = ${id}`;
  return NextResponse.json({ ok: true, hinge: rows[0] });
}
