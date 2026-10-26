"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

/**
 * Browser-side Supabase client for the login and consent pages. It uses the *publishable* key, which is
 * public by design: the tables are locked down by RLS, and only the server holds the service-role key.
 * Created lazily so the pages can be prerendered at build time without env vars.
 */
export function getSupabase(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set.");
    }
    client = createClient(url, key);
  }
  return client;
}

/** Only follow same-site relative paths after login; anything else (e.g. //evil.example) goes home. */
export function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}
