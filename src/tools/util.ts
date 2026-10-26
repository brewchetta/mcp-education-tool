import type { CallToolResult } from "@modelcontextprotocol/server";

export function ok(data: unknown): CallToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

export function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** Wrap a handler so thrown errors become tool errors the agent can read and recover from. */
export function safely<A>(handler: (args: A) => Promise<CallToolResult>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return await handler(args);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  };
}

export const MAX_SOURCE_CHARS = 30_000;

/** Cap article text, cutting at a section or paragraph boundary rather than mid-sentence. */
export function excerpt(content: string, max = MAX_SOURCE_CHARS): { text: string; truncated: boolean } {
  if (content.length <= max) return { text: content, truncated: false };
  const head = content.slice(0, max);
  const cut = Math.max(head.lastIndexOf("\n== "), head.lastIndexOf("\n\n"));
  return { text: (cut > max * 0.5 ? head.slice(0, cut) : head).trim(), truncated: true };
}
