import { McpServer } from "@modelcontextprotocol/server";
import { registerFlashcardTools } from "./tools/flashcards";
import { registerQuizTools } from "./tools/quiz";
import { registerTopicTools } from "./tools/topics";
import { registerUiResources } from "./ui";

export const SERVER_INFO = { name: "mcp-education", version: "0.2.0" } as const;

/** Register everything this server offers. Shared by the stdio entry and the HTTP route. */
export function registerAll(server: McpServer): void {
  registerUiResources(server);
  registerTopicTools(server);
  registerQuizTools(server);
  registerFlashcardTools(server);
}

/** A fully wired server instance, for transports that construct their own (stdio). */
export function createServer(): McpServer {
  const server = new McpServer(SERVER_INFO);
  registerAll(server);
  return server;
}
