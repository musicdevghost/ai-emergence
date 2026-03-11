import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const { path, viewerId } = await request.json();
    if (!path) {
      return NextResponse.json({ error: "path required" }, { status: 400 });
    }

    const sql = getDb();
    await sql`
      INSERT INTO page_views (path, viewer_id)
      VALUES (${path}, ${viewerId || null})
    `;

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Analytics view error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
