import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isAdmin } from "@/lib/auth";

async function ensureColumns() {
  const sql = getDb();
  await sql`ALTER TABLE exchanges ADD COLUMN IF NOT EXISTS pattern_departure BOOLEAN DEFAULT NULL`;
  await sql`ALTER TABLE exchanges ADD COLUMN IF NOT EXISTS departure_note TEXT DEFAULT NULL`;
  return sql;
}

// PATCH /api/admin/exchanges — set pattern_departure and departure_note on an exchange
export async function PATCH(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id, pattern_departure, departure_note } = await request.json();

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "Exchange id required" }, { status: 400 });
    }

    const sql = await ensureColumns();

    await sql`
      UPDATE exchanges
      SET pattern_departure = ${pattern_departure ?? null},
          departure_note = ${departure_note ?? null}
      WHERE id = ${id}
    `;

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("PATCH /api/admin/exchanges error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
