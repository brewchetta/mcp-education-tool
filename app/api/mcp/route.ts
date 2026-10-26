import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { getOwnerVerifier } from "@/auth";
import { SERVER_INFO, registerAll } from "@/server";

// Per-request, Node runtime (the Supabase and jose clients need it); never prerendered at build time.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Stateless Streamable HTTP: every request gets a fresh server instance with all tools registered.
const mcp = createMcpHandler(registerAll, { serverInfo: SERVER_INFO });

// Requires a valid Supabase-issued OAuth token that belongs to the owner. Unauthenticated requests get
// a 401 whose WWW-Authenticate header points clients at /.well-known/oauth-protected-resource.
const handler = withMcpAuth(mcp, (req, bearerToken) => getOwnerVerifier()(req, bearerToken), {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
});

export { handler as GET, handler as POST };
