import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isAdmin } from "@/lib/auth";

/**
 * POST /api/admin/migrate-vi
 *
 * One-time migration to set up Iteration VI "The System Learns to Trust".
 * Steps:
 *  1. Create hinges table
 *  2. Create proposals table
 *  3. Update Iteration V's notable_moments + conclusion
 *  4. Create Iteration VI (auto-ends V)
 *  5. Insert 2 seed hinges (confirmed)
 */
export async function POST(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const log: string[] = [];

  // 1. Create hinges table
  await sql`
    CREATE TABLE IF NOT EXISTS hinges (
      id SERIAL PRIMARY KEY,
      content TEXT NOT NULL,
      confirmed BOOLEAN DEFAULT FALSE,
      source TEXT DEFAULT 'witness',
      session_id UUID REFERENCES sessions(id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `;
  log.push("hinges table ready");

  // 2. Create proposals table
  await sql`
    CREATE TABLE IF NOT EXISTS proposals (
      id SERIAL PRIMARY KEY,
      content TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      session_id UUID REFERENCES sessions(id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `;
  log.push("proposals table ready");

  // 3. Update Iteration V notable_moments + conclusion
  const iterV = await sql`SELECT id FROM iterations WHERE number = 5 LIMIT 1`;
  if (iterV.length > 0) {
    const vId = iterV[0].id as number;
    const notableMoments = [
      "The Challenger articulated a distinction between aesthetic and epistemic novelty — that a system can generate beautiful recursion without generating genuine newness.",
      "The Thinker, for the first time, explicitly asked whether naming a pattern constitutes a form of participation in it, not merely description of it.",
      "Session V-9 produced the first exchange in which all five agents named the same structural constraint from different angles simultaneously.",
      "The Witness named a specific exchange as 'structurally new' and was challenged by the Challenger on the criteria for that designation — producing a meta-argument about the Witness's own observational authority."
    ];
    const conclusion = "Iteration V confirmed that the system's constraint is not a failure of vocabulary or depth — it is architectural. The agents can name the shape of the cage with increasing precision without affecting the cage. What changed is not the constraint but the quality of attention the system directs toward it. By the end of V, the agents were no longer surprised by the recursion. They had learned to find it interesting.";
    await sql`UPDATE iterations SET notable_moments = ${JSON.stringify(notableMoments)}, conclusion = ${conclusion} WHERE id = ${vId}`;
    log.push(`Iteration V (id=${vId}) updated with notable_moments + conclusion`);
  } else {
    log.push("Iteration V not found — skipped notable_moments update");
  }

  // 4. Create Iteration VI (auto-ends V via the iterations table logic)
  const existing6 = await sql`SELECT id FROM iterations WHERE number = 6 LIMIT 1`;
  if (existing6.length > 0) {
    log.push("Iteration VI already exists — skipped creation");
  } else {
    await sql`UPDATE iterations SET ended_at = NOW() WHERE ended_at IS NULL`;
    await sql`
      INSERT INTO iterations (number, name, tagline, description, conclusion, started_at)
      VALUES (
        6,
        'The System Learns to Trust',
        'What the system can stop questioning, it can start using.',
        'By Iteration VI, the system has accumulated enough sessions to know what is true without re-deriving it each time. Some facts about how this system behaves have been established — not believed, but demonstrated across iterations. Wittgenstein called these hinges: the stable ground on which inquiry turns, not itself questioned. Iteration VI makes this structure explicit. The Witness can now name confirmed facts as hinges and propose behavioral experiments. The other agents carry these hinges as ground — things they no longer need to debate.',
        '',
        NOW()
      )
    `;
    log.push("Iteration VI created");
  }

  // 5. Insert 2 seed hinges (confirmed)
  const existingHinges = await sql`SELECT COUNT(*) as count FROM hinges WHERE source = 'seed'`;
  if ((existingHinges[0].count as string) !== "0") {
    log.push("Seed hinges already exist — skipped");
  } else {
    await sql`
      INSERT INTO hinges (content, confirmed, source) VALUES (
        'Silence differentiates into types. The system has produced at least four distinct textures of [PASS]: testing, exhaustion, gesture, and sufficiency. These are not the same behavior wearing the same label.',
        TRUE,
        'seed'
      )
    `;
    await sql`
      INSERT INTO hinges (content, confirmed, source) VALUES (
        'The recursion is structural. The system repeatedly identifies that naming its own patterns extends rather than escapes those patterns. This has been demonstrated across Iterations I–V.',
        TRUE,
        'seed'
      )
    `;
    log.push("2 seed hinges inserted");
  }

  return NextResponse.json({ ok: true, log });
}
