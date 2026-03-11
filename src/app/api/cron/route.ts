import { NextRequest, NextResponse } from "next/server";
import { getActiveSession, runNextExchange } from "@/lib/engine";
import { getDb } from "@/lib/db";
import { AGENTS } from "@/lib/agents";

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const session = await getActiveSession();
    if (!session) {
      return NextResponse.json({ status: "waiting", message: "Between sessions" });
    }

    if (session.status === "paused") {
      return NextResponse.json({ status: "paused", sessionId: session.id });
    }

    // Run the next exchange (loop detection happens inside, before API call)
    const result = await runNextExchange(session);

    return NextResponse.json({
      status: "ok",
      sessionId: session.id,
      exchange: {
        number: result.exchangeNumber,
        agent: AGENTS[result.role].name,
        content: result.content,
      },
    });
  } catch (error) {
    console.error("Cron error:", error);

    // Pause session on persistent failure
    try {
      const sql = getDb();
      await sql`
        UPDATE sessions SET status = 'paused'
        WHERE status = 'active'
      `;
    } catch {
      // Best effort
    }

    return NextResponse.json(
      { error: "Exchange failed", detail: String(error) },
      { status: 500 }
    );
  }
}
