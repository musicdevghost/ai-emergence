import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const { path, viewerId, persistentViewerId } = await request.json();
    if (!path) {
      return NextResponse.json({ error: "path required" }, { status: 400 });
    }

    const country = request.headers.get("x-vercel-ip-country") || null;
    const rawCity = request.headers.get("x-vercel-ip-city") || null;
    const city = rawCity ? decodeURIComponent(rawCity) : null;
    const region = request.headers.get("x-vercel-ip-region") || null;

    const sql = getDb();
    await sql`
      INSERT INTO page_views (path, viewer_id, country, city, region, persistent_viewer_id)
      VALUES (${path}, ${viewerId || null}, ${country}, ${city}, ${region}, ${persistentViewerId || null})
    `;

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Analytics view error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
