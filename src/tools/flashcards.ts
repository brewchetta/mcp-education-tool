import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { db, resolveTopic, unwrap, unwrapMaybe } from "../db";
import { excerpt, fail, ok, safely } from "./util";

const cardSchema = z.object({
  front: z.string().min(1).describe("Prompt: a term, question, or cue"),
  back: z.string().min(1).describe("Answer: concise, self-contained"),
});

export function registerFlashcardTools(server: McpServer): void {
  server.registerTool(
    "prepare_flashcards",
    {
      description:
        "Step 1 of making flashcards: fetch the stored article for a topic plus instructions for writing a " +
        "deck. After writing the cards, call save_flashcards.",
      inputSchema: z.object({
        topic: z.string().min(1).describe("Topic in the knowledge base"),
        num_cards: z.number().int().min(1).max(50).default(15),
      }),
    },
    safely(async ({ topic, num_cards }) => {
      const t = await resolveTopic(topic);
      const { text, truncated } = excerpt(t.content);
      return ok(
        [
          `Write ${num_cards} flashcards on "${t.title}" using ONLY the source article below.`,
          ``,
          `Rules:`,
          `- One idea per card. Front is a term, question, or cue; back is a concise answer (1-2 sentences).`,
          `- Cover key terms, concepts, causes/effects, and notable people or events across the article's sections.`,
          `- Cards must stand alone: no "as mentioned above" and no answers that depend on other cards.`,
          ``,
          `Then:`,
          `1. Call save_flashcards with topic="${t.title}", a deck title, and the cards.`,
          `2. Offer to run the deck with the user one card at a time (front first, reveal the back on request).`,
          ``,
          `--- SOURCE: ${t.title} (${t.url ?? "no url"})${truncated ? " [truncated]" : ""} ---`,
          text,
        ].join("\n"),
      );
    }),
  );

  server.registerTool(
    "save_flashcards",
    {
      description: "Step 2 of making flashcards: store a deck you wrote. Returns the deck id.",
      inputSchema: z.object({
        topic: z.string().min(1).describe("Topic in the knowledge base"),
        title: z.string().min(1),
        cards: z.array(cardSchema).min(1).max(100),
      }),
    },
    safely(async ({ topic, title, cards }) => {
      const t = await resolveTopic(topic);
      const deck = unwrap(
        await db().from("flashcard_decks").insert({ topic_id: t.id, title }).select("id").single(),
        "saving deck",
      );

      const rows = cards.map((c, i) => ({ deck_id: deck.id, position: i + 1, front: c.front, back: c.back }));
      const inserted = await db().from("flashcards").insert(rows);
      if (inserted.error) {
        await db().from("flashcard_decks").delete().eq("id", deck.id);
        return fail(`Supabase error while saving cards: ${inserted.error.message}`);
      }
      return ok({ saved: true, deck_id: deck.id, topic: t.title, cards: cards.length });
    }),
  );

  server.registerTool(
    "get_deck",
    {
      description: "Load a saved flashcard deck with all its cards.",
      inputSchema: z.object({ deck_id: z.string().uuid() }),
    },
    safely(async ({ deck_id }) => {
      const deck = unwrapMaybe(
        await db()
          .from("flashcard_decks")
          .select("id,title,created_at,topics(title),flashcards(position,front,back)")
          .eq("id", deck_id)
          .maybeSingle(),
        "loading deck",
      );
      if (!deck) return fail(`No deck with id ${deck_id}. Use list_decks to see saved decks.`);
      deck.flashcards.sort((a: any, b: any) => a.position - b.position);
      return ok(deck);
    }),
  );

  server.registerTool(
    "list_decks",
    {
      description: "List saved flashcard decks, optionally only those for one topic.",
      inputSchema: z.object({ topic: z.string().optional().describe("Limit to this topic") }),
    },
    safely(async ({ topic }) => {
      let query = db()
        .from("flashcard_decks")
        .select("id,title,created_at,topics(title),flashcards(count)")
        .order("created_at", { ascending: false });
      if (topic) query = query.eq("topic_id", (await resolveTopic(topic)).id);
      const decks = unwrap(await query, "listing decks");
      return ok(decks.length ? decks : "No saved decks yet. Use prepare_flashcards to make one.");
    }),
  );
}
