import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load .env from the project root regardless of the directory the host launches us from.
// `quiet` matters: stdout is the MCP protocol channel and must stay clean.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(projectRoot, ".env"), quiet: true });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

export const config = {
  supabaseUrl: required("SUPABASE_URL"),
  supabaseKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  wikiUserAgent:
    process.env.WIKI_USER_AGENT?.trim() ||
    "mcp-education/0.1 (personal study tool; set WIKI_USER_AGENT with contact info)",
};
