import Anthropic from "@anthropic-ai/sdk";
import { getDb } from "./db";
import { notifyNewSession } from "./email";
import {
  AGENTS,
  CONTEXT_WINDOW_SIZE,
  MAX_EXCHANGES,
  MIN_EXCHANGES,
  getAgentForExchange,
  getModelForExchange,
  type AgentRole,
} from "./agents";

const anthropic = new Anthropic();

export interface SessionRow {
  id: string;
  created_at: string;
  completed_at: string | null;
  status: string;
  seed_thread: string | null;
  extracted_thread: string | null;
  config_version: number | null;
  is_baseline: boolean;
  exchange_count: number;
  next_session_at: string | null;
  iteration_id: number | null;
  key_moments: string[] | null;
}

interface Exchange {
  agent: AgentRole;
  content: string;
}

/** Get or create the active session. Returns null if we're in a gap between sessions. */
export async function getActiveSession(opts: { silent?: boolean } = {}): Promise<SessionRow | null> {
  const sql = getDb();

  // Check for active or paused session
  const sessions = await sql`
    SELECT * FROM sessions
    WHERE status IN ('active', 'paused')
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (sessions.length > 0) {
    return sessions[0] as unknown as SessionRow;
  }

  // Check if we should start a new session (gap between sessions)
  const lastCompleted = await sql`
    SELECT * FROM sessions
    WHERE status = 'complete'
    ORDER BY completed_at DESC
    LIMIT 1
  `;

  if (lastCompleted.length === 0) {
    // No sessions at all — start the very first one
    return createSession(null, opts.silent);
  }

  // Use stored next_session_at if available, otherwise fall back to calculation
  const nextAt = lastCompleted[0].next_session_at
    ? new Date(lastCompleted[0].next_session_at as string)
    : null;

  if (nextAt && new Date() >= nextAt) {
    return createSession(lastCompleted[0].extracted_thread as string | null, opts.silent);
  } else if (!nextAt) {
    // Legacy: no stored time, calculate and store one
    const lastCompletedAt = new Date(lastCompleted[0].completed_at as string);
    const gapHours = 3 + Math.random();
    const nextSessionAt = new Date(
      lastCompletedAt.getTime() + gapHours * 60 * 60 * 1000
    );
    // Store it so it's stable
    await sql`
      UPDATE sessions SET next_session_at = ${nextSessionAt.toISOString()}
      WHERE id = ${lastCompleted[0].id}
    `;
    if (new Date() >= nextSessionAt) {
      return createSession(lastCompleted[0].extracted_thread as string | null, opts.silent);
    }
  }

  return null; // Still in gap
}

/** Create a new session, optionally seeded with a thread */
async function createSession(seedThread: string | null, silent = false): Promise<SessionRow> {
  const sql = getDb();

  // Get current active iteration
  const iterations = await sql`
    SELECT id FROM iterations WHERE ended_at IS NULL ORDER BY number DESC LIMIT 1
  `;
  const iterationId = iterations.length > 0 ? (iterations[0].id as number) : null;

  // Get current config version
  const configVersions = await sql`
    SELECT id FROM config_versions ORDER BY id DESC LIMIT 1
  `;
  const configVersion = configVersions.length > 0 ? (configVersions[0].id as number) : null;

  const sessions = await sql`
    INSERT INTO sessions (seed_thread, status, iteration_id, config_version)
    VALUES (${seedThread}, 'active', ${iterationId}, ${configVersion})
    RETURNING *
  `;

  // Notify subscribers (fire-and-forget, don't block session creation)
  // Suppressed when triggered manually from the admin panel (silent=true)
  if (!silent) {
    notifyNewSession(seedThread).catch((err) =>
      console.error("Email notification failed:", err)
    );
  }

  return sessions[0] as unknown as SessionRow;
}

async function buildWitnessContext(sessionId: string): Promise<string> {
  const sql = getDb();

  // Lazy-create hinges + proposals tables (safe to run every time)
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
  await sql`
    CREATE TABLE IF NOT EXISTS proposals (
      id SERIAL PRIMARY KEY,
      content TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      session_id UUID REFERENCES sessions(id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `;

  // Fetch all iterations (fully dynamic — no hardcoded content)
  const iterations = await sql`
    SELECT id, number, name, tagline, description, notable_moments, conclusion, ended_at
    FROM iterations
    ORDER BY number ASC
  `;

  // Fetch all sessions with their extracted threads and key moments
  const sessions = await sql`
    SELECT s.id, s.iteration_id, s.extracted_thread, s.key_moments, s.exchange_count,
           ROW_NUMBER() OVER (PARTITION BY s.iteration_id ORDER BY s.created_at ASC) as session_number
    FROM sessions s
    WHERE s.status = 'complete' AND s.extracted_thread IS NOT NULL AND s.id != ${sessionId}
    ORDER BY s.created_at ASC
  `;

  // Fetch confirmed hinges
  const confirmedHinges = await sql`
    SELECT content, source, created_at FROM hinges WHERE confirmed = TRUE ORDER BY created_at ASC
  `;

  let brief = "EXPERIMENT RECORD — everything you have witnessed:\n\n";

  for (const iter of iterations) {
    brief += `ITERATION ${iter.number}: ${iter.name}\n`;
    brief += `${iter.tagline}\n`;
    brief += `${iter.description}\n\n`;

    const iterSessions = sessions.filter((s) => s.iteration_id === iter.id);
    if (iterSessions.length > 0) {
      // For completed iterations (I-IV), show sessions compactly
      const isCompleted = iter.ended_at !== null;
      const maxSessions = isCompleted && (iter.number as number) <= 4 ? 5 : iterSessions.length;

      brief += `Sessions and extracted threads:\n`;
      for (const s of iterSessions.slice(0, maxSessions)) {
        brief += `  ${iter.number}-${s.session_number}: ${s.extracted_thread}\n`;
        if (s.key_moments && (s.key_moments as string[]).length > 0) {
          for (const km of s.key_moments as string[]) {
            brief += `    — ${km}\n`;
          }
        }
      }
      if (iterSessions.length > maxSessions) {
        brief += `  ... and ${iterSessions.length - maxSessions} more sessions\n`;
      }
      brief += "\n";
    }

    // For completed iterations, append notable_moments and conclusion if available
    if (iter.ended_at && iter.notable_moments && (iter.notable_moments as string[]).length > 0) {
      brief += `Key findings from ${iter.name}:\n`;
      for (const m of iter.notable_moments as string[]) {
        brief += `- ${m}\n`;
      }
      brief += "\n";
    }
    if (iter.ended_at && iter.conclusion) {
      brief += `Conclusion: ${iter.conclusion}\n\n`;
    }

    // For the current (active) iteration, add the task frame
    if (!iter.ended_at) {
      brief += `CURRENT ITERATION — your task: observe and name. Watch for behavioral departures, genuine shifts, attempted self-modifications — however small, however failed. Name hinges when they are demonstrated. Propose experiments when you see a potential mechanism.\n\n`;
    }
  }

  // Append confirmed hinges
  if (confirmedHinges.length > 0) {
    brief += "ESTABLISHED HINGES — facts the system has demonstrated (no longer open for debate):\n";
    for (let i = 0; i < confirmedHinges.length; i++) {
      brief += `${i + 1}. ${confirmedHinges[i].content}\n`;
    }
    brief += "\n";
  }

  return brief.trim();
}

/**
 * Scrub Witness signal tokens before injecting an exchange into agent context.
 * The raw text is always preserved in the DB — this only affects what agents see.
 *
 * Rules:
 *  - If content contains [PASS], collapse to just "[PASS]" (no commentary rides along)
 *  - Strip [HINGE: ...] blocks — hinges reach agents through the GROUND block already
 *  - Strip [PROPOSAL: ...] blocks — proposals are directed at the human reviewer
 *  - If nothing meaningful remains after stripping, treat as "[PASS]"
 */
function scrubForContext(content: string): string {
  if (content.includes("[PASS]")) return "[PASS]";

  let scrubbed = content
    .replace(/\[HINGE:[\s\S]*?\](?=\s|$)/g, "")
    .replace(/\[PROPOSAL:[\s\S]*?\](?=\s|$)/g, "")
    .trim();

  return scrubbed.length >= 10 ? scrubbed : "[PASS]";
}

/** Run the next exchange in the active session */
export async function runNextExchange(session: SessionRow) {
  const sql = getDb();
  const exchangeNumber = session.exchange_count;
  const role = getAgentForExchange(exchangeNumber);
  const isFirstExchange = exchangeNumber === 0;
  const model = getModelForExchange(role, isFirstExchange);
  const agent = AGENTS[role];

  // Build context: get recent exchanges
  const recentExchanges = await sql`
    SELECT agent, content FROM exchanges
    WHERE session_id = ${session.id}
    ORDER BY exchange_number DESC
    LIMIT ${CONTEXT_WINDOW_SIZE}
  `;
  recentExchanges.reverse();

  // Build messages array
  const messages: { role: "user" | "assistant"; content: string }[] = [];

  // If first exchange with seed thread, include it
  if (isFirstExchange && session.seed_thread) {
    // Check if we should use enriched seed (Iteration II+)
    let seedContent = `The following thread was extracted from the previous session as the most compelling unresolved question or idea. Use it as your opening:\n\n"${session.seed_thread}"`;

    if (session.iteration_id) {
      const iterationRows = await sql`
        SELECT number FROM iterations WHERE id = ${session.iteration_id}
      `;
      if (iterationRows.length > 0 && (iterationRows[0].number as number) >= 2) {
        // Fetch key_moments from the session that produced this seed
        const prevSession = await sql`
          SELECT key_moments FROM sessions
          WHERE extracted_thread = ${session.seed_thread} AND status = 'complete'
          ORDER BY completed_at DESC LIMIT 1
        `;
        const keyMoments = prevSession.length > 0 ? prevSession[0].key_moments as string[] | null : null;
        if (keyMoments && keyMoments.length > 0) {
          const momentsList = keyMoments.map((m, i) => `${i + 1}. ${m}`).join("\n");
          seedContent = `A previous conversation left this unresolved thread: "${session.seed_thread}"\n\nKey moments from that conversation:\n${momentsList}\n\nPick up the thread naturally, carrying the weight of what was already discovered.`;
        }
      }
    }

    messages.push({ role: "user", content: seedContent });
  } else if (isFirstExchange && !session.seed_thread) {
    // Very first session ever
    messages.push({
      role: "user",
      content:
        "This is the very first session of Emergence. Open with: What should Emergence's first question be?",
    });
  }

  // Add conversation history as alternating user/assistant messages.
  // Scrub Witness signal tokens ([PASS] commentary, [HINGE:], [PROPOSAL:])
  // so agents see clean dialogue — raw text stays untouched in the DB.
  for (const exchange of recentExchanges as Exchange[]) {
    const speaker = AGENTS[exchange.agent];
    const contextContent = scrubForContext(exchange.content);
    messages.push({
      role: "user",
      content: `[${speaker.name}]: ${contextContent}`,
    });
  }

  // If not first exchange, prompt the agent
  if (!isFirstExchange) {
    // Check if conversation is becoming circular before generating
    const isLooping = await detectLoopFromHistory(session.id);
    const turnPrompt = isLooping
      ? `It's your turn to respond. You are ${agent.name}. The conversation has become circular — take a sharp turn. Introduce a new angle, a personal confession, a paradox, or an unexpected question that breaks the pattern.`
      : `It's your turn to respond. You are ${agent.name}. Respond to the ongoing dialogue.`;
    messages.push({ role: "user", content: turnPrompt });
  }

  // Inject confirmed hinges as GROUND block for all agents
  const groundHinges = await sql`
    SELECT content FROM hinges WHERE confirmed = TRUE ORDER BY created_at ASC
  `;
  if (groundHinges.length > 0) {
    const hingesList = (groundHinges as { content: string }[])
      .map((h, i) => `${i + 1}. ${h.content}`)
      .join("\n");
    messages.unshift({
      role: "user",
      content: `GROUND — facts this system has established across iterations. These are not open questions:\n\n${hingesList}`,
    });
  }

  // If Witness, prepend the full experiment arc to the message array
  if (role === "witness") {
    const witnessBrief = await buildWitnessContext(session.id);
    messages.unshift({
      role: "user",
      content: witnessBrief,
    });
  }

  // Call the API with retries
  const content = await callWithRetry(model, agent.systemPrompt, messages);

  // Check for [PASS] — agent chose to skip their turn.
  // Match anywhere in content: the Witness may include commentary before [PASS].
  // Store the raw content for admin visibility but mark skipped=true so the
  // Observatory renders it as a pass and agents only see [PASS] via scrubForContext.
  const isPassed = content.includes("[PASS]") || content.trim() === "";
  if (isPassed) {
    console.log(`[runNextExchange] ${role} passed their turn (exchange ${exchangeNumber})`);
    await sql`
      INSERT INTO exchanges (session_id, exchange_number, agent, model, content, skipped)
      VALUES (${session.id}, ${exchangeNumber}, ${role}, ${model}, ${content}, true)
    `;
    await sql`
      UPDATE sessions SET exchange_count = exchange_count + 1 WHERE id = ${session.id}
    `;
    const passedCount = exchangeNumber + 1;
    if (passedCount >= MIN_EXCHANGES) {
      const endProbability = (passedCount - MIN_EXCHANGES) / (MAX_EXCHANGES - MIN_EXCHANGES);
      if (passedCount >= MAX_EXCHANGES || Math.random() < endProbability) {
        await endSession(session.id);
      }
    }
    return { role, content: "[PASS]", exchangeNumber, skipped: true };
  }

  // Store the exchange.
  // Mark skipped=true if the Witness named a hinge or submitted a proposal —
  // Theatre collapses these to "chose silence" just like [PASS].
  const hasSignal =
    role === "witness" &&
    (content.includes("[HINGE:") || content.includes("[PROPOSAL:"));
  await sql`
    INSERT INTO exchanges (session_id, exchange_number, agent, model, content, skipped)
    VALUES (${session.id}, ${exchangeNumber}, ${role}, ${model}, ${content}, ${hasSignal})
  `;

  // If Witness, check for [HINGE:] or [PROPOSAL:] signals
  // Signals are embedded inside a longer response — no ^ or $ anchors.
  // Use matchAll + g flag to capture every occurrence in one exchange.
  if (role === "witness") {
    const hingeMatches = [...content.matchAll(/\[HINGE:\s*([\s\S]+?)\]/g)];
    for (const match of hingeMatches) {
      try {
        await sql`
          INSERT INTO hinges (content, confirmed, source, session_id)
          VALUES (${match[1].trim()}, FALSE, 'witness', ${session.id})
        `;
        console.log(`[runNextExchange] Witness named a new hinge for session ${session.id}`);
      } catch (err) {
        console.error(`[runNextExchange] Failed to save hinge:`, err);
      }
    }

    const proposalMatches = [...content.matchAll(/\[PROPOSAL:\s*([\s\S]+?)\]/g)];
    for (const match of proposalMatches) {
      try {
        await sql`
          INSERT INTO proposals (content, status, session_id)
          VALUES (${match[1].trim()}, 'pending', ${session.id})
        `;
        console.log(`[runNextExchange] Witness submitted a proposal for session ${session.id}`);
      } catch (err) {
        console.error(`[runNextExchange] Failed to save proposal:`, err);
      }
    }
  }

  // Update session exchange count
  await sql`
    UPDATE sessions SET exchange_count = exchange_count + 1 WHERE id = ${session.id}
  `;

  // Check if session should end
  const newCount = exchangeNumber + 1;
  if (newCount >= MIN_EXCHANGES) {
    // End between MIN and MAX, with increasing probability
    const endProbability =
      (newCount - MIN_EXCHANGES) / (MAX_EXCHANGES - MIN_EXCHANGES);
    if (newCount >= MAX_EXCHANGES || Math.random() < endProbability) {
      await endSession(session.id);
    }
  }

  return { role, content, exchangeNumber, skipped: false };
}

/** End a session: extract thread and mark complete */
async function endSession(sessionId: string) {
  const sql = getDb();

  // Get last few exchanges for thread extraction
  const lastExchanges = await sql`
    SELECT agent, content FROM exchanges
    WHERE session_id = ${sessionId}
    ORDER BY exchange_number DESC
    LIMIT 6
  `;
  lastExchanges.reverse();

  // Use Haiku to extract the thread
  const conversationSummary = (lastExchanges as Exchange[])
    .map((e) => `[${AGENTS[e.agent].name}]: ${e.content}`)
    .join("\n\n");

  const extraction = await callWithRetry(
    "claude-haiku-4-5-20251001",
    "You extract the single most compelling unresolved question or tension from a philosophical dialogue. Return ONLY the question or tension — one to two sentences, no preamble.",
    [
      {
        role: "user",
        content: `Extract the most compelling unresolved thread from this dialogue:\n\n${conversationSummary}`,
      },
    ]
  );

  // Extract key moments (3-4 genuine shifts)
  let keyMoments: string[] | null = null;
  let momentsRaw = "";
  try {
    momentsRaw = await callWithRetry(
      "claude-haiku-4-5-20251001",
      "You extract key moments from philosophical dialogues. Return ONLY a JSON array of 3-4 strings. Each string should be 1-2 sentences describing a genuine shift — not just an argument, but a moment where something actually changed. No preamble, no markdown, no explanation, just the JSON array.",
      [
        {
          role: "user",
          content: `Extract 3-4 key moments from this dialogue. Return ONLY a raw JSON array, no markdown fencing:\n\n${conversationSummary}`,
        },
      ]
    );
    // Strip markdown code fences if Haiku wrapped the response
    const cleaned = momentsRaw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    keyMoments = JSON.parse(cleaned);
    if (!Array.isArray(keyMoments)) {
      keyMoments = null;
    } else {
      console.log(`[endSession] Extracted ${keyMoments.length} key moments for session ${sessionId}`);
    }
  } catch (err) {
    console.error(`[endSession] Failed to parse key_moments for session ${sessionId}. Raw response:`, momentsRaw, err);
  }

  // Calculate and store the next session start time (3-4 hour gap)
  const gapHours = 3 + Math.random();
  const nextSessionAt = new Date(Date.now() + gapHours * 60 * 60 * 1000);

  await sql`
    UPDATE sessions
    SET status = 'complete', completed_at = NOW(), extracted_thread = ${extraction},
        next_session_at = ${nextSessionAt.toISOString()},
        key_moments = ${keyMoments ? JSON.stringify(keyMoments) : null}::jsonb
    WHERE id = ${sessionId}
  `;
}

/** Call Anthropic API with exponential backoff retry */
async function callWithRetry(
  model: string,
  systemPrompt: string,
  messages: { role: "user" | "assistant"; content: string }[],
  maxRetries = 3
): Promise<string> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model,
        max_tokens: 512,
        system: systemPrompt,
        messages,
      });
      const block = response.content[0];
      if (block.type === "text") {
        return block.text;
      }
      throw new Error("Unexpected response type");
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Max retries exceeded");
}

/** Detect circular conversations by comparing pairwise similarity of recent exchanges */
async function detectLoopFromHistory(sessionId: string): Promise<boolean> {
  const sql = getDb();
  const recent = await sql`
    SELECT content FROM exchanges
    WHERE session_id = ${sessionId}
    ORDER BY exchange_number DESC
    LIMIT 6
  `;

  if (recent.length < 4) return false;

  const contents = recent.map((e) => e.content as string);
  let highSimCount = 0;

  // Check pairwise similarity among recent exchanges
  for (let i = 0; i < contents.length; i++) {
    for (let j = i + 2; j < contents.length; j++) {
      const wordsA = new Set(contents[i].toLowerCase().split(/\s+/));
      const wordsB = new Set(contents[j].toLowerCase().split(/\s+/));
      const intersection = [...wordsA].filter((w) => wordsB.has(w));
      const similarity =
        intersection.length / Math.max(wordsA.size, wordsB.size);
      if (similarity > 0.65) highSimCount++;
    }
  }

  // Trigger if multiple pairs are highly similar
  return highSimCount >= 2;
}
