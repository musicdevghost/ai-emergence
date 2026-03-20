import Anthropic from "@anthropic-ai/sdk";

// 240s per-attempt timeout — leaves headroom for one full retry within the 300s Vercel ceiling
const anthropic = new Anthropic({ timeout: 240_000 });

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
      if (attempt === maxRetries - 1) throw error;
      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Max retries exceeded");
}
