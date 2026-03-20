import Anthropic from "@anthropic-ai/sdk";

// timeout: 240s per attempt leaves headroom within the 300s Vercel ceiling
// maxRetries: 0 disables SDK auto-retry — we manage retries manually in callWithRetry
const anthropic = new Anthropic({ timeout: 240_000, maxRetries: 0 });

/** Call Anthropic API with exponential backoff retry. Supports multimodal content. */
export async function callWithRetry(
  model: string,
  systemPrompt: string,
  messages: Anthropic.MessageParam[],
  maxTokens = 512,
  maxRetries = 3
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
      // 429 rate limit: retry-after can be 500+ seconds — never retry, fail fast
      if (error instanceof Anthropic.RateLimitError) throw error;
      if (attempt === maxRetries - 1) throw error;
      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Max retries exceeded");
}
