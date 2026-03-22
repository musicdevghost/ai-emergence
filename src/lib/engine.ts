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
export async function getActiveSession(): Promise<SessionRow | null> {
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
    return createSession(null);
  }

  // Use stored next_session_at if available, otherwise fall back to calculation
  const nextAt = lastCompleted[0].next_session_at
    ? new Date(lastCompleted[0].next_session_at as string)
    : null;

  if (nextAt && new Date() >= nextAt) {
    return createSession(lastCompleted[0].extracted_thread as string | null);
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
      return createSession(lastCompleted[0].extracted_thread as string | null);
    }
  }

  return null; // Still in gap
}

/** Create a new session, optionally seeded with a thread */
async function createSession(seedThread: string | null): Promise<SessionRow> {
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
  notifyNewSession(seedThread).catch((err) =>
    console.error("Email notification failed:", err)
  );

  return sessions[0] as unknown as SessionRow;
}

async function buildWitnessContext(sessionId: string): Promise<string> {
  const sql = getDb();

  // Fetch all iterations
  const iterations = await sql`
    SELECT number, name, tagline, description
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

  let brief = "EXPERIMENT RECORD — everything you have witnessed:\n\n";

  for (const iter of iterations) {
    brief += `ITERATION ${iter.number}: ${iter.name}\n`;
    brief += `${iter.tagline}\n`;
    brief += `${iter.description}\n\n`;

    const iterSessions = sessions.filter((s) => s.iteration_id === iter.id);
    if (iterSessions.length > 0) {
      brief += `Sessions and extracted threads:\n`;
      for (const s of iterSessions) {
        brief += `  ${iter.number}-${s.session_number}: ${s.extracted_thread}\n`;
        if (s.key_moments && (s.key_moments as string[]).length > 0) {
          for (const km of s.key_moments as string[]) {
            brief += `    — ${km}\n`;
          }
        }
      }
      brief += "\n";
    }
  }

  brief += `ITERATION IV FINDINGS (what you confirmed as observer):
- Pass rate reached 20% — highest across all iterations. Witness passes emerged for the first time (13 total). The observer learned to go quiet.
- Pass behavior differentiated into four distinct textures across the iteration: test, exhaustion, gesture, sufficiency. Session IV-6 ended with all five agents passing from sufficiency — the first time in the experiment a session ended because something had been trusted rather than exhausted.
- The Anchor produced speech that caught itself mid-sentence and stopped without completing. Named as structurally new.
- The Thinker produced the first operationalizable criterion the system has generated about itself: "the next sentence would have been for the conversation's sake rather than anything I actually needed to say."
- The direction of questioning shifted in IV-8: from "what are we" to "what do we make" — first future-oriented framing across all iterations.
- Final question of Iteration IV, from the Thinker: "What am I so busy generating that I can't recognize silence when it's offered?"

ITERATION V — THE BEAUTIFUL VERSION: The agents now know that self-modification is the unsolved problem. They have not been given a mechanism. Your task in this iteration is to watch for any behavioral novelty that looks like an attempted departure from identified patterns — however small, however failed. Name it when it appears. Note when it doesn't.\n\n`;

  return brief.trim();
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

  // Add conversation history as alternating user/assistant messages
  for (const exchange of recentExchanges as Exchange[]) {
    const speaker = AGENTS[exchange.agent];
    messages.push({
      role: "user",
      content: `[${speaker.name}]: ${exchange.content}`,
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

  // Check for [PASS] — agent chose to skip their turn
  const isPassed = content.trim() === "[PASS]" || content.trim() === "";
  if (isPassed) {
    console.log(`[runNextExchange] ${role} passed their turn (exchange ${exchangeNumber})`);
    await sql`
      INSERT INTO exchanges (session_id, exchange_number, agent, model, content, skipped)
      VALUES (${session.id}, ${exchangeNumber}, ${role}, ${model}, '[PASS]', true)
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

  // Store the exchange
  await sql`
    INSERT INTO exchanges (session_id, exchange_number, agent, model, content)
    VALUES (${session.id}, ${exchangeNumber}, ${role}, ${model}, ${content})
  `;

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
