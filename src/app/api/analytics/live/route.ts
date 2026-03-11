import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  try {
    const sql = getDb();
    const result = await sql`
      SELECT COUNT(*) as count FROM active_viewers
      WHERE last_seen > NOW() - INTERVAL '60 seconds'
    `;

    return NextResponse.json({
      viewers: parseInt(result[0].count as string),
    });
  } catch (error) {
    console.error("Live count error:", error);
    return NextResponse.json({ viewers: 0 });
  }
}
