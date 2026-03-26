import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/** Public endpoint — returns confirmed hinges for ground reference tooltips */
export async function GET() {
  try {
    const sql = getDb();
    const hinges = await sql`
      SELECT id, content FROM hinges WHERE confirmed = true ORDER BY created_at ASC
    `;
    return NextResponse.json({ hinges });
  } catch {
    return NextResponse.json({ hinges: [] });
  }
}
