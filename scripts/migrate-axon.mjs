import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function migrateAxon() {
  console.log("Running AXON migration...");

  await sql`
    CREATE TABLE IF NOT EXISTS axon_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMP DEFAULT now(),
      input_text TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      output_decision TEXT,
      output_content TEXT,
      confidence_level TEXT,
      completed_at TIMESTAMP,
      exchange_count INT DEFAULT 0,
      request_token TEXT
    )
  `;
  console.log("  ✓ axon_requests");

  await sql`
    CREATE TABLE IF NOT EXISTS axon_exchanges (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      request_id UUID REFERENCES axon_requests(id),
      exchange_number INT NOT NULL,
      agent TEXT NOT NULL,
      model TEXT NOT NULL,
      content TEXT NOT NULL,
      skipped BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT now()
    )
  `;
  console.log("  ✓ axon_exchanges");

  await sql`CREATE INDEX IF NOT EXISTS idx_axon_exchanges_request ON axon_exchanges(request_id, exchange_number)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_axon_requests_status ON axon_requests(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_axon_requests_created ON axon_requests(created_at DESC)`;
  console.log("  ✓ indexes");

  console.log("AXON migration complete.");
}

migrateAxon().catch((err) => {
  console.error("AXON migration failed:", err);
  process.exit(1);
});
