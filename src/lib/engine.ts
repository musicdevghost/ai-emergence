import Anthropic from "@anthropic-ai/sdk";
import { getDb } from "./db";
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

  const lastCompletedAt = new Date(lastCompleted[0].completed_at as string);
  const gapHours = 3 + Math.random(); // 3-4 hour gap
  const nextSessionAt = new Date(
    lastCompletedAt.getTime() + gapHours * 60 * 60 * 1000
  );

  if (new Date() >= nextSessionAt) {
    return createSession(lastCompleted[0].extracted_thread as string | null);
  }

  return null; // Still in gap
}

/** Create a new session, optionally seeded with a thread */
async function createSession(seedThread: string | null): Promise<SessionRow> {
  const sql = getDb();
  const sessions = await sql`
    INSERT INTO sessions (seed_thread, status)
    VALUES (${seedThread}, 'active')
    RETURNING *
  `;
  return sessions[0] as unknown as SessionRow;
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
    messages.push({
      role: "user",
      content: `The following thread was extracted from the previous session as the most compelling unresolved question or idea. Use it as your opening:\n\n"${session.seed_thread}"`,
    });
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

  // Call the API with retries
  const content = await callWithRetry(model, agent.systemPrompt, messages);

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

  return { role, content, exchangeNumber };
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

  await sql`
    UPDATE sessions
    SET status = 'complete', completed_at = NOW(), extracted_thread = ${extraction}
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
