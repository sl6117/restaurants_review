/**
 * Minimal Anthropic Messages API client.
 *
 * The pipeline stages depend only on the `Complete` function type, so tests
 * substitute a fixture-backed completer and never touch the network.
 */

export const HAIKU_MODEL = "claude-haiku-4-5-20251001";
export const SONNET_MODEL = "claude-sonnet-5";

export interface CompletionRequest {
  model: string;
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
}

export type Complete = (request: CompletionRequest) => Promise<string>;

export function createAnthropicCompleter(apiKey: string): Complete {
  return async (request) => {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        system: request.system,
        messages: [{ role: "user", content: request.user }],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Anthropic API ${response.status}: ${body.slice(0, 300)}`);
    }
    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = (data.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");
    if (!text) throw new Error("Anthropic API returned no text content");
    return text;
  };
}

/**
 * Parses a JSON object out of a model reply, tolerating the one deviation
 * models actually produce: a ```json fence or prose around the object.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new Error(`Model reply contains no JSON object: ${trimmed.slice(0, 120)}`);
    }
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      throw new Error(`Model reply is not valid JSON: ${trimmed.slice(0, 120)}`);
    }
  }
}
