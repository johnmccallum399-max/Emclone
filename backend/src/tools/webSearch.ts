import { env } from "../config/env.js";
import type { ToolDefinition } from "./types.js";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function searchWithTavily(query: string): Promise<SearchResult[]> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: env.TAVILY_API_KEY,
      query,
      max_results: 5,
      include_answer: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily search failed with status ${response.status}`);
  }

  const data = (await response.json()) as { results?: Array<{ title: string; url: string; content: string }> };
  return (data.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content }));
}

/**
 * Free fallback search using DuckDuckGo's HTML endpoint (no API key required).
 * Parses the lightweight server-rendered HTML with regular expressions.
 */
async function searchWithDuckDuckGo(query: string): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; PersonalAIAssistant/1.0)" },
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo search failed with status ${response.status}`);
  }

  const html = await response.text();
  const results: SearchResult[] = [];

  const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

  const links: { url: string; title: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null && links.length < 5) {
    links.push({ url: decodeDuckDuckGoUrl(match[1]), title: stripHtml(match[2]) });
  }

  const snippets: string[] = [];
  while ((match = snippetRegex.exec(html)) !== null && snippets.length < 5) {
    snippets.push(stripHtml(match[1]));
  }

  for (let i = 0; i < links.length; i++) {
    results.push({ title: links[i].title, url: links[i].url, snippet: snippets[i] ?? "" });
  }

  return results;
}

function decodeDuckDuckGoUrl(href: string): string {
  try {
    const url = new URL(href, "https://duckduckgo.com");
    const redirected = url.searchParams.get("uddg");
    return redirected ? decodeURIComponent(redirected) : href;
  } catch {
    return href;
  }
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export const webSearchTool: ToolDefinition = {
  name: "web_search",
  description:
    "Search the web for current information (news, facts, prices, documentation, etc.) and " +
    "return a short list of relevant results with titles, URLs, and snippets. Use this " +
    "whenever the user asks about something that may have changed since your training data, " +
    "or that you are not confident about.",
  permission: "web_access",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query." },
    },
    required: ["query"],
    additionalProperties: false,
  },
  async execute(args) {
    const query = String(args.query ?? "").trim();
    if (!query) return "Error: 'query' is required.";

    try {
      const results = env.TAVILY_API_KEY
        ? await searchWithTavily(query)
        : await searchWithDuckDuckGo(query);

      if (results.length === 0) return "No results found.";

      return results
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
        .join("\n\n");
    } catch (err) {
      return `Error: web search failed (${(err as Error).message}).`;
    }
  },
};
