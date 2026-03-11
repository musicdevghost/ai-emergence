import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function migrate() {
  console.log("Running migrations...");

  // Config versions
  await sql`
    CREATE TABLE IF NOT EXISTS config_versions (
      id SERIAL PRIMARY KEY,
      version INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      thinker_prompt TEXT,
      challenger_prompt TEXT,
      observer_prompt TEXT,
      anchor_prompt TEXT,
      notes TEXT
    )
  `;
  console.log("  ✓ config_versions");

  // Sessions
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMP DEFAULT NOW(),
      completed_at TIMESTAMP,
      status VARCHAR(20) DEFAULT 'active',
      seed_thread TEXT,
      extracted_thread TEXT,
      config_version INTEGER REFERENCES config_versions(id),
      is_baseline BOOLEAN DEFAULT FALSE,
      exchange_count INTEGER DEFAULT 0,
      next_session_at TIMESTAMP
    )
  `;
  // Add next_session_at if missing (for existing tables)
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS next_session_at TIMESTAMP`;
  console.log("  ✓ sessions");

  // Exchanges
  await sql`
    CREATE TABLE IF NOT EXISTS exchanges (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id UUID REFERENCES sessions(id),
      exchange_number INTEGER NOT NULL,
      agent VARCHAR(20) NOT NULL,
      model VARCHAR(50) NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      flagged_count INTEGER DEFAULT 0
    )
  `;
  console.log("  ✓ exchanges");

  // Subscribers
  await sql`
    CREATE TABLE IF NOT EXISTS subscribers (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      active BOOLEAN DEFAULT TRUE
    )
  `;
  console.log("  ✓ subscribers");

  // Annotations
  await sql`
    CREATE TABLE IF NOT EXISTS annotations (
      id SERIAL PRIMARY KEY,
      exchange_id UUID REFERENCES exchanges(id),
      session_id UUID REFERENCES sessions(id),
      note TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  console.log("  ✓ annotations");

  // Page views
  await sql`
    CREATE TABLE IF NOT EXISTS page_views (
      id SERIAL PRIMARY KEY,
      path VARCHAR(255) NOT NULL,
      viewer_id VARCHAR(64),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  console.log("  ✓ page_views");

  // Active viewers (heartbeat-based)
  await sql`
    CREATE TABLE IF NOT EXISTS active_viewers (
      viewer_id VARCHAR(64) PRIMARY KEY,
      path VARCHAR(255) NOT NULL,
      last_seen TIMESTAMP DEFAULT NOW()
    )
  `;
  console.log("  ✓ active_viewers");

  // Indexes for performance
  await sql`CREATE INDEX IF NOT EXISTS idx_exchanges_session ON exchanges(session_id, exchange_number)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_page_views_created ON page_views(created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_page_views_path ON page_views(path)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_active_viewers_last_seen ON active_viewers(last_seen)`;
  console.log("  ✓ indexes");

  console.log("Migration complete.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
