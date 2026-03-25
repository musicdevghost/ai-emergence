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

  // Lazy-add columns
  await sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS admin_note TEXT`;
  await sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP WITH TIME ZONE`;
  await sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS reviewer_decision VARCHAR(20)`;
  await sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS reviewer_reason TEXT`;
  await sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS exchange_number INTEGER`;

  const proposals = await sql`
    SELECT p.id, p.content, p.status, p.session_id, p.created_at, p.admin_note,
           p.reviewed_at, p.reviewer_decision, p.reviewer_reason,
           p.exchange_number,
           i.number AS iteration_number, i.name AS iteration_name
    FROM proposals p
    LEFT JOIN sessions s ON s.id = p.session_id
    LEFT JOIN iterations i ON i.id = s.iteration_id
    ORDER BY p.created_at DESC
  `;

  return NextResponse.json({ proposals });
}

/** PATCH — approve, reject, or delete a proposal */
export async function PATCH(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, status, deleted, admin_note } = await request.json();

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const sql = getDb();
  await sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS admin_note TEXT`;
  await sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP WITH TIME ZONE`;

  if (deleted === true) {
    await sql`DELETE FROM proposals WHERE id = ${id}`;
    return NextResponse.json({ ok: true, deleted: true });
  }

  if (status && ["pending", "approved", "rejected"].includes(status)) {
    if (status === "rejected") {
      if (!admin_note || !admin_note.trim()) {
        return NextResponse.json({ error: "admin_note is required when rejecting" }, { status: 400 });
      }
      await sql`UPDATE proposals SET status = ${status}, admin_note = ${admin_note.trim()}, reviewed_at = NOW() WHERE id = ${id}`;
    } else if (status === "approved") {
      await sql`UPDATE proposals SET status = ${status}, reviewed_at = NOW() WHERE id = ${id}`;
    } else {
      await sql`UPDATE proposals SET status = ${status} WHERE id = ${id}`;
    }
  }

  const rows = await sql`SELECT * FROM proposals WHERE id = ${id}`;
  return NextResponse.json({ ok: true, proposal: rows[0] });
}
