import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function cleanup() {
  console.log("Cleaning up corrupted seed_thread data...");

  // Strip all [SYSTEM: ...] messages from seed_thread
  const result = await sql`
    UPDATE sessions
    SET seed_thread = REGEXP_REPLACE(
      seed_thread,
      '\\s*\\[SYSTEM:[^\\]]*\\]',
      '',
      'g'
    )
    WHERE seed_thread LIKE '%[SYSTEM:%'
    RETURNING id, seed_thread
  `;

  console.log(`  Updated ${result.length} session(s)`);
  for (const row of result) {
    console.log(`  - ${row.id}: "${(row.seed_thread || '').slice(0, 80)}..."`);
  }

  // Also clean extracted_thread just in case
  const result2 = await sql`
    UPDATE sessions
    SET extracted_thread = REGEXP_REPLACE(
      extracted_thread,
      '\\s*\\[SYSTEM:[^\\]]*\\]',
      '',
      'g'
    )
    WHERE extracted_thread LIKE '%[SYSTEM:%'
    RETURNING id
  `;

  if (result2.length > 0) {
    console.log(`  Also cleaned ${result2.length} extracted_thread(s)`);
  }

  console.log("Cleanup complete.");
}

cleanup().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
