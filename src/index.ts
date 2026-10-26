import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

async function main(): Promise<void> {
  // Tool modules import config, which throws on missing env vars. Loading them
  // dynamically lets that failure land in the handler below as a clean message
  // instead of an unhandled module-load stack trace.
  const [{ registerTopicTools }, { registerQuizTools }, { registerFlashcardTools }, { registerUiResources }] =
    await Promise.all([
      import("./tools/topics.js"),
      import("./tools/quiz.js"),
      import("./tools/flashcards.js"),
      import("./ui.js"),
    ]);

  const server = new McpServer({ name: "mcp-education", version: "0.1.0" });
  registerUiResources(server);
  registerTopicTools(server);
  registerQuizTools(server);
  registerFlashcardTools(server);

  await server.connect(new StdioServerTransport());
  // stdout carries the protocol, so all logging goes to stderr.
  console.error("mcp-education server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
