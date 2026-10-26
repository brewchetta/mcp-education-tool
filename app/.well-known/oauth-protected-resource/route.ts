import { metadataCorsOptionsRequestHandler, protectedResourceHandler } from "mcp-handler";
import { issuerFor } from "@/auth";
import { getAuthConfig } from "@/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// RFC 9728 Protected Resource Metadata: tells an MCP client which authorization server (Supabase Auth)
// issues tokens for /api/mcp. Built per request because the env vars aren't available at build time.
export function GET(req: Request): Response {
  const { supabaseUrl, appUrl } = getAuthConfig();
  return protectedResourceHandler({
    authServerUrls: [issuerFor(supabaseUrl)],
    resourceUrl: `${appUrl}/api/mcp`,
  })(req);
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
