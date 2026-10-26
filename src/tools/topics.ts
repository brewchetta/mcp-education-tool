import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db, listTopics, resolveTopic, unwrap, upsertTopic } from "../db.js";
import { resolveArticle, searchWikipedia } from "../wikipedia.js";
import { excerpt, fail, ok, safely } from "./util.js";

export function registerTopicTools(server: McpServer): void {
  server.registerTool(
    "search_wikipedia",
    {
      description:
        "Search Wikipedia for articles matching a query. Returns candidate titles and snippets; " +
        "use it to pick the right article before calling add_topic. Does not modify the knowledge base.",
      inputSchema: {
        query: z.string().min(1).describe("What to search for"),
        limit: z.number().int().min(1).max(10).default(5).describe("Max results"),
      },
    },
    safely(async ({ query, limit }) => ok(await searchWikipedia(query, limit))),
  );

  server.registerTool(
    "add_topic",
    {
      description:
        "Find the Wikipedia article for a topic, fetch its full text, and store it in the knowledge base " +
        "(re-adding refreshes it). If the term is ambiguous, nothing is saved and the list of possible " +
        "meanings is returned: call add_topic again with the exact title of the right one.",
      inputSchema: {
        topic: z.string().min(1).describe("Topic name or exact Wikipedia article title, e.g. 'Photosynthesis'"),
      },
    },
    safely(async ({ topic }) => {
      const result = await resolveArticle(topic);
      if (result.kind === "not_found") {
        return fail(`No Wikipedia article found for "${topic}". Try search_wikipedia with different wording.`);
      }
      if (result.kind === "disambiguation") {
        return ok({
          saved: false,
          reason: `"${result.title}" is a disambiguation page and could refer to many things.`,
          options: result.options,
          next: "Pick the meaning the user intends and call add_topic again with its exact article title (e.g. 'Mercury (planet)').",
        });
      }
      const { article, via } = result;
      const saved = await upsertTopic(article);
      return ok({
        saved: true,
        title: saved.title,
        url: saved.url,
        characters: saved.content.length,
        matched_via: via === "exact" ? "exact title" : "top search result (verify this is the right article)",
        summary: saved.summary,
      });
    }),
  );

  server.registerTool(
    "list_topics",
    { description: "List every topic in the knowledge base with its source URL and summary." },
    safely(async () => {
      const topics = await listTopics();
      return ok(topics.length ? topics : "The knowledge base is empty. Use add_topic to add a topic.");
    }),
  );

  server.registerTool(
    "get_topic",
    {
      description:
        "Read a stored topic. Title matching is case-insensitive and accepts partial titles. " +
        "Long articles are truncated to ~30k characters.",
      inputSchema: {
        topic: z.string().min(1).describe("Topic title (partial matches allowed)"),
        summary_only: z.boolean().default(false).describe("Return only the intro summary"),
      },
    },
    safely(async ({ topic, summary_only }) => {
      const t = await resolveTopic(topic);
      if (summary_only) return ok({ title: t.title, url: t.url, summary: t.summary });
      const { text, truncated } = excerpt(t.content);
      return ok({ title: t.title, url: t.url, fetched_at: t.fetched_at, truncated, content: text });
    }),
  );

  server.registerTool(
    "remove_topic",
    {
      description:
        "Permanently delete a topic from the knowledge base, along with all of its saved quizzes and flashcard decks.",
      inputSchema: {
        topic: z.string().min(1).describe("Exact topic title (partial matches are accepted if unambiguous)"),
      },
    },
    safely(async ({ topic }) => {
      const t = await resolveTopic(topic);
      unwrap(await db().from("topics").delete().eq("id", t.id), "deleting topic");
      return ok(`Deleted "${t.title}" and its quizzes and flashcard decks.`);
    }),
  );
}
