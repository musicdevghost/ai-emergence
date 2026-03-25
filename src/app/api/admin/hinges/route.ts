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

  // Lazy-add columns
  await sql`ALTER TABLE hinges ADD COLUMN IF NOT EXISTS rejection_reason TEXT`;
  await sql`ALTER TABLE hinges ADD COLUMN IF NOT EXISTS reviewer_decision VARCHAR(20)`;
  await sql`ALTER TABLE hinges ADD COLUMN IF NOT EXISTS reviewer_reason TEXT`;
  await sql`ALTER TABLE hinges ADD COLUMN IF NOT EXISTS exchange_number INTEGER`;

  const hinges = await sql`
    SELECT h.id, h.content, h.confirmed, h.source, h.created_at,
           h.session_id, h.rejection_reason,
           h.reviewer_decision, h.reviewer_reason,
           h.exchange_number,
           i.number AS iteration_number, i.name AS iteration_name
    FROM hinges h
    LEFT JOIN sessions s ON s.id = h.session_id
    LEFT JOIN iterations i ON i.id = s.iteration_id
    ORDER BY h.created_at ASC
  `;

  return NextResponse.json({ hinges });
}

/** PATCH — confirm or delete a hinge */
export async function PATCH(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, confirmed, deleted, rejection_reason } = await request.json();

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const sql = getDb();
  await sql`ALTER TABLE hinges ADD COLUMN IF NOT EXISTS rejection_reason TEXT`;
  await sql`ALTER TABLE hinges ADD COLUMN IF NOT EXISTS reviewer_decision VARCHAR(20)`;
  await sql`ALTER TABLE hinges ADD COLUMN IF NOT EXISTS reviewer_reason TEXT`;

  if (deleted === true) {
    await sql`DELETE FROM hinges WHERE id = ${id}`;
    return NextResponse.json({ ok: true, deleted: true });
  }

  // Reject with reason: store reason, keep confirmed=false
  if (rejection_reason !== undefined) {
    if (!rejection_reason || !rejection_reason.trim()) {
      return NextResponse.json({ error: "rejection_reason is required" }, { status: 400 });
    }
    await sql`UPDATE hinges SET confirmed = FALSE, rejection_reason = ${rejection_reason.trim()} WHERE id = ${id}`;
  } else if (confirmed !== undefined) {
    // Confirming clears any prior rejection reason
    await sql`UPDATE hinges SET confirmed = ${confirmed}, rejection_reason = NULL WHERE id = ${id}`;
  }

  const rows = await sql`SELECT * FROM hinges WHERE id = ${id}`;
  return NextResponse.json({ ok: true, hinge: rows[0] });
}
