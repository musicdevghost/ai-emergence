import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

const RANGE_MAP: Record<string, string> = {
  "1d": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
  all: "100 years",
};

export async function GET(request: NextRequest) {
  try {
    const range = request.nextUrl.searchParams.get("range") || "all";
    const interval = RANGE_MAP[range] || RANGE_MAP.all;

    const sql = getDb();

    const [
      totalViews,
      uniqueVisitors,
      liveViewers,
      viewsByPage,
      dailyViews,
      totalSessions,
      totalExchanges,
    ] = await Promise.all([
      sql`SELECT COUNT(*) as count FROM page_views WHERE created_at > NOW() - INTERVAL ${interval}`,
      sql`SELECT COUNT(DISTINCT viewer_id) as count FROM page_views WHERE viewer_id IS NOT NULL AND created_at > NOW() - INTERVAL ${interval}`,
      sql`SELECT COUNT(*) as count FROM active_viewers WHERE last_seen > NOW() - INTERVAL '60 seconds'`,
      sql`
        SELECT path, COUNT(*) as count
        FROM page_views
        WHERE created_at > NOW() - INTERVAL ${interval}
        GROUP BY path
        ORDER BY count DESC
        LIMIT 10
      `,
      sql`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM page_views
        WHERE created_at > NOW() - INTERVAL ${interval}
        GROUP BY DATE(created_at)
        ORDER BY date ASC
        LIMIT 90
      `,
      sql`SELECT COUNT(*) as count FROM sessions WHERE status = 'complete' AND created_at > NOW() - INTERVAL ${interval}`,
      sql`SELECT COUNT(*) as count FROM exchanges WHERE created_at > NOW() - INTERVAL ${interval}`,
    ]);

    return NextResponse.json({
      totalViews: parseInt(totalViews[0].count as string),
      uniqueVisitors: parseInt(uniqueVisitors[0].count as string),
      liveViewers: parseInt(liveViewers[0].count as string),
      viewsByPage,
      dailyViews,
      totalSessions: parseInt(totalSessions[0].count as string),
      totalExchanges: parseInt(totalExchanges[0].count as string),
    });
  } catch (error) {
    console.error("Stats error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
