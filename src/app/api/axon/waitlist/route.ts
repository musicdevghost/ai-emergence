import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isAdmin } from "@/lib/auth";

async function ensureTable() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS axon_waitlist (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  return sql;
}

// POST /api/axon/waitlist — public, no auth
export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email required" }, { status: 400 });
    }
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.includes("@")) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const sql = await ensureTable();
    try {
      await sql`INSERT INTO axon_waitlist (email) VALUES (${trimmed})`;
    } catch (err: unknown) {
      // Unique violation — already registered
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: string }).code === "23505"
      ) {
        return NextResponse.json({ ok: true, duplicate: true });
      }
      throw err;
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Waitlist POST error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// GET /api/axon/waitlist — admin only
export async function GET(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sql = await ensureTable();
    const rows = await sql`
      SELECT id, email, created_at FROM axon_waitlist ORDER BY created_at DESC
    `;
    return NextResponse.json({ waitlist: rows, total: rows.length });
  } catch (error) {
    console.error("Waitlist GET error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
