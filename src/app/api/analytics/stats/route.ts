import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  try {
    const sql = getDb();

    const [totalViews, todayViews, uniqueVisitors, liveViewers, viewsByPage, dailyViews] =
      await Promise.all([
        sql`SELECT COUNT(*) as count FROM page_views`,
        sql`SELECT COUNT(*) as count FROM page_views WHERE created_at > NOW() - INTERVAL '24 hours'`,
        sql`SELECT COUNT(DISTINCT viewer_id) as count FROM page_views WHERE viewer_id IS NOT NULL`,
        sql`SELECT COUNT(*) as count FROM active_viewers WHERE last_seen > NOW() - INTERVAL '60 seconds'`,
        sql`
          SELECT path, COUNT(*) as count
          FROM page_views
          GROUP BY path
          ORDER BY count DESC
          LIMIT 10
        `,
        sql`
          SELECT DATE(created_at) as date, COUNT(*) as count
          FROM page_views
          WHERE created_at > NOW() - INTERVAL '30 days'
          GROUP BY DATE(created_at)
          ORDER BY date DESC
          LIMIT 30
        `,
      ]);

    return NextResponse.json({
      totalViews: parseInt(totalViews[0].count as string),
      todayViews: parseInt(todayViews[0].count as string),
      uniqueVisitors: parseInt(uniqueVisitors[0].count as string),
      liveViewers: parseInt(liveViewers[0].count as string),
      viewsByPage,
      dailyViews,
    });
  } catch (error) {
    console.error("Stats error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
