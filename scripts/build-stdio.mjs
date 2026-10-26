// Bundles the local stdio entry (src/stdio.ts) into build/index.js, which .mcp.json and the MCP
// Inspector launch. Dependencies stay external: this build only runs where node_modules exists.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [path.join(root, "src", "stdio.ts")],
  outfile: path.join(root, "build", "index.js"),
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  logLevel: "warning",
});
console.error("build-stdio: wrote build/index.js");
