import Anthropic from "@anthropic-ai/sdk";
import { Sandbox } from "@e2b/code-interpreter";
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

type TurnType = "DATA_INPUT" | "QUESTION" | "COMPLAINT" | "NEW_TASK";

function classifyTurn(input: string, conversationHistory: ConversationTurn[]): TurnType {
  const lower = input.toLowerCase();

  const complaintPatterns = ["wrong", "bug", "error", "that's not", "stop", "you're repeating", "again", "same answer", "fix"];
  if (complaintPatterns.some(p => lower.includes(p))) return "COMPLAINT";

  if (conversationHistory.length > 0) {
    const lastContent = conversationHistory[conversationHistory.length - 1]?.verdict?.content ?? "";
    if (lastContent.trim().endsWith("?")) return "DATA_INPUT";
  }

  if (input.trim().split(/\s+/).length <= 4 && conversationHistory.length > 0) return "DATA_INPUT";

  return "QUESTION";
}

function buildTaskState(conversationHistory: ConversationTurn[]): string {
  const state: Record<string, string> = {};

  for (const turn of conversationHistory) {
    const qaMatch = turn.verdict?.content?.match(/Q(\d+)\s*[=:]\s*\*{0,2}([^*\n]+)\*{0,2}/gi);
    if (qaMatch) {
      for (const match of qaMatch) {
        const [, num, val] = match.match(/Q(\d+)\s*[=:]\s*\*{0,2}([^*\n]+)\*{0,2}/i) ?? [];
        if (num && val) state[`Q${num}`] = val.trim();
      }
    }
  }

  if (Object.keys(state).length === 0) return "";

  const lines = Object.entries(state).map(([k, v]) => `  ${k}: ${v}`).join("\n");
  return `\n[RECORDED STATE]\n${lines}\n`;
}

/**
 * Build Anthropic messages for any non-executor agent call.
 * Extracted from runOneAxonExchange so it can be reused by parallel and streaming paths.
 */
function buildAgentMessages(
  inputText: string,
  previousExchanges: Array<{ agent: AxonRole; content: string }>,
  exchangeNumber: number,
  context: AxonContext,
  currentTurnNumber: number,
  conversationHistory: ConversationTurn[]
): Anthropic.MessageParam[] {
  const hasContext = !!(context.text || context.file);
  const ctxNote = hasContext ? contextSummaryNote(context) : "";
  const turnType = classifyTurn(inputText, conversationHistory);
  const turnTypeNote = `[TURN TYPE: ${turnType}]`;
  const taskState = buildTaskState(conversationHistory);

  if (exchangeNumber === 0) {
    if (currentTurnNumber === 0) {
      return [buildFirstMessage(inputText, context)];
    } else {
      const historyStr = buildHistoryString(conversationHistory);
      const historyPrefix =
        conversationHistory.length > 0
          ? `Previous conversation:\n\n${historyStr}\n\n---\n\n`
          : "";
      return [
        {
          role: "user",
          content: `${historyPrefix}Current question (Turn ${currentTurnNumber + 1}): ${inputText}${turnTypeNote}${ctxNote}\n\nContinue reasoning based on the full conversation above.`,
        },
      ];
    }
  }

  const history = previousExchanges
    .map((ex) => `[${AXON_AGENTS[ex.agent].name}]: ${ex.content}`)
    .join("\n\n");

  if (currentTurnNumber > 0 && conversationHistory.length > 0) {
    const lastTurn = conversationHistory[conversationHistory.length - 1];
    const turnNote = `[Turn ${currentTurnNumber + 1} of the conversation. Last verdict: ${lastTurn.verdict.decision}]`;
    return [
      {
        role: "user",
        content: `Task: ${inputText}${turnTypeNote}${ctxNote}\n\n${turnNote}\n\n${taskState}${history}\n\nYour turn.`,
      },
    ];
  }

  return [
    {
      role: "user",
      content: `Task: ${inputText}${turnTypeNote}${ctxNote}\n\n${taskState}${history}\n\nYour turn.`,
    },
  ];
}

/** Execute web search or sandboxed code on behalf of the Executor agent. */
async function runExecutor(
  input: string,
  priorExchanges: string,
  conversationHistory: ConversationTurn[],
  turnType: string
): Promise<string> {
  const client = new Anthropic();

  // Detect if Explorer flagged a knowledge cutoff limitation
  const explorerFlaggedCutoff =
    priorExchanges.toLowerCase().includes("knowledge cutoff") ||
    priorExchanges.toLowerCase().includes("can't provide") ||
    priorExchanges.toLowerCase().includes("cannot provide") ||
    priorExchanges.toLowerCase().includes("real-time") ||
    priorExchanges.toLowerCase().includes("check current sources") ||
    priorExchanges.toLowerCase().includes("check reuters") ||
    priorExchanges.toLowerCase().includes("check ap");

  // PATH A — Force web search for current-events queries
  if (explorerFlaggedCutoff) {
    try {
      const searchResponse = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        system: "You are a web search agent. Search for the latest news and information on the topic provided. Return only the search results.",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: [{ type: "web_search_20250305", name: "web_search" }] as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tool_choice: { type: "tool", name: "web_search" } as any,
        messages: [{ role: "user", content: input }],
      });

      const resultText = searchResponse.content
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((b: any) => b.type === "text")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((b: any) => b.text)
        .join("\n");

      if (resultText.trim()) {
        return `[WEB SEARCH RESULT]\n${resultText}`;
      }

      return "[EXECUTOR ERROR: Web search returned empty results. Resolver should PASS and direct user to live sources.]";
    } catch (err) {
      return `[EXECUTOR ERROR: Web search failed — ${err instanceof Error ? err.message : String(err)}. Resolver should PASS and direct user to live sources.]`;
    }
  }

  // PATH B — Code execution for computation tasks (no web search tool present)
  const contextBlock = conversationHistory.length > 0
    ? `Previous conversation:\n${buildHistoryString(conversationHistory)}\n\nCurrent task: ${input}`
    : `Task: ${input}`;

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `${contextBlock}[TURN TYPE: ${turnType}]\n\n${priorExchanges}\n\nYour turn. Decide whether to run code or pass.`
    }
  ];

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    system: AXON_AGENTS["executor"].systemPrompt,
    messages,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const textBlock = response.content.find((b: any) => b.type === "text") as any;
  const text = textBlock?.text ?? "";

  if (text.trim() === "[PASS]") return "[PASS]";

  const codeMatch = text.match(/```(?:python|javascript|js|py)?\n([\s\S]+?)```/);
  if (codeMatch) {
    const code = codeMatch[1];
    try {
      const sandbox = await Sandbox.create({ apiKey: process.env.E2B_API_KEY! });
      const execution = await sandbox.runCode(code);
      await sandbox.kill();
      const output = execution.logs.stdout.join("\n") || execution.text || "No output";
      const errors = execution.logs.stderr.join("\n");
      return `[CODE EXECUTION RESULT]\nCode run:\n\`\`\`\n${code}\`\`\`\n\nOutput:\n${output}${errors ? `\n\nErrors:\n${errors}` : ""}`;
    } catch (err) {
      return `[CODE EXECUTION ERROR]\n${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return text || "[PASS]";
}

/**
 * Fire Validator and Monitor in parallel — both receive only Explorer's output.
 * Inserts both exchanges to DB. Does NOT update exchange_count (caller does it).
 */
export async function runParallelValidatorMonitor(
  requestId: string,
  inputText: string,
  previousExchanges: Array<{ agent: AxonRole; content: string }>,
  exchangeNumber: number, // Validator's slot (e.g. 1); Monitor gets exchangeNumber + 1
  context: AxonContext,
  currentTurnNumber: number,
  conversationHistory: ConversationTurn[]
): Promise<{
  validatorResult: { role: AxonRole; content: string; skipped: boolean };
  monitorResult: { role: AxonRole; content: string; skipped: boolean };
}> {
  const sql = getDb();
  const validatorAgent = AXON_AGENTS["validator"];
  const monitorAgent = AXON_AGENTS["monitor"];

  // Both agents receive the same prior context (Explorer only — tradeoff for parallelism)
  const validatorMessages = buildAgentMessages(
    inputText, previousExchanges, exchangeNumber, context, currentTurnNumber, conversationHistory
  );
  const monitorMessages = buildAgentMessages(
    inputText, previousExchanges, exchangeNumber + 1, context, currentTurnNumber, conversationHistory
  );

  const [validatorContent, monitorContent] = await Promise.all([
    callWithRetry(validatorAgent.model, validatorAgent.systemPrompt, validatorMessages, validatorAgent.maxTokens),
    callWithRetry(monitorAgent.model, monitorAgent.systemPrompt, monitorMessages, monitorAgent.maxTokens),
  ]);

  const validatorSkipped = validatorContent.trim() === "[PASS]";
  const monitorSkipped = monitorContent.trim() === "[PASS]";

  // Persist both exchanges in parallel
  await Promise.all([
    sql`
      INSERT INTO axon_exchanges (request_id, exchange_number, agent, model, content, skipped, turn_number)
      VALUES (${requestId}, ${exchangeNumber}, 'validator', ${validatorAgent.model}, ${validatorContent}, ${validatorSkipped}, ${currentTurnNumber})
    `,
    sql`
      INSERT INTO axon_exchanges (request_id, exchange_number, agent, model, content, skipped, turn_number)
      VALUES (${requestId}, ${exchangeNumber + 1}, 'monitor', ${monitorAgent.model}, ${monitorContent}, ${monitorSkipped}, ${currentTurnNumber})
    `,
  ]);

  return {
    validatorResult: { role: "validator", content: validatorContent, skipped: validatorSkipped },
    monitorResult: { role: "monitor", content: monitorContent, skipped: monitorSkipped },
  };
}

/**
 * Stream the Resolver's output as SSE. Persists exchange + updates request on completion.
 * Returns a ReadableStream the process route passes directly to new Response().
 */
export function streamResolverExchange(
  requestId: string,
  inputText: string,
  previousExchanges: Array<{ agent: AxonRole; content: string }>,
  exchangeNumber: number,
  context: AxonContext,
  currentTurnNumber: number,
  conversationHistory: ConversationTurn[]
): ReadableStream<Uint8Array> {
  const sql = getDb();
  const anthropic = new Anthropic();
  const agent = AXON_AGENTS["resolver"];
  const encoder = new TextEncoder();

  const messages = buildAgentMessages(
    inputText, previousExchanges, exchangeNumber, context, currentTurnNumber, conversationHistory
  );

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let fullContent = "";

      const sendEvent = (payload: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      try {
        const stream = anthropic.messages.stream({
          model: agent.model,
          max_tokens: agent.maxTokens,
          system: agent.systemPrompt,
          messages,
        });

        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            fullContent += event.delta.text;
            sendEvent({ text: event.delta.text });
          }
        }

        // Parse verdict
        const isExec = fullContent.includes("VERDICT: EXEC");
        const decision = isExec ? "EXEC" : "PASS";
        const answer = isExec
          ? fullContent.split("ANSWER:")[1]?.trim() || fullContent
          : fullContent.split("FINDING:")[1]?.trim() || fullContent;

        // Persist exchange and finalize request
        await sql`
          INSERT INTO axon_exchanges (request_id, exchange_number, agent, model, content, skipped, turn_number)
          VALUES (${requestId}, ${exchangeNumber}, 'resolver', ${agent.model}, ${fullContent}, false, ${currentTurnNumber})
        `;
        await sql`
          UPDATE axon_requests SET
            exchange_count = exchange_count + 1,
            status = 'complete',
            output_decision = ${decision},
            output_content = ${answer},
            confidence_level = ${isExec ? "high" : "low"},
            completed_at = now()
          WHERE id = ${requestId}
        `;

        sendEvent({ done: true, decision, content: answer });
        controller.close();

      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sendEvent({ error: message });
        try {
          await sql`UPDATE axon_requests SET status = 'error' WHERE id = ${requestId}`;
        } catch { /* ignore */ }
        controller.close();
      }
    },
  });
}

/** Run a single AXON exchange and persist it. Used for Explorer and Executor. */
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

  const turnType = classifyTurn(inputText, conversationHistory);

  // Executor short-circuits the normal callWithRetry flow — uses its own API call + tools
  if (role === "executor") {
    const priorExchangesText = previousExchanges
      .map(ex => `[${AXON_AGENTS[ex.agent].name}]: ${ex.content}`)
      .join("\n\n");

    const executorOutput = await runExecutor(
      inputText,
      priorExchangesText,
      conversationHistory,
      turnType
    );

    const skipped = executorOutput.trim() === "[PASS]";
    const newCount = exchangeNumber + 1;

    await sql`
      INSERT INTO axon_exchanges (request_id, exchange_number, agent, model, content, skipped, turn_number)
      VALUES (${requestId}, ${exchangeNumber}, 'executor', 'claude-sonnet-4-6', ${executorOutput}, ${skipped}, ${currentTurnNumber})
    `;

    if (newCount >= MAX_EXCHANGES) {
      const timeoutMsg = "Reasoning depth limit reached. Insufficient confidence to execute within available reasoning budget.";
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
      return { role, content: executorOutput, skipped, isComplete: true, decision: "PASS", finalContent: timeoutMsg };
    }

    await sql`
      UPDATE axon_requests SET
        exchange_count = ${newCount},
        status = 'running'
      WHERE id = ${requestId}
    `;

    return { role, content: executorOutput, skipped, isComplete: false };
  }

  const messages = buildAgentMessages(inputText, previousExchanges, exchangeNumber, context, currentTurnNumber, conversationHistory);

  const content = await callWithRetry(agent.model, agent.systemPrompt, messages, agent.maxTokens);
  const skipped = content.trim() === "[PASS]";
  const newCount = exchangeNumber + 1;

  await sql`
    INSERT INTO axon_exchanges (request_id, exchange_number, agent, model, content, skipped, turn_number)
    VALUES (${requestId}, ${exchangeNumber}, ${role}, ${agent.model}, ${content}, ${skipped}, ${currentTurnNumber})
  `;

  // Check for Resolver verdict (fallback non-streaming path)
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

  await sql`
    UPDATE axon_requests SET
      exchange_count = ${newCount},
      status = 'running'
    WHERE id = ${requestId}
  `;

  return { role, content, skipped, isComplete: false };
}
