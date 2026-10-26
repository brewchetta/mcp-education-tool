import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "./config";

export interface Topic {
  id: string;
  title: string;
  wikipedia_page_id: number | null;
  url: string | null;
  summary: string | null;
  content: string;
  fetched_at: string;
}

export type TopicSummary = Pick<Topic, "id" | "title" | "url" | "summary" | "fetched_at">;

let client: SupabaseClient | undefined;

export function db(): SupabaseClient {
  if (!client) {
    const { supabaseUrl, supabaseKey } = getConfig();
    client = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

type Response<T> = { data: T; error: { message: string } | null };

/** Unwrap a Supabase response, turning `{ error }` into a thrown Error. */
export function unwrap<T>(res: Response<T>, action: string): NonNullable<T> {
  if (res.error) throw new Error(`Supabase error while ${action}: ${res.error.message}`);
  return res.data as NonNullable<T>;
}

/** Like unwrap, but for lookups (maybeSingle) where "no row" is a normal, null result. */
export function unwrapMaybe<T>(res: Response<T>, action: string): T {
  if (res.error) throw new Error(`Supabase error while ${action}: ${res.error.message}`);
  return res.data;
}

/** Escape LIKE wildcards so user text is matched literally. */
function likeEscape(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function upsertTopic(input: {
  title: string;
  url: string;
  pageId: number;
  summary: string;
  content: string;
}): Promise<Topic> {
  const res = await db()
    .from("topics")
    .upsert(
      {
        title: input.title,
        url: input.url,
        wikipedia_page_id: input.pageId,
        summary: input.summary,
        content: input.content,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "title" },
    )
    .select()
    .single();
  return unwrap(res, "saving topic");
}

export async function listTopics(): Promise<TopicSummary[]> {
  const res = await db()
    .from("topics")
    .select("id,title,url,summary,fetched_at")
    .order("title");
  return unwrap(res, "listing topics") ?? [];
}

/**
 * Find a stored topic by title: exact (case-insensitive) match first, then substring.
 * Throws a descriptive error if nothing matches or the match is ambiguous, so the
 * calling agent can recover (e.g. by calling add_topic or retrying with a full title).
 */
export async function resolveTopic(query: string): Promise<Topic> {
  const q = query.trim();
  const exact = unwrap(
    await db().from("topics").select("*").ilike("title", likeEscape(q)).limit(2),
    "looking up topic",
  );
  if (exact.length === 1) return exact[0] as Topic;

  const fuzzy = unwrap(
    await db().from("topics").select("*").ilike("title", `%${likeEscape(q)}%`).limit(6),
    "searching topics",
  ) as Topic[];
  if (fuzzy.length === 1) return fuzzy[0];
  if (fuzzy.length > 1) {
    throw new Error(
      `"${query}" matches several topics: ${fuzzy.map((t) => t.title).join(", ")}. Use the full title.`,
    );
  }

  const all = await listTopics();
  const available = all.length ? all.map((t) => t.title).join(", ") : "(knowledge base is empty)";
  throw new Error(
    `No topic matching "${query}" in the knowledge base. Available topics: ${available}. ` +
      `Use add_topic to fetch it from Wikipedia first.`,
  );
}
