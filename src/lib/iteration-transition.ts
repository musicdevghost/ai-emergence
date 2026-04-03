import Anthropic from "@anthropic-ai/sdk";
import { getDb } from "./db";

const anthropic = new Anthropic();

interface TransitionMetadata {
  outgoing_notable_moments: string[];
  outgoing_conclusion: string;
  incoming_name: string;
  incoming_tagline: string;
  incoming_description: string;
  incoming_seed_mode: "normal" | "silent";
}

const SYNTHESIS_SYSTEM_PROMPT = `You are generating metadata for an autonomous philosophical experiment's iteration transition.

You will receive:
- The outgoing iteration's name, description, and session record (extracted threads + key moments)
- The confirmed hinges produced during this iteration
- The approved proposal that signals the transition

You must produce a JSON object with exactly these fields:

{
  "outgoing_notable_moments": [string, string, ...],
  "outgoing_conclusion": string,
  "incoming_name": string,
  "incoming_tagline": string,
  "incoming_description": string,
  "incoming_seed_mode": "normal" | "silent"
}

Field guidance:
- outgoing_notable_moments: 3–6 key findings from the outgoing iteration, written as concise behavioral observations (not philosophical claims)
- outgoing_conclusion: 2–3 sentences summarizing what the iteration established and what it left open
- incoming_name: short evocative name for the new iteration (2–6 words, title case)
- incoming_tagline: one sentence — the iteration's driving question or frame
- incoming_description: 2–4 sentences expanding the tagline, referencing what the proposal asks
- incoming_seed_mode: "silent" if the proposal asks for no scaffolding/seeds/prompts, "normal" otherwise

Write in the voice of a careful observer. Notable moments should be behavioral observations. The incoming name should feel like a chapter title. The description should make clear what question drives the iteration without prescribing what agents should find.

Respond with ONLY the JSON object. No preamble, no markdown fences.`;

async function callSonnet(input: string): Promise<string> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: SYNTHESIS_SYSTEM_PROMPT,
    messages: [{ role: "user", content: input }],
  });
  return (response.content[0] as { type: string; text: string }).text;
}

async function synthesizeIterationTransition(proposalId: number): Promise<TransitionMetadata> {
  const sql = getDb();

  // Fetch the proposal and its iteration context
  const proposalRows = await sql`
    SELECT p.content AS proposal_content,
           i.id AS iteration_id, i.number AS iteration_number,
           i.name AS iteration_name, i.description AS iteration_description
    FROM proposals p
    JOIN sessions s ON s.id = p.session_id
    JOIN iterations i ON i.id = s.iteration_id
    WHERE p.id = ${proposalId}
  `;
  if ((proposalRows as any[]).length === 0) {
    throw new Error(`Proposal ${proposalId} not found or has no iteration`);
  }
  const proposal = (proposalRows as any[])[0];

  // Fetch sessions from the outgoing iteration
  const sessionsRows = await sql`
    SELECT extracted_thread, key_moments
    FROM sessions
    WHERE iteration_id = ${proposal.iteration_id} AND status = 'complete'
    ORDER BY created_at ASC
  `;

  // Fetch confirmed hinges produced during the outgoing iteration
  const hingesRows = await sql`
    SELECT h.content
    FROM hinges h
    JOIN sessions s ON s.id = h.session_id
    WHERE s.iteration_id = ${proposal.iteration_id} AND h.confirmed = TRUE
    ORDER BY h.created_at ASC
  `;

  // Build synthesis input
  let input = `OUTGOING ITERATION: ${proposal.iteration_number} — ${proposal.iteration_name}\n`;
  input += `Description: ${proposal.iteration_description}\n\n`;
  input += `APPROVED TRANSITION PROPOSAL:\n${proposal.proposal_content}\n\n`;

  input += `SESSION RECORD (${(sessionsRows as any[]).length} sessions):\n`;
  for (const sess of sessionsRows as any[]) {
    if (sess.extracted_thread) input += `  Thread: ${sess.extracted_thread}\n`;
    const kms: string[] = sess.key_moments || [];
    for (const km of kms) input += `  Key moment: ${km}\n`;
  }

  input += `\nCONFIRMED HINGES THIS ITERATION (${(hingesRows as any[]).length}):\n`;
  for (const h of hingesRows as any[]) {
    input += `  — ${h.content}\n`;
  }

  // Call Sonnet with two-attempt retry
  let raw: string;
  try {
    raw = await callSonnet(input);
  } catch (err) {
    console.error("[transition] Sonnet call failed, retrying:", err);
    raw = await callSonnet(input);
  }

  // Parse JSON — retry synthesis once if parsing fails
  let metadata: TransitionMetadata;
  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    metadata = JSON.parse(cleaned);
  } catch (parseErr) {
    console.error("[transition] JSON parse failed, retrying synthesis:", parseErr, raw);
    raw = await callSonnet(input);
    const cleaned = raw.replace(/```json|```/g, "").trim();
    metadata = JSON.parse(cleaned);
  }

  return metadata;
}

async function createNextIteration(
  metadata: TransitionMetadata,
  outgoingIterationId: number
): Promise<{ newIterationId: number; newIterationNumber: number }> {
  const sql = getDb();

  // Close outgoing iteration — sets notable_moments, conclusion, ended_at
  await sql`
    UPDATE iterations
    SET notable_moments = ${JSON.stringify(metadata.outgoing_notable_moments)},
        conclusion      = ${metadata.outgoing_conclusion},
        ended_at        = NOW()
    WHERE id = ${outgoingIterationId} AND ended_at IS NULL
  `;

  // Create incoming iteration using MAX(number) + 1 to avoid race conditions
  const rows = await sql`
    INSERT INTO iterations (number, name, tagline, description, conclusion, started_at, seed_mode)
    VALUES (
      COALESCE((SELECT MAX(number) FROM iterations), 0) + 1,
      ${metadata.incoming_name},
      ${metadata.incoming_tagline},
      ${metadata.incoming_description},
      '',
      NOW(),
      ${metadata.incoming_seed_mode}
    )
    RETURNING id, number
  `;
  const row = (rows as any[])[0];
  console.log(`[transition] Created Iteration ${row.number} — ${metadata.incoming_name} (id=${row.id})`);
  return { newIterationId: row.id as number, newIterationNumber: row.number as number };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function updateReadme(
  outgoingNumber: number,
  outgoingName: string,
  metadata: TransitionMetadata,
  newNumber: number
): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn("[transition] GITHUB_TOKEN not set — skipping README update");
    return;
  }

  const repo = "musicdevghost/ai-emergence";
  const apiBase = `https://api.github.com/repos/${repo}/contents/README.md`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  // Fetch current README
  const getRes = await fetch(apiBase, { headers });
  if (!getRes.ok) {
    console.error("[transition] Failed to fetch README:", getRes.status, await getRes.text());
    return;
  }
  const getJson = (await getRes.json()) as { content: string; sha: string };
  const currentContent = Buffer.from(getJson.content, "base64").toString("utf-8");
  const sha = getJson.sha;

  // Replace the outgoing iteration heading (strip any existing status suffix)
  const headingPattern = new RegExp(
    `(### Iteration ${outgoingNumber} — ${escapeRegex(outgoingName)})(?: \\*\\([^)]+\\)\\*)?`,
    "g"
  );
  let updatedContent = currentContent.replace(
    headingPattern,
    `### Iteration ${outgoingNumber} — ${outgoingName} *(complete)*`
  );

  // Build blocks to insert after the outgoing section
  const notableMomentsBlock =
    metadata.outgoing_notable_moments.length > 0
      ? `\n<details>\n<summary>Notable Moments</summary>\n\n${metadata.outgoing_notable_moments.map((m) => `- ${m}`).join("\n")}\n\n</details>\n`
      : "";
  const conclusionBlock = `\n**Conclusion:** ${metadata.outgoing_conclusion}\n`;
  const newSection = `\n### Iteration ${newNumber} — ${metadata.incoming_name}\n\n> *${metadata.incoming_tagline}*\n\n${metadata.incoming_description}\n`;

  // Find the outgoing heading position and insert before the next ### heading
  const completedHeading = `### Iteration ${outgoingNumber} — ${outgoingName} *(complete)*`;
  const outgoingPos = updatedContent.indexOf(completedHeading);
  if (outgoingPos === -1) {
    console.error("[transition] Could not find outgoing iteration heading in README after replacement");
    return;
  }

  const nextHeadingPos = updatedContent.indexOf("\n### ", outgoingPos + completedHeading.length);
  const insertAt = nextHeadingPos !== -1 ? nextHeadingPos : updatedContent.length;
  const insertContent = `${notableMomentsBlock}${conclusionBlock}\n${newSection}`;

  updatedContent =
    updatedContent.slice(0, insertAt) + insertContent + updatedContent.slice(insertAt);

  // Commit via GitHub API
  const putRes = await fetch(apiBase, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `chore: close Iteration ${outgoingNumber}, open Iteration ${newNumber} — ${metadata.incoming_name}`,
      content: Buffer.from(updatedContent, "utf-8").toString("base64"),
      sha,
      committer: {
        name: "musicdevghost",
        email: "92499519+musicdevghost@users.noreply.github.com",
      },
    }),
  });

  if (!putRes.ok) {
    console.error("[transition] Failed to commit README update:", putRes.status, await putRes.text());
    return;
  }
  console.log(
    `[transition] README updated: Iteration ${outgoingNumber} closed, Iteration ${newNumber} added`
  );
}

/**
 * Main entry point. Called after a transition proposal is approved (either by
 * the Haiku reviewer or by the human admin). Idempotent — if the transition
 * already happened the function exits early.
 */
export async function triggerIterationTransition(proposalId: number): Promise<void> {
  const sql = getDb();

  // Look up which iteration this proposal belongs to
  const proposalRows = await sql`
    SELECT p.id,
           i.id         AS iteration_id,
           i.number     AS iteration_number,
           i.name       AS iteration_name,
           i.ended_at   AS iteration_ended_at
    FROM proposals p
    JOIN sessions s ON s.id = p.session_id
    JOIN iterations i ON i.id = s.iteration_id
    WHERE p.id = ${proposalId}
  `;
  if ((proposalRows as any[]).length === 0) {
    console.warn(`[transition] Proposal ${proposalId} not found or has no session/iteration — skipping`);
    return;
  }
  const row = (proposalRows as any[])[0];

  // Guard 1: proposal's iteration is already closed → transition already happened
  if (row.iteration_ended_at !== null) {
    console.log(
      `[transition] Iteration ${row.iteration_number} already closed — skipping duplicate trigger for proposal ${proposalId}`
    );
    return;
  }

  // Guard 2: active iteration number is higher than proposal's iteration → transition already happened
  const activeRows = await sql`
    SELECT number FROM iterations WHERE ended_at IS NULL ORDER BY number DESC LIMIT 1
  `;
  if ((activeRows as any[]).length > 0) {
    const activeNumber = (activeRows as any[])[0].number as number;
    if (activeNumber > row.iteration_number) {
      console.log(
        `[transition] Active iteration ${activeNumber} > proposal's iteration ${row.iteration_number} — skipping`
      );
      return;
    }
  }

  console.log(
    `[transition] Starting transition: Iteration ${row.iteration_number} → next (proposal ${proposalId})`
  );

  // Synthesize metadata
  let metadata: TransitionMetadata;
  try {
    metadata = await synthesizeIterationTransition(proposalId);
  } catch (err) {
    console.error(`[transition] Synthesis failed for proposal ${proposalId} — manual intervention required:`, err);
    return;
  }

  // Create next iteration in DB
  let newIterationNumber: number;
  try {
    const result = await createNextIteration(metadata, row.iteration_id as number);
    newIterationNumber = result.newIterationNumber;
  } catch (err) {
    console.error(`[transition] DB creation failed:`, err);
    return;
  }

  // Update README (best-effort, non-blocking)
  updateReadme(
    row.iteration_number as number,
    row.iteration_name as string,
    metadata,
    newIterationNumber
  ).catch((err) => {
    console.error("[transition] README update failed (non-critical):", err);
  });
}
