import { getDb } from "./db";
import { callWithRetry } from "./claude";
import { AXON_AGENTS, AXON_TURN_ORDER, type AxonRole } from "./axon-agents";

const MIN_EXCHANGES = 4;
const MAX_EXCHANGES = 12;

export interface AxonExchange {
  agent: AxonRole;
  content: string;
  exchange_number: number;
  skipped: boolean;
}

export async function runAxon(
  requestId: string,
  inputText: string
): Promise<{
  decision: "EXEC" | "PASS";
  content: string;
  exchanges: AxonExchange[];
}> {
  const sql = getDb();
  const exchanges: AxonExchange[] = [];

  for (let i = 0; i < MAX_EXCHANGES; i++) {
    const role = AXON_TURN_ORDER[i % AXON_TURN_ORDER.length];
    const agent = AXON_AGENTS[role];

    // Build context from previous exchanges
    const history = exchanges
      .map(
        (ex) =>
          `[${AXON_AGENTS[ex.agent as AxonRole].name}]: ${ex.content}`
      )
      .join("\n\n");

    const messages =
      i === 0
        ? [{ role: "user" as const, content: `Task: ${inputText}` }]
        : [
            {
              role: "user" as const,
              content: `Task: ${inputText}\n\n${history}\n\nYour turn.`,
            },
          ];

    const content = await callWithRetry(agent.model, agent.systemPrompt, messages, 512);

    const skipped = content.trim() === "[PASS]";

    // Store exchange
    await sql`
      INSERT INTO axon_exchanges (request_id, exchange_number, agent, model, content, skipped)
      VALUES (${requestId}, ${i}, ${role}, ${agent.model}, ${content}, ${skipped})
    `;

    await sql`
      UPDATE axon_requests SET exchange_count = ${i + 1} WHERE id = ${requestId}
    `;

    exchanges.push({ agent: role, content, exchange_number: i, skipped });

    // Check for forced verdict from Resolver
    if (role === "resolver" && !skipped) {
      if (content.includes("VERDICT: EXEC")) {
        const answer = content.split("ANSWER:")[1]?.trim() || content;
        await sql`
          UPDATE axon_requests SET
            status = 'complete',
            output_decision = 'EXEC',
            output_content = ${answer},
            confidence_level = 'high',
            completed_at = now()
          WHERE id = ${requestId}
        `;
        return { decision: "EXEC", content: answer, exchanges };
      }
      if (content.includes("VERDICT: PASS")) {
        const finding = content.split("FINDING:")[1]?.trim() || content;
        await sql`
          UPDATE axon_requests SET
            status = 'complete',
            output_decision = 'PASS',
            output_content = ${finding},
            confidence_level = 'low',
            completed_at = now()
          WHERE id = ${requestId}
        `;
        return { decision: "PASS", content: finding, exchanges };
      }
    }

    // Allow early exit after MIN_EXCHANGES if Resolver gave a clear answer
    if (i >= MIN_EXCHANGES - 1 && role === "resolver" && !skipped) {
      // Already handled VERDICT: EXEC/PASS above; if resolver spoke without verdict,
      // continue to let it refine further
    }
  }

  // Force PASS if max exchanges reached without a verdict
  const lastContent =
    exchanges[exchanges.length - 1]?.content || "Max reasoning depth reached.";

  await sql`
    UPDATE axon_requests SET
      status = 'complete',
      output_decision = 'PASS',
      output_content = ${lastContent},
      confidence_level = 'low',
      completed_at = now()
    WHERE id = ${requestId}
  `;

  return { decision: "PASS", content: lastContent, exchanges };
}
