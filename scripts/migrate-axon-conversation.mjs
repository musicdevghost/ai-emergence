import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

console.log("Adding conversation columns...");

await sql`ALTER TABLE axon_requests ADD COLUMN IF NOT EXISTS conversation_turns JSONB DEFAULT '[]'`;
await sql`ALTER TABLE axon_requests ADD COLUMN IF NOT EXISTS current_turn INT DEFAULT 0`;
await sql`ALTER TABLE axon_requests ADD COLUMN IF NOT EXISTS current_input TEXT`;
await sql`ALTER TABLE axon_exchanges ADD COLUMN IF NOT EXISTS turn_number INT DEFAULT 0`;

console.log("Done.");
