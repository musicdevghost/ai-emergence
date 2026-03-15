import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isAdmin } from "@/lib/auth";

/** GET — list all iterations */
export async function GET(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const iterations = await sql`
    SELECT * FROM iterations ORDER BY number ASC
  `;

  return NextResponse.json({ iterations });
}

/** POST — create a new iteration (auto-ends the current active one) */
export async function POST(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name, tagline, description, conclusion } = await request.json();

  if (!name || !tagline || !description) {
    return NextResponse.json(
      { error: "name, tagline, and description are required" },
      { status: 400 }
    );
  }

  const sql = getDb();

  // End the current active iteration
  await sql`
    UPDATE iterations SET ended_at = NOW() WHERE ended_at IS NULL
  `;

  // Get next iteration number
  const maxRows = await sql`SELECT COALESCE(MAX(number), 0) AS max_num FROM iterations`;
  const nextNumber = (maxRows[0].max_num as number) + 1;

  // Create new iteration
  const rows = await sql`
    INSERT INTO iterations (number, name, tagline, description, conclusion, started_at)
    VALUES (${nextNumber}, ${name}, ${tagline}, ${description}, ${conclusion || ""}, NOW())
    RETURNING *
  `;

  return NextResponse.json({ ok: true, iteration: rows[0] });
}

/** PATCH — update an iteration */
export async function PATCH(request: NextRequest) {
  if (!isAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, ...updates } = await request.json();

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const sql = getDb();
  const allowed = ["name", "tagline", "description", "notable_moments", "conclusion", "ended_at"];
  const fields = Object.keys(updates).filter((k) => allowed.includes(k));

  if (fields.length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  // Build dynamic update — use individual queries for each field to work with tagged templates
  for (const field of fields) {
    const value = updates[field];
    if (field === "name") await sql`UPDATE iterations SET name = ${value} WHERE id = ${id}`;
    else if (field === "tagline") await sql`UPDATE iterations SET tagline = ${value} WHERE id = ${id}`;
    else if (field === "description") await sql`UPDATE iterations SET description = ${value} WHERE id = ${id}`;
    else if (field === "conclusion") await sql`UPDATE iterations SET conclusion = ${value} WHERE id = ${id}`;
    else if (field === "notable_moments") await sql`UPDATE iterations SET notable_moments = ${JSON.stringify(value)} WHERE id = ${id}`;
    else if (field === "ended_at") await sql`UPDATE iterations SET ended_at = ${value} WHERE id = ${id}`;
  }

  const rows = await sql`SELECT * FROM iterations WHERE id = ${id}`;
  return NextResponse.json({ ok: true, iteration: rows[0] });
}
