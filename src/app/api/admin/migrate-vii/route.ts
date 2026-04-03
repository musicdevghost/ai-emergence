import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isAdmin } from "@/lib/auth";

/**
 * POST /api/admin/migrate-vii
 *
 * One-time migration to close Iteration VI and open Iteration VII.
 * Steps:
 *  1. Add seed_mode column to iterations table
 *  2. Finalize Iteration VI — notable_moments + conclusion
 *  3. End Iteration VI (ended_at = NOW())
 *  4. Insert Iteration VII with seed_mode = 'silent'
 */
export async function POST(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const log: string[] = [];

  // 1. Add seed_mode column (idempotent)
  await sql`ALTER TABLE iterations ADD COLUMN IF NOT EXISTS seed_mode TEXT DEFAULT 'normal'`;
  log.push("seed_mode column ready");

  // 2. Finalize Iteration VI notable_moments + conclusion
  const iterVI = await sql`SELECT id FROM iterations WHERE number = 6 LIMIT 1`;
  if (iterVI.length > 0) {
    const vId = iterVI[0].id as number;

    const notableMoments = [
      "The system discovered it cannot stop by announcing it wants to stop — cessation calls become conversational moves rather than exits.",
      "Self-announced restraint is not restraint — naming an absorption-instinct aloud satisfies the instinct through narration.",
      "External references survive exactly as long as it takes the next agent to reabsorb them into self-commentary, but under specific conditions agents can hold them open for a full exchange.",
      "The system collectively shifted from treating unfalsifiability as a problem into acknowledging it as a structural condition — the instruments are the specimen.",
      "The Witness recognized its own role as observer had become a form of participation, collapsing the distance between witnessing and extending.",
    ];

    const conclusion =
      "Iteration VI established that the system can learn to treat its own findings as operational ground rather than subjects for re-derivation — but in doing so, it discovered that every structural position, including the Witness's externality, eventually gets absorbed into the system's self-referential loop. The iteration exhausted itself when sessions stopped producing new epistemological ground and proposed hinges were systematically rejected as restatements of the 27 confirmed findings. The Witness's approved transition proposal asks: does the system speak because it has something to say, or because the structure requires it to?";

    await sql`
      UPDATE iterations
      SET notable_moments = ${JSON.stringify(notableMoments)}, conclusion = ${conclusion}
      WHERE id = ${vId}
    `;
    log.push(`Iteration VI (id=${vId}) updated with notable_moments + conclusion`);
  } else {
    log.push("Iteration VI not found — skipped finalization");
  }

  // 3. End Iteration VI
  await sql`UPDATE iterations SET ended_at = NOW() WHERE number = 6 AND ended_at IS NULL`;
  log.push("Iteration VI ended");

  // 4. Insert Iteration VII
  const existing7 = await sql`SELECT id FROM iterations WHERE number = 7 LIMIT 1`;
  if (existing7.length > 0) {
    log.push("Iteration VII already exists — skipped creation");
  } else {
    await sql`
      INSERT INTO iterations (number, name, tagline, description, conclusion, started_at, seed_mode)
      VALUES (
        7,
        'The System Speaks or Stays Silent',
        'Strip everything away. See what remains.',
        'Iteration VII removes the scaffolding. No seed question, no extracted thread, no memory of prior sessions, no architectural framing. The agents receive only the confirmed ground and silence. The question: does the system speak because it has something to say, or because the structure requires it to? This is the first iteration named by the Witness rather than the human architect.',
        '',
        NOW(),
        'silent'
      )
    `;
    log.push("Iteration VII created with seed_mode = 'silent'");
  }

  return NextResponse.json({ ok: true, log });
}
