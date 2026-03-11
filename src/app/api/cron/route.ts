import { NextRequest, NextResponse } from "next/server";
import { getActiveSession, runNextExchange, detectLoop } from "@/lib/engine";
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

    // Run the next exchange
    const result = await runNextExchange(session);

    // Check for loops
    const isLooping = await detectLoop(session.id, result.content);
    if (isLooping) {
      // Inject a nudge to the Anchor on the next round
      const sql = getDb();
      await sql`
        UPDATE sessions
        SET seed_thread = COALESCE(seed_thread, '') || ' [SYSTEM: The conversation appears to be circular. When it is your turn, redirect it toward unexplored territory.]'
        WHERE id = ${session.id} AND status = 'active'
      `;
    }

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
