import Anthropic from "@anthropic-ai/sdk";
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

export interface AxonContext {
  text?: string | null;
  file?: {
    name: string;
    type: string;
    data: string;
  } | null;
}

export interface ConversationTurn {
  turn: number;
  user_input: string;
  verdict: {
    decision: "EXEC" | "PASS";
    content: string;
  };
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/** Build the first-exchange message for turn 0, optionally with multimodal context */
function buildFirstMessage(inputText: string, context: AxonContext): Anthropic.MessageParam {
  const taskText = `Task: ${inputText}`;

  if (context.file) {
    const { name, type, data } = context.file;

    if (type === "application/pdf") {
      return {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data },
          } as Anthropic.DocumentBlockParam,
          { type: "text", text: `Context: the document above.\n\n${taskText}` },
        ],
      };
    }

    if (IMAGE_TYPES.has(type)) {
      return {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: type as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
              data,
            },
          } as Anthropic.ImageBlockParam,
          { type: "text", text: `Context: the image above.\n\n${taskText}` },
        ],
      };
    }

    return { role: "user", content: `[Attached file: ${name}]\n\n${taskText}` };
  }

  if (context.text) {
    return {
      role: "user",
      content: `Context provided by user:\n${context.text}\n\n${taskText}`,
    };
  }

  return { role: "user", content: taskText };
}

/** Context note appended to exchanges after the first */
function contextSummaryNote(context: AxonContext): string {
  if (context.file?.name) return `\n\n[Context was provided in this session: ${context.file.name}]`;
  if (context.text) return `\n\n[Context was provided in this session: text context]`;
  return "";
}

/** Build conversation history summary for multi-turn context */
function buildHistoryString(conversationHistory: ConversationTurn[]): string {
  return conversationHistory
    .map(
      (t) =>
        `[Turn ${t.turn + 1}]\nUser: ${t.user_input}\nVerdict: ${t.verdict.decision}\n${t.verdict.content}`
    )
    .join("\n\n---\n\n");
}

/** Run a single AXON exchange and persist it. Called once per process request. */
export async function runOneAxonExchange(
  requestId: string,
  inputText: string,
  previousExchanges: Array<{ agent: AxonRole; content: string }>,
  exchangeNumber: number,
  context: AxonContext = {},
  currentTurnNumber: number = 0,
  conversationHistory: ConversationTurn[] = []
): Promise<OneExchangeResult> {
  const sql = getDb();
  const role = AXON_TURN_ORDER[exchangeNumber % AXON_TURN_ORDER.length];
  const agent = AXON_AGENTS[role];

  const hasContext = !!(context.text || context.file);
  const ctxNote = hasContext ? contextSummaryNote(context) : "";

  let messages: Anthropic.MessageParam[];

  if (exchangeNumber === 0) {
    if (currentTurnNumber === 0) {
      // Turn 0, first exchange: original task with optional file/text context
      messages = [buildFirstMessage(inputText, context)];
    } else {
      // Follow-up turn, first exchange: full conversation history + new question
      const historyStr = buildHistoryString(conversationHistory);
      const historyPrefix =
        conversationHistory.length > 0
          ? `Previous conversation:\n\n${historyStr}\n\n---\n\n`
          : "";
      messages = [
        {
          role: "user",
          content: `${historyPrefix}Current question (Turn ${currentTurnNumber + 1}): ${inputText}${ctxNote}\n\nContinue reasoning based on the full conversation above.`,
        },
      ];
    }
  } else {
    // Non-first exchange: within-turn history
    const history = previousExchanges
      .map((ex) => `[${AXON_AGENTS[ex.agent].name}]: ${ex.content}`)
      .join("\n\n");

    if (currentTurnNumber > 0 && conversationHistory.length > 0) {
      const lastTurn = conversationHistory[conversationHistory.length - 1];
      const turnNote = `[Turn ${currentTurnNumber + 1} of the conversation. Last verdict: ${lastTurn.verdict.decision}]`;
      messages = [
        {
          role: "user",
          content: `Task: ${inputText}${ctxNote}\n\n${turnNote}\n\n${history}\n\nYour turn.`,
        },
      ];
    } else {
      messages = [
        {
          role: "user",
          content: `Task: ${inputText}${ctxNote}\n\n${history}\n\nYour turn.`,
        },
      ];
    }
  }

  const content = await callWithRetry(agent.model, agent.systemPrompt, messages, agent.maxTokens);
  const skipped = content.trim() === "[PASS]";
  const newCount = exchangeNumber + 1;

  // Persist the exchange (with turn_number)
  await sql`
    INSERT INTO axon_exchanges (request_id, exchange_number, agent, model, content, skipped, turn_number)
    VALUES (${requestId}, ${exchangeNumber}, ${role}, ${agent.model}, ${content}, ${skipped}, ${currentTurnNumber})
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
    const timeoutMsg =
      "Reasoning depth limit reached. Insufficient confidence to execute within available reasoning budget.";
    await sql`
      UPDATE axon_requests SET
        exchange_count = ${newCount},
        status = 'complete',
        output_decision = 'PASS',
        output_content = ${timeoutMsg},
        confidence_level = 'low',
        completed_at = now()
      WHERE id = ${requestId}
    `;
    return { role, content, skipped, isComplete: true, decision: "PASS", finalContent: timeoutMsg };
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
