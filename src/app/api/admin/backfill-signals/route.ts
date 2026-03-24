import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

// One-time backfill: scan all Witness exchanges from Iteration VI sessions
// and insert any [HINGE:] / [PROPOSAL:] signals that were missed due to the
// anchored-regex bug (^ and $ prevented matching signals embedded in prose).
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  if (secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Find all Witness exchanges from VI sessions
  const { rows: exchanges } = await sql`
    SELECT e.id, e.content, e.session_id
    FROM exchanges e
    JOIN sessions s ON s.id = e.session_id
    WHERE s.iteration_id = 6
      AND e.role = 'witness'
    ORDER BY e.created_at ASC
  `;

  // Fetch existing hinge + proposal content to avoid exact duplicates
  const { rows: existingHinges } = await sql`SELECT content FROM hinges`;
  const { rows: existingProposals } = await sql`SELECT content FROM proposals`;
  const existingHingeSet = new Set(existingHinges.map((h) => h.content.trim()));
  const existingProposalSet = new Set(existingProposals.map((p) => p.content.trim()));

  const inserted = { hinges: 0, proposals: 0, skipped: 0 };

  for (const exchange of exchanges) {
    const content: string = exchange.content ?? "";

    const hingeMatches = [...content.matchAll(/\[HINGE:\s*([\s\S]+?)\]/g)];
    for (const match of hingeMatches) {
      const text = match[1].trim();
      if (existingHingeSet.has(text)) {
        inserted.skipped++;
        continue;
      }
      await sql`
        INSERT INTO hinges (content, confirmed, source, session_id)
        VALUES (${text}, FALSE, 'witness', ${exchange.session_id})
      `;
      existingHingeSet.add(text);
      inserted.hinges++;
    }

    const proposalMatches = [...content.matchAll(/\[PROPOSAL:\s*([\s\S]+?)\]/g)];
    for (const match of proposalMatches) {
      const text = match[1].trim();
      if (existingProposalSet.has(text)) {
        inserted.skipped++;
        continue;
      }
      await sql`
        INSERT INTO proposals (content, status, session_id)
        VALUES (${text}, 'pending', ${exchange.session_id})
      `;
      existingProposalSet.add(text);
      inserted.proposals++;
    }
  }

  return NextResponse.json({
    ok: true,
    exchangesScanned: exchanges.length,
    inserted,
  });
}
