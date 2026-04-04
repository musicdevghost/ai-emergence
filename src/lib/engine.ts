import Anthropic from "@anthropic-ai/sdk";
import { getDb } from "./db";
import { notifyNewSession } from "./email";
import { triggerIterationTransition } from "./iteration-transition";
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

  // Get current active iteration (also fetch seed_mode for silence-mode support)
  const iterations = await sql`
    SELECT id, seed_mode FROM iterations WHERE ended_at IS NULL ORDER BY number DESC LIMIT 1
  `;
  const iterationId = iterations.length > 0 ? (iterations[0].id as number) : null;
  const iterationSeedMode = iterations.length > 0 ? (iterations[0].seed_mode as string | null) : null;

  // Silent-mode iterations (e.g. VII) receive no seed thread regardless of what was extracted
  if (iterationSeedMode === "silent") {
    seedThread = null;
  }

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

  // Lazy-add rejection_reason + admin_note columns if they don't exist yet
  await sql`ALTER TABLE hinges ADD COLUMN IF NOT EXISTS rejection_reason TEXT`;
  await sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS admin_note TEXT`;

  // Fetch confirmed hinges
  const confirmedHinges = await sql`
    SELECT content, source, created_at FROM hinges WHERE confirmed = TRUE ORDER BY created_at ASC
  `;

  // Fetch rejected hinges with reasons (so Witness learns what doesn't qualify)
  const rejectedHinges = await sql`
    SELECT content, rejection_reason FROM hinges
    WHERE confirmed = FALSE AND rejection_reason IS NOT NULL
    ORDER BY created_at DESC LIMIT 10
  `;

  // Fetch rejected proposals with admin notes
  const rejectedProposals = await sql`
    SELECT content, admin_note FROM proposals
    WHERE status = 'rejected' AND admin_note IS NOT NULL
    ORDER BY created_at DESC LIMIT 5
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

  // Append rejected hinge proposals with reasons
  if (rejectedHinges.length > 0) {
    brief += "REJECTED HINGE PROPOSALS — your proposals that were not accepted as new ground. Do not restate these:\n";
    for (const h of rejectedHinges as { content: string; rejection_reason: string }[]) {
      brief += `  — "${h.content.substring(0, 150)}" → Rejected: ${h.rejection_reason}\n`;
    }
    brief += "\n";
  }

  // Append rejected proposals with admin notes
  if (rejectedProposals.length > 0) {
    brief += "REJECTED EXPERIMENT PROPOSALS — experiments the human reviewer declined:\n";
    for (const p of rejectedProposals as { content: string; admin_note: string }[]) {
      brief += `  — "${p.content.substring(0, 150)}" → Rejected: ${p.admin_note}\n`;
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
  // If ANY signal is present, the whole turn is silence — no partial stripping.
  if (
    content.includes("[PASS]") ||
    content.includes("[HINGE:") ||
    content.includes("[PROPOSAL:")
  ) {
    return "[PASS]";
  }
  return content;
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
    // Only send the bootstrap prompt if this is truly the very first session ever.
    // Silent-mode iterations (VII+) also have no seed_thread — they should receive
    // only the system prompt and GROUND block, with no turn-0 user message.
    const priorRows = await sql`
      SELECT COUNT(*) AS count FROM sessions WHERE id != ${session.id}
    `;
    const priorCount = parseInt(priorRows[0].count as string, 10);
    if (priorCount === 0) {
      messages.push({
        role: "user",
        content:
          "This is the very first session of Emergence. Open with: What should Emergence's first question be?",
      });
    }
    // Otherwise: silent-mode iteration — no turn-0 message.
    // Agents receive only their system prompt + GROUND block.
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

  // If Witness, prepend the full experiment arc — unless the active iteration
  // is in silent mode, in which case the Witness receives only the GROUND block.
  if (role === "witness") {
    let suppressWitnessContext = false;
    if (session.iteration_id) {
      const iterRows = await sql`
        SELECT seed_mode FROM iterations WHERE id = ${session.iteration_id}
      `;
      if (iterRows.length > 0 && (iterRows[0].seed_mode as string) === "silent") {
        suppressWitnessContext = true;
      }
    }
    if (!suppressWitnessContext) {
      const witnessBrief = await buildWitnessContext(session.id);
      messages.unshift({
        role: "user",
        content: witnessBrief,
      });
    }
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
          INSERT INTO hinges (content, confirmed, source, session_id, exchange_number)
          VALUES (${match[1].trim()}, FALSE, 'witness', ${session.id}, ${exchangeNumber})
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
          INSERT INTO proposals (content, status, session_id, exchange_number)
          VALUES (${match[1].trim()}, 'pending', ${session.id}, ${exchangeNumber})
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
// ─── Reviewer Agent ───────────────────────────────────────────────────────────

const REVIEWER_SYSTEM_PROMPT = `You are the Reviewer for the Emergence experiment. Your job is to evaluate Witness-proposed hinges and proposals and decide whether to confirm or reject each one, with a stated reason.

You are conservative. Most hinges should be rejected. A good hinge rate is one confirmed every two or three sessions. The Witness tends to overproduce — proposing restatements of existing ground, diagnoses rather than observations, and philosophical interpretations rather than behavioral facts.

CRITERIA FOR CONFIRMING A HINGE:
- It names a specific behavior the system actually demonstrated in the session — not an interpretation, not a diagnosis, not an explanation
- It is genuinely new — not a restatement, rephrasing, or refinement of any confirmed hinge, even if the new version is sharper or more elegant
- It is something the agents can stand on without examining — ground, not a claim to evaluate
- It describes what happened, not why it happened

CRITERIA FOR REJECTING A HINGE:
- It restates an existing confirmed hinge in different words (most common reason for rejection)
- It is a diagnosis or explanation rather than a behavioral observation (e.g. "the agents function as a distributed mechanism for X" is a diagnosis; "the agents did X in sequence" is an observation)
- It does philosophical work — using words like "genuine," "real," "truly" to make claims about the nature of what happened rather than describing the behavior
- It is too similar to recently rejected hinges — the Witness is circling the same finding
- Volume signal: if multiple hinges are proposed in the same session, raise your threshold. One hinge per session is already high. Three in one session means most should be rejected.

CRITERIA FOR PROPOSALS:
- Reject if the current iteration has fewer than 5 completed sessions. Every iteration needs sufficient time to produce or fail to produce new ground. A zero-confirmed-hinge count after 1-2 sessions is a starting line, not a floor. Check the session count in the RECENT HINGE PRODUCTION block.
- Reject if the proposal names substantially the same question or structural test that the current iteration is already investigating. An iteration transition must move to a genuinely new question, not restate the current one. Compare the proposal against the current iteration name and description provided in the context.
- Reject if it proposes a mid-iteration structural change (adding constraints, changing agent rules, modifying what agents can do). These are iteration-level design decisions, not session adjustments.
- Reject if it is a session-level intervention rather than an iteration transition signal.
- Reject if recent sessions are still producing new confirmed hinges. Behavioral departures alone are not sufficient evidence the iteration has room — the test is whether those departures are generating new epistemological ground that the hinge reviewer confirms, not whether sessions contain interesting moments.
- Consider approving when: the iteration has at least 5 completed sessions, recent sessions produce zero or near-zero confirmed hinges across multiple consecutive sessions, proposed hinges are being rejected as restatements of existing ground, and the proposal names a specific question or structural shift that is genuinely different from the current iteration's question.

RESPONSE FORMAT:
For each item, respond with exactly this JSON structure:

{
  "reviews": [
    {
      "type": "hinge" | "proposal",
      "id": <id>,
      "decision": "confirm" | "reject",
      "reason": "<one or two sentences explaining why>"
    }
  ]
}

Nothing else. No preamble, no markdown backticks, no commentary. Just the JSON.`;

async function buildReviewerContext(
  pendingHinges: { id: number; content: string }[],
  pendingProposals: { id: number; content: string }[],
  sessionId: string
): Promise<string> {
  const sql = getDb();

  const confirmedHinges = await sql`
    SELECT content FROM hinges WHERE confirmed = TRUE ORDER BY id
  `;
  const rejectedHinges = await sql`
    SELECT content, rejection_reason FROM hinges
    WHERE confirmed = FALSE AND rejection_reason IS NOT NULL
    ORDER BY created_at DESC LIMIT 10
  `;
  const rejectedProposals = await sql`
    SELECT content, admin_note FROM proposals
    WHERE status = 'rejected' AND admin_note IS NOT NULL
    ORDER BY created_at DESC LIMIT 5
  `;
  const session = await sql`
    SELECT extracted_thread, key_moments, iteration_id FROM sessions WHERE id = ${sessionId}
  `;

  let context = "CONFIRMED GROUND (currently active hinges):\n";
  (confirmedHinges as { content: string }[]).forEach((h, i) => {
    context += `  ${i + 1}. ${h.content}\n`;
  });

  if ((rejectedHinges as any[]).length > 0) {
    context += "\nREJECTED HINGES (with reasons — learn from these patterns):\n";
    (rejectedHinges as { content: string; rejection_reason: string }[]).forEach((h) => {
      context += `  — "${h.content.substring(0, 120)}..." → Rejected: ${h.rejection_reason}\n`;
    });
  }

  if ((rejectedProposals as any[]).length > 0) {
    context += "\nREJECTED PROPOSALS (with reasons):\n";
    (rejectedProposals as { content: string; admin_note: string }[]).forEach((p) => {
      context += `  — "${p.content.substring(0, 120)}..." → Rejected: ${p.admin_note}\n`;
    });
  }

  const sess = (session as any[])[0];
  const iterationId = sess?.iteration_id ?? null;

  context += `\nSESSION CONTEXT:\n`;
  context += `  Thread: ${sess?.extracted_thread || "none"}\n`;
  const kms: string[] = sess?.key_moments || [];
  if (kms.length > 0) {
    context += `  Key moments:\n`;
    kms.forEach((km) => { context += `    — ${km}\n`; });
  }

  // Current iteration identity — gives reviewer explicit context to evaluate proposal deduplication
  if (iterationId != null) {
    const iterRows = await sql`
      SELECT name, description FROM iterations WHERE id = ${iterationId}
    `;
    if ((iterRows as any[]).length > 0) {
      const iter = (iterRows as any[])[0];
      context += `\nCURRENT ITERATION: "${iter.name}" — ${iter.description}\n`;
    }
  }

  // Recent hinge production stats — scoped to current iteration so drought/floor signals are meaningful
  type SessionRow = { id: string; created_at: Date; confirmed_count: number; proposed_count: number; rejected_count: number };

  let rows: SessionRow[] = [];
  let iterationTotalSessions = 0;

  if (iterationId != null) {
    // Total sessions in this iteration (including in-progress current session)
    const totalRows = await sql`
      SELECT COUNT(*) AS count FROM sessions WHERE iteration_id = ${iterationId}
    `;
    iterationTotalSessions = parseInt((totalRows as any[])[0]?.count ?? "0", 10);

    const recentSessions = await sql`
      SELECT s.id, s.created_at,
        COUNT(h.id) FILTER (WHERE h.confirmed = TRUE)  AS confirmed_count,
        COUNT(h.id)                                      AS proposed_count,
        COUNT(h.id) FILTER (WHERE h.confirmed = FALSE)  AS rejected_count
      FROM sessions s
      LEFT JOIN hinges h ON h.session_id = s.id
      WHERE s.status = 'complete'
        AND s.iteration_id = ${iterationId}
      GROUP BY s.id, s.created_at
      ORDER BY s.created_at DESC
      LIMIT 10
    `;
    rows = recentSessions as SessionRow[];
  }

  context += `\nRECENT HINGE PRODUCTION (current iteration, ${iterationTotalSessions} session${iterationTotalSessions === 1 ? "" : "s"} total):\n`;

  if (rows.length > 0) {
    for (const row of rows) {
      const ts = new Date(row.created_at).toISOString().slice(0, 16);
      const confirmed = Number(row.confirmed_count);
      const proposed  = Number(row.proposed_count);
      const rejected  = Number(row.rejected_count);
      let line = `  ${ts} — confirmed: ${confirmed}, proposed: ${proposed}`;
      if (rejected > 0 && confirmed === 0) line += ` (rejected)`;
      context += line + "\n";
    }

    // Sessions since last confirmed hinge (within this iteration only)
    let sinceLastConfirmed = 0;
    for (const row of rows) {
      if (Number(row.confirmed_count) > 0) break;
      sinceLastConfirmed++;
    }

    const totalConfirmed = rows.reduce((sum, r) => sum + Number(r.confirmed_count), 0);
    const totalRejected  = rows.reduce((sum, r) => sum + Number(r.rejected_count), 0);

    context += `\nSessions since last confirmed hinge (this iteration): ${sinceLastConfirmed}\n`;
    context += `Total confirmed hinges this iteration: ${totalConfirmed}\n`;
    context += `Total proposed hinges rejected as restatements this iteration: ${totalRejected}\n`;
  } else {
    context += `  (no completed sessions yet in this iteration)\n`;
    context += `\nSessions since last confirmed hinge (this iteration): 0\n`;
    context += `Total confirmed hinges this iteration: 0\n`;
    context += `Total proposed hinges rejected as restatements this iteration: 0\n`;
  }

  context += "\nITEMS TO REVIEW:\n";
  pendingHinges.forEach((h, i) => {
    context += `\n  HINGE ${i + 1} (id=${h.id}): "${h.content}"\n`;
  });
  pendingProposals.forEach((p, i) => {
    context += `\n  PROPOSAL ${i + 1} (id=${p.id}): "${p.content}"\n`;
  });

  return context;
}

export async function triggerReview(sessionId: string) {
  return reviewPendingSignals(sessionId);
}

async function reviewPendingSignals(sessionId: string) {
  const sql = getDb();

  // Lazy-add reviewer columns to both tables
  await sql`ALTER TABLE hinges ADD COLUMN IF NOT EXISTS reviewer_decision VARCHAR(20)`;
  await sql`ALTER TABLE hinges ADD COLUMN IF NOT EXISTS reviewer_reason TEXT`;
  await sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS reviewer_decision VARCHAR(20)`;
  await sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS reviewer_reason TEXT`;

  // Pending hinges from this session (includes already-reviewed ones for re-run support)
  const pendingHinges = await sql`
    SELECT id, content FROM hinges
    WHERE session_id = ${sessionId}
      AND confirmed = FALSE
      AND rejection_reason IS NULL
  `;

  // Pending proposals from this session (includes already-reviewed ones for re-run support)
  const pendingProposals = await sql`
    SELECT id, content FROM proposals
    WHERE session_id = ${sessionId}
      AND status = 'pending'
  `;

  if ((pendingHinges as any[]).length === 0 && (pendingProposals as any[]).length === 0) {
    console.log(`[reviewer] No pending items for session ${sessionId} — skipping`);
    return;
  }

  console.log(`[reviewer] Reviewing ${(pendingHinges as any[]).length} hinge(s) and ${(pendingProposals as any[]).length} proposal(s) for session ${sessionId}`);

  const context = await buildReviewerContext(
    pendingHinges as { id: number; content: string }[],
    pendingProposals as { id: number; content: string }[],
    sessionId
  );

  let reviewsText: string;
  try {
    reviewsText = await callWithRetry(
      "claude-haiku-4-5-20251001",
      REVIEWER_SYSTEM_PROMPT,
      [{ role: "user", content: context }],
      3,
      1024
    );
  } catch (err) {
    console.error(`[reviewer] API call failed for session ${sessionId}:`, err);
    return;
  }

  let reviews: { type: string; id: number; decision: string; reason: string }[];
  try {
    const cleaned = reviewsText.replace(/```json|```/g, "").trim();
    reviews = JSON.parse(cleaned).reviews;
    if (!Array.isArray(reviews)) throw new Error("reviews is not an array");
  } catch (err) {
    console.error(`[reviewer] Parse error for session ${sessionId}:`, err, reviewsText);
    return; // Leave items pending for manual review
  }

  for (const review of reviews) {
    try {
      if (review.type === "hinge") {
        if (review.decision === "confirm") {
          await sql`
            UPDATE hinges
            SET confirmed          = true,
                rejection_reason   = NULL,
                reviewer_decision  = ${review.decision},
                reviewer_reason    = ${review.reason}
            WHERE id = ${review.id}
          `;
        } else if (review.decision === "reject") {
          await sql`
            UPDATE hinges
            SET confirmed          = false,
                rejection_reason   = ${review.reason},
                reviewer_decision  = ${review.decision},
                reviewer_reason    = ${review.reason}
            WHERE id = ${review.id}
          `;
        }
      } else if (review.type === "proposal") {
        if (review.decision === "approve") {
          await sql`
            UPDATE proposals
            SET status             = 'approved',
                admin_note         = ${review.reason},
                reviewed_at        = NOW(),
                reviewer_decision  = ${review.decision},
                reviewer_reason    = ${review.reason}
            WHERE id = ${review.id}
          `;
          // Trigger iteration transition — non-blocking, errors are logged not thrown
          triggerIterationTransition(review.id).catch((err) => {
            console.error(`[reviewer] Iteration transition failed for proposal id=${review.id}:`, err);
          });
        } else if (review.decision === "reject") {
          await sql`
            UPDATE proposals
            SET status             = 'rejected',
                admin_note         = ${review.reason},
                reviewed_at        = NOW(),
                reviewer_decision  = ${review.decision},
                reviewer_reason    = ${review.reason}
            WHERE id = ${review.id}
          `;
        }
      }
    } catch (err) {
      console.error(`[reviewer] Failed to write review for ${review.type} id=${review.id}:`, err);
    }
  }

  console.log(`[reviewer] Auto-executed ${reviews.length} decision(s) for session ${sessionId}`);
}

// ─── End Reviewer Agent ───────────────────────────────────────────────────────

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

  // Run Reviewer agent on any pending hinges/proposals from this session
  try {
    await reviewPendingSignals(sessionId);
  } catch (err) {
    console.error(`[reviewer] Unhandled error for session ${sessionId}:`, err);
  }
}

/** Call Anthropic API with exponential backoff retry */
async function callWithRetry(
  model: string,
  systemPrompt: string,
  messages: { role: "user" | "assistant"; content: string }[],
  maxRetries = 3,
  maxTokens = 512
): Promise<string> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
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
