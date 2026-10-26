import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RESOURCE_MIME_TYPE, registerAppResource } from "@modelcontextprotocol/ext-apps/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The interactive quiz view. Tools that display a quiz point at this URI via `_meta.ui.resourceUri`. */
export const QUIZ_UI_URI = "ui://education/quiz.html";

// Produced by `npm run build` (scripts/build-ui.mjs) next to the compiled server.
const QUIZ_HTML_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "ui", "quiz.html");

export function registerUiResources(server: McpServer): void {
  registerAppResource(
    server,
    "Interactive Quiz",
    QUIZ_UI_URI,
    { description: "Clickable multiple-choice quiz with instant feedback and a final score." },
    async () => ({
      contents: [
        {
          uri: QUIZ_UI_URI,
          mimeType: RESOURCE_MIME_TYPE,
          // Read per request so a rebuild is picked up without restarting the server.
          text: await readFile(QUIZ_HTML_PATH, "utf-8"),
        },
      ],
    }),
  );
}
