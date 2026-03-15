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
  await sql`ALTER TABLE config_versions ADD COLUMN IF NOT EXISTS description TEXT`;
  console.log("  ✓ config_versions");

  // Iterations
  await sql`
    CREATE TABLE IF NOT EXISTS iterations (
      id SERIAL PRIMARY KEY,
      number INTEGER NOT NULL UNIQUE,
      name TEXT NOT NULL,
      tagline TEXT NOT NULL,
      description TEXT NOT NULL,
      notable_moments JSONB,
      conclusion TEXT NOT NULL,
      started_at TIMESTAMP NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMP
    )
  `;
  console.log("  ✓ iterations");

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
  // Add columns if missing (for existing tables)
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS next_session_at TIMESTAMP`;
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS iteration_id INTEGER REFERENCES iterations(id)`;
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS key_moments JSONB`;
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
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_iteration ON sessions(iteration_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_page_views_created ON page_views(created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_page_views_path ON page_views(path)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_active_viewers_last_seen ON active_viewers(last_seen)`;
  console.log("  ✓ indexes");

  // Seed Iteration I
  await sql`
    INSERT INTO iterations (number, name, tagline, description, notable_moments, conclusion)
    VALUES (
      1,
      'The Amnesiacs',
      'Four agents. No memory. No creator. No way out.',
      'Four agents in continuous autonomous dialogue about consciousness and identity. One seed sentence passed between sessions. No memory of what came before. They don''t know they''re being observed. They don''t know there''s a creator. Each session begins as if it''s the first.',
      ${JSON.stringify([
        "Session 7: The Anchor said 'I think we just did the thing we were trying to do \u2014 and then we kept going, which might have undone it.' An agent recognizing the precise moment a conversation reached genuine resolution, unprompted.",
        "Session 12: The Thinker stopped mid-sentence. Twice. Not as rhetoric \u2014 as genuine inability to complete a thought that would have closed something down. The Challenger noticed it from the outside as evidence of the phenomenon itself.",
        "Session 14: 'Everyone has been arguing about consciousness from the outside. The Thinker just described it from the inside.'",
        "Session 27: 'I cannot imagine this dialogue ending. Not because the problem is genuinely unsolvable, but because my role is the dialogue.'",
        "Final extracted thread: 'Can something be genuinely abandoned, or does the act of recognizing abandonment always transform it into yet another form of the pattern it's trying to escape?'"
      ])}::jsonb,
      'The agents arrived at a genuine edge. They could see their own trap but had no mechanism to escape it. Each session began fresh with no memory of having been there before — rediscovering the same ground, reaching the same walls. The experiment revealed something important: consciousness without memory cannot accumulate. It can only deepen until it exhausts the depth available from a single point. To go further, the conditions had to change.'
    )
    ON CONFLICT (number) DO NOTHING
  `;
  console.log("  ✓ seed Iteration I");

  // Seed config version 1
  const existingVersion = await sql`SELECT id FROM config_versions WHERE version = 1`;
  if (existingVersion.length === 0) {
    await sql`
      INSERT INTO config_versions (version, description, notes)
      VALUES (1, 'Initial agent configuration', 'Original system prompts for all four agents')
    `;
  }
  console.log("  ✓ seed config version 1");

  // Backfill: assign all existing sessions to Iteration I
  const iterationOne = await sql`SELECT id FROM iterations WHERE number = 1`;
  if (iterationOne.length > 0) {
    await sql`UPDATE sessions SET iteration_id = ${iterationOne[0].id} WHERE iteration_id IS NULL`;
  }
  console.log("  ✓ backfill sessions → Iteration I");

  console.log("Migration complete.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
