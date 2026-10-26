# mcp-education

A personal study tool, delivered as an [MCP](https://modelcontextprotocol.io) server. Give it a topic and it pulls the Wikipedia article into a Supabase (Postgres) knowledge base. Then ask your AI agent for quizzes and flashcards on anything in that knowledge base, and they're saved for reuse.

> **Personal use only.** The server talks to Supabase with the **service-role key**, which bypasses Row Level Security. That's fine for a single-user server running on your own machine. Don't deploy it publicly or share the key. See [Security](#security).

## How it works

```
 you ──ask──▶ agent ──MCP tools──▶ mcp-education ──▶ Wikipedia API   (add_topic)
                                         │
                                         └──────────▶ Supabase       (topics, quizzes, decks)
```

Quizzes and flashcards are written **by the agent**, not by the server. This keeps the server free of LLM API keys and costs:

1. `prepare_quiz` / `prepare_flashcards` returns the stored article plus writing instructions.
2. The agent writes the questions or cards.
3. `save_quiz` / `save_flashcards` validates and stores them in Supabase.

For quizzes, step 3 also **shows the quiz inline in the chat** as an interactive [MCP App](https://apps.extensions.modelcontextprotocol.io): click an answer, get instant right/wrong feedback with an explanation, and see a final score with a review of every question. Clients that can't render MCP Apps still get the questions as text.

## Tools

| Tool | What it does |
|---|---|
| `search_wikipedia` | Search Wikipedia for candidate articles (read-only) |
| `add_topic` | Fetch an article and save it to the knowledge base. Ambiguous terms (e.g. "Mercury") return the possible meanings instead of saving |
| `list_topics` / `get_topic` | Browse the knowledge base; titles match case-insensitively and partially |
| `remove_topic` | Delete a topic and its quizzes and decks |
| `prepare_quiz` → `save_quiz` | Create a multiple-choice quiz; `save_quiz` stores it **and shows the interactive quiz** |
| `get_quiz` | Reopen a saved quiz as an interactive quiz to retake |
| `list_quizzes` | List saved quizzes and their ids |
| `prepare_flashcards` → `save_flashcards` | Create a flashcard deck |
| `get_deck` / `list_decks` | Retrieve saved decks |

## The interactive quiz

- **Flow:** one question at a time. Picking an answer locks it and shows green/red feedback plus the explanation. Keyboard works too (`1`–`4` or `A`–`D` to answer, `Enter` for next).
- **Results:** score and percentage, plus a collapsible review. Missed questions start expanded and show your answer, the correct one, and the explanation.
- **Retake** reshuffles the answer order. **Ask Claude to explain my misses** sends your wrong answers to the chat.
- **Claude knows your score.** When you finish, the result (score and what you missed) is added to the model's context without triggering a reply, so "how did I do?" just works.
- **Spoilers:** answers travel to the quiz view in the tool's `structuredContent`, which goes to the UI but not the model's context. The model is told not to repeat the questions in chat.
- **Theming:** it uses the host's colors and fonts when provided and has light/dark fallbacks. The layout works at phone width.
- **Not tracked yet:** scores live in the view only. Saving attempts to Supabase (a `quiz_attempts` table) would be a natural next step.

### How it's built

The view is a single self-contained HTML file (`ui/quiz.html` + `ui/quiz.ts`), bundled with esbuild together with the MCP Apps client SDK into `build/ui/quiz.html`. The server registers it as the resource `ui://education/quiz.html`, and `save_quiz` and `get_quiz` point at it with `_meta.ui.resourceUri`. The host fetches the resource, renders it in a sandboxed iframe, and passes the quiz in as the tool result. Run `npm run build` after editing anything under `ui/`; the server reads the file on each request, so no restart is needed for UI-only changes (restart for tool changes).

## Setup

Requires Node 20+ and a free [Supabase](https://supabase.com) project.

1. **Create the tables.** In the Supabase dashboard open *SQL Editor*, paste the contents of [`supabase/schema.sql`](supabase/schema.sql), and run it.
2. **Configure credentials.** Copy `.env.example` to `.env` and fill in:
   - `SUPABASE_URL`: *Project Settings → API → Project URL*
   - `SUPABASE_SERVICE_ROLE_KEY`: *Project Settings → API → service_role*
   - `WIKI_USER_AGENT`: your contact info (Wikimedia asks API clients to identify themselves)
3. **Install and build.**
   ```bash
   npm install
   npm run build
   ```
4. **Register with Claude Code.**
   ```bash
   claude mcp add education -- node "C:\Users\n\Desktop\Class Files Day\mcp_education\build\index.js"
   ```
   The server finds `.env` relative to its own location, so it works regardless of the directory it's launched from.

Try it: *"Add photosynthesis to my knowledge base, then quiz me on it."*

To debug tools interactively: `npm run inspect` (opens the MCP Inspector).

## Design notes

**Why the MediaWiki API instead of scraping the HTML?**

| | MediaWiki API (used here) | Scraping article HTML |
|---|---|---|
| Stability | Documented, versioned contract | Breaks when Wikipedia changes its markup |
| Cleanup | Plain text returned; citations, nav boxes, edit links already gone | You strip all of that yourself |
| Search, redirects, disambiguation | Built in | You implement each |
| Control over content | Limited to what the API exposes | Total (tables, infoboxes, links) |
| Learning value | HTTP + JSON | HTML parsing, selectors, defensive coding |

Scraping is the right tool when no API exists or you need data the API doesn't expose. When a good API exists, use it.

**Disambiguation.** `add_topic("Mercury")` saves nothing; it returns the page's list of meanings so the agent can retry with `Mercury (planet)`.

**Article size.** The full article is stored, but `get_topic` and the `prepare_*` tools return at most ~30k characters, cut at a section or paragraph boundary. References, External links, See also, and similar sections are dropped on ingest.

**Attribution.** Wikipedia text is licensed CC BY-SA. Every topic stores its source `url`.

## Security

- `.env` is git-ignored. Never commit it or paste the service-role key into chat.
- All tables have RLS enabled with **no policies**, so the public anon key can read and write nothing even if it leaks. Only the service-role key (held locally) can access the data.
- If you later want to expose this beyond yourself, switch to per-user auth with RLS policies and drop the service-role key from the server.

## Project layout

```
src/index.ts            server entry (stdio transport)
src/config.ts           env loading and validation
src/db.ts               Supabase client, topic lookup
src/wikipedia.ts        MediaWiki API client
src/tools/              topics.ts, quiz.ts, flashcards.ts, util.ts
src/ui.ts               registers the quiz view as the ui://education/quiz.html resource
ui/quiz.html, quiz.ts   the interactive quiz view (markup/CSS and logic)
scripts/build-ui.mjs    bundles the view into one self-contained file at build/ui/quiz.html
supabase/schema.sql     database schema
```
