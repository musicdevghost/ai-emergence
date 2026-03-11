import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get("email");

  if (!email) {
    return NextResponse.json({ error: "Email required" }, { status: 400 });
  }

  try {
    const sql = getDb();
    await sql`
      UPDATE subscribers SET active = FALSE WHERE email = ${email}
    `;

    return new NextResponse(
      `<html><body style="background:#0a0a0a;color:#888;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="text-align:center"><p style="font-size:10px;text-transform:uppercase;letter-spacing:0.2em">Emergence</p><p style="font-size:14px;color:#ccc">You have been unsubscribed.</p></div></body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to unsubscribe" },
      { status: 500 }
    );
  }
}
