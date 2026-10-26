import { getConfig } from "./config";

const API_URL = "https://en.wikipedia.org/w/api.php";

// Sections that add noise but no study value.
const BOILERPLATE_SECTIONS = new Set([
  "references",
  "external links",
  "see also",
  "further reading",
  "notes",
  "bibliography",
  "sources",
  "citations",
  "footnotes",
]);

export interface SearchHit {
  title: string;
  snippet: string;
  pageId: number;
}

export type ArticleResult =
  | {
      kind: "article";
      title: string;
      url: string;
      pageId: number;
      summary: string;
      content: string;
    }
  | { kind: "disambiguation"; title: string; options: string }
  | { kind: "missing" };

async function wikiGet(params: Record<string, string>): Promise<any> {
  const url = new URL(API_URL);
  const search = new URLSearchParams({ format: "json", formatversion: "2", ...params });
  url.search = search.toString();

  const { wikiUserAgent } = getConfig();
  const res = await fetch(url, {
    headers: { "User-Agent": wikiUserAgent, "Api-User-Agent": wikiUserAgent },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Wikipedia API returned HTTP ${res.status} ${res.statusText}`);
  }
  const body = await res.json();
  if (body.error) {
    throw new Error(`Wikipedia API error: ${body.error.info ?? body.error.code}`);
  }
  return body;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#0?39;/g, "'")
    .trim();
}

export async function searchWikipedia(query: string, limit = 5): Promise<SearchHit[]> {
  const body = await wikiGet({
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: String(limit),
    srprop: "snippet",
  });
  return (body.query?.search ?? []).map((r: any) => ({
    title: r.title,
    snippet: stripHtml(r.snippet ?? ""),
    pageId: r.pageid,
  }));
}

/** Drop References / External links / etc. and collapse blank lines. */
function cleanExtract(extract: string): string {
  const keep: string[] = [];
  let skipping = false;
  for (const line of extract.split("\n")) {
    // Only top-level headings ("== X ==", not "=== X ===") start or end a section.
    const top = line.match(/^==\s*([^=].*?)\s*==\s*$/);
    if (top) skipping = BOILERPLATE_SECTIONS.has(top[1].toLowerCase());
    if (!skipping) keep.push(line);
  }
  return keep.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Fetch one article by exact title (redirects followed). */
export async function fetchArticle(title: string): Promise<ArticleResult> {
  const body = await wikiGet({
    action: "query",
    titles: title,
    redirects: "1",
    prop: "extracts|info|pageprops",
    explaintext: "1",
    inprop: "url",
    ppprop: "disambiguation",
  });

  const page = body.query?.pages?.[0];
  if (!page || page.missing || page.invalid) return { kind: "missing" };

  if (page.pageprops && "disambiguation" in page.pageprops) {
    // The page's own text lists each meaning with a description, which is far more
    // useful for choosing than a bare list of linked titles.
    const options = cleanExtract(page.extract ?? "").slice(0, 4000);
    return { kind: "disambiguation", title: page.title, options };
  }

  const content = cleanExtract(page.extract ?? "");
  if (!content) return { kind: "missing" };

  const firstSection = content.search(/^==/m);
  const summary = (firstSection === -1 ? content : content.slice(0, firstSection)).trim();

  return {
    kind: "article",
    title: page.title,
    url: page.fullurl,
    pageId: page.pageid,
    summary,
    content,
  };
}

export type ResolveResult =
  | { kind: "article"; article: Extract<ArticleResult, { kind: "article" }>; via: "exact" | "search" }
  | { kind: "disambiguation"; title: string; options: string }
  | { kind: "not_found" };

/**
 * Turn free text into an article: try it as an exact title first, then fall back
 * to the top search hit.
 */
export async function resolveArticle(query: string): Promise<ResolveResult> {
  const direct = await fetchArticle(query);
  if (direct.kind === "article") return { kind: "article", article: direct, via: "exact" };
  if (direct.kind === "disambiguation") return direct;

  const [top] = await searchWikipedia(query, 1);
  if (!top) return { kind: "not_found" };

  const viaSearch = await fetchArticle(top.title);
  if (viaSearch.kind === "article") return { kind: "article", article: viaSearch, via: "search" };
  if (viaSearch.kind === "disambiguation") return viaSearch;
  return { kind: "not_found" };
}
