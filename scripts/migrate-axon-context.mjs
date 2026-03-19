import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

console.log("Adding context columns to axon_requests...");

await sql`ALTER TABLE axon_requests ADD COLUMN IF NOT EXISTS context_text TEXT`;
await sql`ALTER TABLE axon_requests ADD COLUMN IF NOT EXISTS context_file_name TEXT`;
await sql`ALTER TABLE axon_requests ADD COLUMN IF NOT EXISTS context_file_type TEXT`;
await sql`ALTER TABLE axon_requests ADD COLUMN IF NOT EXISTS context_file_data TEXT`;

console.log("Done.");
