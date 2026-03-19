import { getDb } from "./db";
import { callWithRetry } from "./claude";
import { AXON_AGENTS, AXON_TURN_ORDER, type AxonRole } from "./axon-agents";

export const MAX_EXCHANGES = 12;

export interface AxonExchange {
  agent: AxonRole;
  content: string;
  exchange_number: number;
  skipped: boolean;
}

export interface OneExchangeResult {
  role: AxonRole;
  content: string;
  skipped: boolean;
  isComplete: boolean;
  decision?: "EXEC" | "PASS";
  finalContent?: string;
}

/** Run a single AXON exchange and persist it. Called once per process request. */
export async function runOneAxonExchange(
  requestId: string,
  inputText: string,
  previousExchanges: Array<{ agent: AxonRole; content: string }>,
  exchangeNumber: number
): Promise<OneExchangeResult> {
  const sql = getDb();
  const role = AXON_TURN_ORDER[exchangeNumber % AXON_TURN_ORDER.length];
  const agent = AXON_AGENTS[role];

  // Build context from previous exchanges
  const history = previousExchanges
    .map((ex) => `[${AXON_AGENTS[ex.agent].name}]: ${ex.content}`)
    .join("\n\n");

  const messages =
    exchangeNumber === 0
      ? [{ role: "user" as const, content: `Task: ${inputText}` }]
      : [
          {
            role: "user" as const,
            content: `Task: ${inputText}\n\n${history}\n\nYour turn.`,
          },
        ];

  const content = await callWithRetry(agent.model, agent.systemPrompt, messages, 2048);
  const skipped = content.trim() === "[PASS]";
  const newCount = exchangeNumber + 1;

  // Persist the exchange
  await sql`
    INSERT INTO axon_exchanges (request_id, exchange_number, agent, model, content, skipped)
    VALUES (${requestId}, ${exchangeNumber}, ${role}, ${agent.model}, ${content}, ${skipped})
  `;

  // Check for Resolver verdict
  if (role === "resolver" && !skipped) {
    if (content.includes("VERDICT: EXEC")) {
      const answer = content.split("ANSWER:")[1]?.trim() || content;
      await sql`
        UPDATE axon_requests SET
          exchange_count = ${newCount},
          status = 'complete',
          output_decision = 'EXEC',
          output_content = ${answer},
          confidence_level = 'high',
          completed_at = now()
        WHERE id = ${requestId}
      `;
      return { role, content, skipped, isComplete: true, decision: "EXEC", finalContent: answer };
    }
    if (content.includes("VERDICT: PASS")) {
      const finding = content.split("FINDING:")[1]?.trim() || content;
      await sql`
        UPDATE axon_requests SET
          exchange_count = ${newCount},
          status = 'complete',
          output_decision = 'PASS',
          output_content = ${finding},
          confidence_level = 'low',
          completed_at = now()
        WHERE id = ${requestId}
      `;
      return { role, content, skipped, isComplete: true, decision: "PASS", finalContent: finding };
    }
  }

  // Max exchanges reached — force PASS
  if (newCount >= MAX_EXCHANGES) {
    await sql`
      UPDATE axon_requests SET
        exchange_count = ${newCount},
        status = 'complete',
        output_decision = 'PASS',
        output_content = ${content},
        confidence_level = 'low',
        completed_at = now()
      WHERE id = ${requestId}
    `;
    return { role, content, skipped, isComplete: true, decision: "PASS", finalContent: content };
  }

  // Still running
  await sql`
    UPDATE axon_requests SET
      exchange_count = ${newCount},
      status = 'running'
    WHERE id = ${requestId}
  `;

  return { role, content, skipped, isComplete: false };
}
