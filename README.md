# mcp-education

A personal study tool, delivered as an [MCP](https://modelcontextprotocol.io) server. Give it a topic and it pulls the Wikipedia article into a Supabase (Postgres) knowledge base. Then ask your AI agent for quizzes and flashcards on anything in that knowledge base, and they're saved for reuse.

It runs two ways from the same code:

- **Locally over stdio**, launched by your MCP client (Claude Code, the Inspector). No auth; it's your machine.
- **Deployed on Vercel over HTTP**, so any MCP client (claude.ai, Claude desktop, Cursor, …) can connect. Protected by **OAuth** (Supabase Auth) and restricted to a single owner.

> **Personal use only.** The server talks to Supabase with the **service-role key**, which bypasses Row Level Security. The deployed server is locked to one Supabase user (you); see [Security](#security) before exposing it.

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

The view is a single self-contained HTML file (`ui/quiz.html` + `ui/quiz.ts`), bundled with esbuild together with the MCP Apps client SDK. `npm run build:ui` writes it into the generated module `src/generated/quiz-html.ts` (git-ignored), which the server imports, so it ships inside serverless bundles instead of being read from disk. The server registers it as the resource `ui://education/quiz.html`, and `save_quiz` and `get_quiz` point at it with `_meta.ui.resourceUri`. The host fetches the resource, renders it in a sandboxed iframe, and passes the quiz in as the tool result. Re-run `npm run build:ui` after editing anything under `ui/` (`npm run build`, `dev` and `test` all do).

## Run it locally (stdio)

Requires Node 20+ and a free [Supabase](https://supabase.com) project.

1. **Create the tables.** In the Supabase dashboard open *SQL Editor*, paste the contents of [`supabase/schema.sql`](supabase/schema.sql), and run it.
2. **Configure credentials.** Copy `.env.example` to `.env` and fill in `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `WIKI_USER_AGENT` (your contact info; Wikimedia asks API clients to identify themselves). The OAuth and `NEXT_PUBLIC_*` values are only needed for the deployed server.
3. **Install and build.**
   ```bash
   npm install
   npm run build:stdio
   ```
4. **Register with Claude Code** (this repo already includes a project-level `.mcp.json` that does the same):
   ```bash
   claude mcp add education -- node "C:\path\to\mcp_education\build\index.js"
   ```
   The server finds `.env` relative to its own location, so it works regardless of the directory it's launched from.

Try it: *"Add photosynthesis to my knowledge base, then quiz me on it."* Debug tools interactively with `npm run inspect`.

## Deploy to Vercel (HTTP + OAuth)

```
Client ──OAuth (PKCE, dynamic registration)──▶ Supabase Auth ──▶ /login → /oauth/consent  (this app)
   │  Bearer token
   ▼
/api/mcp ── verify JWT (Supabase JWKS, issuer, audience, sub == OWNER_USER_ID) ──▶ tools ──▶ Supabase
/.well-known/oauth-protected-resource   (tells clients Supabase is the authorization server)
```

The deployed server is a small Next.js app (`app/`) wrapping the same tools through [`mcp-handler`](https://github.com/vercel/mcp-handler) on the MCP SDK v2. Supabase Auth's OAuth 2.1 server issues the tokens; the app supplies the login and consent screens and refuses every token that isn't the owner's.

### 1. Supabase (dashboard)

1. **Create your user:** *Authentication → Users → Add user* (email + password). Copy their **UUID**; this is `OWNER_USER_ID`.
2. **Disable sign-ups:** *Authentication → Sign In / Providers* → turn off "Allow new users to sign up".
3. **JWT signing keys:** *Authentication → JWT Signing Keys* must use an asymmetric key (ES256/RS256). New projects normally do; if yours still uses the legacy HS256 secret, migrate.
4. **OAuth server:** *Authentication → OAuth Server* → enable it, set the **Authorization Path** to `/oauth/consent`, and enable **dynamic client registration** (Claude Code uses random loopback ports, so pre-registering every client isn't practical; each client still needs *your* approval on the consent screen).
5. **Site URL:** *Authentication → URL Configuration* → your production URL (e.g. `https://my-app.vercel.app`). Supabase sends the user to `<Site URL>/oauth/consent`.
6. Note the **publishable (anon) key** for `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

> The OAuth server is a **beta** Supabase feature, and users who sign in through it count toward your monthly active users.

### 2. Vercel

Import the GitHub repo (framework preset: Next.js; the default `npm run build` works), then set these environment variables:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role key, mark **Sensitive** |
| `WIKI_USER_AGENT` | `mcp-education/0.2 (personal study tool; contact: you@example.com)` |
| `OWNER_USER_ID` | the UUID from step 1.1 |
| `APP_URL` | the production origin, no trailing slash |
| `NEXT_PUBLIC_SUPABASE_URL` | same as `SUPABASE_URL` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | publishable key (public by design) |

Choose a function region near your Supabase region. Make sure Vercel *Deployment Protection* doesn't block `/api/mcp` or `/.well-known/*` on the domain you use; OAuth clients need to reach them without a Vercel login. If `OWNER_USER_ID` or `APP_URL` is missing the server **refuses every request** and logs the cause.

### 3. Connect a client

- **Claude Code:**
  ```bash
  claude mcp add --transport http education https://<your-app>/api/mcp
  ```
  then run `/mcp` and authenticate: your browser opens the login and consent pages.
- **claude.ai / Claude desktop:** *Settings → Connectors → Add custom connector* with the URL `https://<your-app>/api/mcp`.
- **Cursor and others:** add the same URL as a remote (Streamable HTTP) server.

Local development against the HTTP route: put the variables in `.env.local` (with `APP_URL=http://localhost:3000`) and run `npm run dev`.

## Testing

```bash
npm test          # builds the quiz view, then runs the auth and HTTP tests
npm run typecheck
```

`test/auth.test.ts` covers token verification (valid owner, wrong user/issuer/audience, expired, forged, tampered, wrong algorithm). `test/http.test.ts` drives the real handler stack with locally signed tokens: 401 challenges, tool and resource listing, the quiz view resource, and argument validation. Neither needs the network or a database.

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

- **Owner-only.** A Supabase access token has the audience `authenticated` for *every* user of the project, so a valid signature alone proves nothing. The server also requires `sub == OWNER_USER_ID`, restricts algorithms to ES256/RS256, and checks issuer, audience and expiry. Anything else gets a plain 401.
- **Fails closed.** Missing `OWNER_USER_ID`/`APP_URL` means nothing is accepted.
- **Secrets.** `.env` and `.env*.local` are git-ignored. The service-role key lives only in server-side env vars and never reaches the browser; the login/consent pages use the publishable key. Never paste keys into chat.
- **RLS.** All tables have RLS enabled with **no policies**, so the public anon key can read and write nothing even if it leaks.
- **Consent.** Dynamic registration lets any MCP client *ask* for access, but nothing is granted until you approve it on the consent screen, and the resulting token only works for your user id. Review *Authentication → OAuth Apps* now and then and remove clients you don't recognise.
- **Hardening for later.** Query Supabase with the caller's own token plus an owner-only RLS policy instead of the service-role key, which would keep that key off Vercel entirely. For several users you'd also need per-user rows (`user_id` columns) and a sign-up flow.

## Project layout

```
app/api/mcp/route.ts                           remote MCP endpoint (mcp-handler + owner-only auth)
app/.well-known/oauth-protected-resource/      OAuth discovery metadata
app/login, app/oauth/consent                   sign-in and consent pages (Supabase OAuth server)
src/server.ts                                  registerAll / createServer, shared by both entries
src/stdio.ts                                   local stdio entry (bundled to build/index.js)
src/auth.ts                                    owner-only token verification
src/config.ts                                  lazy env config
src/db.ts, src/wikipedia.ts                    Supabase client, MediaWiki API client
src/tools/                                     topics.ts, quiz.ts, flashcards.ts, util.ts
src/ui.ts                                      registers the quiz view as ui://education/quiz.html
ui/quiz.html, ui/quiz.ts                       the interactive quiz view
scripts/build-ui.mjs, scripts/build-stdio.mjs  bundle the view / the stdio entry
supabase/schema.sql                            database schema
test/                                          auth and HTTP tests
```
