// Local entry point: serves the same tools over stdio for clients that launch the server themselves
// (Claude Code, the MCP Inspector). The deployed server uses app/api/mcp/route.ts instead.
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server";
import { getConfig } from "./config";

// Load .env from the project root regardless of the directory the host launches us from.
// `quiet` matters: stdout is the MCP protocol channel and must stay clean.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(projectRoot, ".env"), quiet: true });

try {
  getConfig(); // fail fast with a clear message instead of on the first tool call
  serveStdio(() => createServer());
  // stdout carries the protocol, so all logging goes to stderr.
  console.error("mcp-education server running on stdio");
} catch (err) {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
}
