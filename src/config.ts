export interface Config {
  supabaseUrl: string;
  supabaseKey: string;
  wikiUserAgent: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env (local) or set it in the Vercel dashboard.`,
    );
  }
  return value;
}

export interface AuthConfig {
  supabaseUrl: string;
  /** Supabase user id (a UUID) of the one person allowed to use the deployed server. */
  ownerUserId: string;
  /** Public origin of the deployment, e.g. https://my-app.vercel.app (no trailing slash). */
  appUrl: string;
}

/** Settings for the OAuth-protected HTTP deployment. Throws if any is missing, so auth fails closed. */
export function getAuthConfig(): AuthConfig {
  return {
    supabaseUrl: required("SUPABASE_URL"),
    ownerUserId: required("OWNER_USER_ID"),
    appUrl: required("APP_URL").replace(/\/+$/, ""),
  };
}

let cached: Config | undefined;

/**
 * Read configuration on first use rather than at import time, so that importing the tool modules
 * (e.g. during `next build`, which has no secrets) never throws. The stdio entry loads `.env`
 * into `process.env` before anything calls this.
 */
export function getConfig(): Config {
  cached ??= {
    supabaseUrl: required("SUPABASE_URL"),
    supabaseKey: required("SUPABASE_SERVICE_ROLE_KEY"),
    wikiUserAgent:
      process.env.WIKI_USER_AGENT?.trim() ||
      "mcp-education/0.1 (personal study tool; set WIKI_USER_AGENT with contact info)",
  };
  return cached;
}
