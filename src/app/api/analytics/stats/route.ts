import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const RANGE_DAYS: Record<string, number> = {
  "1d": 0,    // start of today
  "7d": 6,    // 6 days back + today = 7 days
  "30d": 29,  // 29 days back + today = 30 days
  all: 365 * 100,
};

export async function GET(request: NextRequest) {
  try {
    const range = request.nextUrl.searchParams.get("range") || "all";
    const daysBack = RANGE_DAYS[range] ?? RANGE_DAYS.all;
    // Align cutoff to start of day (midnight) so daily counts are always complete
    const cutoffDate = new Date();
    cutoffDate.setHours(0, 0, 0, 0);
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
    const cutoff = cutoffDate.toISOString();

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
      sql`SELECT COUNT(*) as count FROM page_views WHERE created_at > ${cutoff}`,
      sql`SELECT COUNT(DISTINCT viewer_id) as count FROM page_views WHERE viewer_id IS NOT NULL AND created_at > ${cutoff}`,
      sql`SELECT COUNT(*) as count FROM active_viewers WHERE last_seen > NOW() - INTERVAL '60 seconds'`,
      sql`
        SELECT path, COUNT(*) as count
        FROM page_views
        WHERE created_at > ${cutoff}
        GROUP BY path
        ORDER BY count DESC
        LIMIT 10
      `,
      sql`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM page_views
        WHERE created_at > ${cutoff}
        GROUP BY DATE(created_at)
        ORDER BY date ASC
        LIMIT 90
      `,
      sql`SELECT COUNT(*) as count FROM sessions WHERE status = 'complete' AND created_at > ${cutoff}`,
      sql`SELECT COUNT(*) as count FROM exchanges WHERE created_at > ${cutoff}`,
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
