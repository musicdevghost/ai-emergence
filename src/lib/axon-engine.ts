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

/** Execute web search or sandboxed code on behalf of the Executor agent. */
async function runExecutor(
  input: string,
  priorExchanges: string,
  conversationHistory: ConversationTurn[],
  turnType: string
): Promise<string> {
  const client = new Anthropic({ timeout: 240_000, maxRetries: 0 });

  const contextBlock = conversationHistory.length > 0
    ? `Previous conversation:\n${buildHistoryString(conversationHistory)}\n\nCurrent task: ${input}`
    : `Task: ${input}`;

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `${contextBlock}[TURN TYPE: ${turnType}]\n\n${priorExchanges}\n\nYour turn. Decide whether to search, run code, or pass.`
    }
  ];

  // First call: let executor decide and invoke tool
  // Retry loop mirrors callWithRetry — skip 429 (long window), retry 529 (overloaded) and others
  let response_: Anthropic.Message | null = null;
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      response_ = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: AXON_AGENTS["executor"].systemPrompt,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: [{ type: "web_search_20250305", name: "web_search" }] as any,
        messages,
      }) as Anthropic.Message;
      break;
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) throw err;
      if (attempt === maxRetries - 1) throw err;
      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  if (!response_) throw new Error("Executor: no response after retries");


  // If model returned only text with no tool use and the query looks current-events-related,
  // force a web search before proceeding
  const hasToolUse = response_.content.some(b => b.type === "tool_use");
  const hasText = response_.content.some(b => b.type === "text");

  if (!hasToolUse && hasText) {
    // Check if Explorer flagged a knowledge cutoff limitation in prior exchanges
    const explorerFlaggedCutoff = priorExchanges.toLowerCase().includes("knowledge cutoff") ||
      priorExchanges.toLowerCase().includes("can't provide") ||
      priorExchanges.toLowerCase().includes("cannot provide");

    if (explorerFlaggedCutoff) {
      // Force a web search instead of accepting the hallucinated text
      return "[EXECUTOR ERROR: Web search tool was not called despite current-events query. Resolver should treat this as a PASS and direct user to live sources.]";
    }
  }

  // Check if executor passed
  const textBlock = response_.content.find(b => b.type === "text") as Anthropic.TextBlock | undefined;
  if (textBlock && textBlock.text.trim() === "[PASS]") {
    return "[PASS]";
  }

  // Check for web search tool use
  const toolUseBlock = response_.content.find(b => b.type === "tool_use") as Anthropic.ToolUseBlock | undefined;
  if (toolUseBlock && toolUseBlock.name === "web_search") {
    // Web search result is returned inline by Anthropic — extract text from response
    const resultText = response_.content
      .filter(b => b.type === "text")
      .map(b => (b as Anthropic.TextBlock).text)
      .join("\n");
    return `[WEB SEARCH RESULT]\n${resultText}`;
  }

  // Check if executor wants to run code (text contains code block)
  const text = textBlock?.text ?? "";
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

  // Executor responded with text only (no tool, no code)
  return text;
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

  const turnType = classifyTurn(inputText, conversationHistory);
  const turnTypeNote = `[TURN TYPE: ${turnType}]`;
  const taskState = buildTaskState(conversationHistory);

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
          content: `${historyPrefix}Current question (Turn ${currentTurnNumber + 1}): ${inputText}${turnTypeNote}${ctxNote}\n\nContinue reasoning based on the full conversation above.`,
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
          content: `Task: ${inputText}${turnTypeNote}${ctxNote}\n\n${turnNote}\n\n${taskState}${history}\n\nYour turn.`,
        },
      ];
    } else {
      messages = [
        {
          role: "user",
          content: `Task: ${inputText}${turnTypeNote}${ctxNote}\n\n${taskState}${history}\n\nYour turn.`,
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
