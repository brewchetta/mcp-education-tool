import type { AuthInfo } from "@modelcontextprotocol/server";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { getAuthConfig } from "./config";

/** Supabase issues OAuth access tokens as asymmetric JWTs. Refusing HS256 rules out algorithm confusion. */
const ALLOWED_ALGORITHMS = ["ES256", "RS256"];

/** Every signed-in Supabase user's token carries this audience, so it proves nothing about *who* they are. */
const SUPABASE_AUDIENCE = "authenticated";

export function issuerFor(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/auth/v1`;
}

export interface VerifierOptions {
  issuer: string;
  ownerUserId: string;
  keys: JWTVerifyGetKey;
}

export type TokenVerifier = (req: Request, bearerToken?: string) => Promise<AuthInfo | undefined>;

/**
 * Build the bearer-token check for the MCP route. A token is accepted only if it is a validly signed,
 * unexpired Supabase JWT for this project AND belongs to the single owner. Any failure returns
 * `undefined` (HTTP 401) without saying why.
 */
export function createOwnerVerifier({ issuer, ownerUserId, keys }: VerifierOptions): TokenVerifier {
  return async (_req, bearerToken) => {
    if (!bearerToken) return undefined;
    try {
      const { payload } = await jwtVerify(bearerToken, keys, {
        issuer,
        audience: SUPABASE_AUDIENCE,
        algorithms: ALLOWED_ALGORITHMS,
      });
      // Authorization, not just authentication: only the owner may use this server.
      if (payload.sub !== ownerUserId) return undefined;
      return {
        token: bearerToken,
        // OAuth-issued tokens carry the registering client's id; a plain session token does not.
        clientId: typeof payload.client_id === "string" ? payload.client_id : "supabase-session",
        scopes: [],
        expiresAt: payload.exp,
        extra: { userId: payload.sub },
      };
    } catch {
      return undefined;
    }
  };
}

let defaultVerifier: TokenVerifier | undefined;

/** The production verifier, wired from environment variables on first use. Throws if misconfigured (fail closed). */
export function getOwnerVerifier(): TokenVerifier {
  if (!defaultVerifier) {
    const { supabaseUrl, ownerUserId } = getAuthConfig();
    const issuer = issuerFor(supabaseUrl);
    defaultVerifier = createOwnerVerifier({
      issuer,
      ownerUserId,
      // jose caches the key set and refetches on key rotation.
      keys: createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)),
    });
  }
  return defaultVerifier;
}
