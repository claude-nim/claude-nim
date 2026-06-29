import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  score?: number;
  domain?: string;
}

export type SearchEngine = "duckduckgo" | "brave" | "searxng" | "generic";
export type SearchContextSize = "low" | "medium" | "high";

export interface UserLocation {
  type: "approximate";
  country?: string;
  city?: string;
  region?: string;
  timezone?: string;
}

export interface SearchParams {
  query: string;
  maxResults?: number;
  engines?: SearchEngine[];
  filters?: {
    allowedDomains?: string[];
  };
  contextSize?: SearchContextSize;
  userLocation?: UserLocation;
}

export interface SearchConfig {
  headers?: Record<string, string>;
  timeout?: number;
  maxRetries?: number;
  searxngBaseUrl?: string;
  minTitleLength?: number;
  minSnippetLength?: number;
  maxContextCharacters?: number;
}

export const MAX_RESULTS = 20;
export const MAX_CONTEXT_CHARACTERS = 50_000;

const CONTEXT_SIZE_MAP: Record<SearchContextSize, number> = {
  low: 3,
  medium: 8,
  high: 15,
};

export class SearchError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "TIMEOUT"
      | "HTTP_ERROR"
      | "PARSE_ERROR"
      | "NO_RESULTS"
      | "ALL_ENGINES_FAILED"
      | "INVALID_URL"
      | "INVALID_QUERY",
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SearchError";
  }
}

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  DNT: "1",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
};

const DEFAULT_TIMEOUT = 12_000;
const DEFAULT_MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 400;
const MAX_BACKOFF_MS = 8_000;

const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "ref",
  "source",
];
const NAVIGATION_RE = /^(javascript:|#|mailto:)/i;
const AD_RE = /\/(login|signup|register|cart|checkout|account)/i;

interface SelectorStrategy {
  container: string;
  title: string[];
  url: string[];
  snippet: string[];
}

const SELECTOR_STRATEGIES: SelectorStrategy[] = [
  {
    container: ".result",
    title: [".result__title a", ".result__a", "h2 a", "h3 a"],
    url: [".result__url", ".result__extras__url", "a.result__a"],
    snippet: [".result__snippet", ".result__body", "p"],
  },
  {
    container: '[data-type="web"] .snippet',
    title: [".snippet-title", "h3", "h2"],
    url: ["a.result-header", "cite", ".url"],
    snippet: [".snippet-description", "p.body"],
  },
  {
    container: ".result-default",
    title: ["h3 a", "h4 a", ".result_header a"],
    url: [".url_wrapper a", ".url a", "a"],
    snippet: [".content", "p.content"],
  },
  {
    container: "article, .result, .search-result, li.b_algo",
    title: ["h1 a", "h2 a", "h3 a", "h4 a", "a[href]"],
    url: ["a[href]"],
    snippet: ["p", ".description", ".summary", "span.st"],
  },
  {
    container:
      "div[class*='result'], div[class*='search'], li[class*='result']",
    title: ["a", "h1", "h2", "h3"],
    url: ["a"],
    snippet: ["p", "span", "div[class*='desc']", "div[class*='snippet']"],
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(attempt: number): number {
  const exp = BASE_BACKOFF_MS * 2 ** attempt;
  const jitter = Math.random() * BASE_BACKOFF_MS;
  return Math.min(exp + jitter, MAX_BACKOFF_MS);
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizeUrl(href: string, baseUrl: string): string | null {
  try {
    const url = new URL(href, baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    for (const p of TRACKING_PARAMS) url.searchParams.delete(p);
    if (url.pathname === "") url.pathname = "/";
    return url.toString();
  } catch {
    return null;
  }
}

function firstText($el: cheerio.Cheerio<AnyNode>, selectors: string[]): string {
  for (const sel of selectors) {
    const text = $el.find(sel).first().text().replace(/\s+/g, " ").trim();
    if (text.length > 0) return text;
  }
  return "";
}

function firstHref(
  $el: cheerio.Cheerio<AnyNode>,
  $: cheerio.CheerioAPI,
  selectors: string[],
): string {
  for (const sel of selectors) {
    const href = $el.find(sel).first().attr("href");
    if (href) return href;
  }
  return $el.attr("href") ?? "";
}

function scoreResult(r: SearchResult): number {
  const titleScore = Math.min(r.title.length / 60, 1) * 40;
  const snippetScore = Math.min(r.snippet.length / 160, 1) * 60;
  return titleScore + snippetScore;
}

function isDomainAllowed(url: string, allowedDomains?: string[]): boolean {
  if (!allowedDomains || allowedDomains.length === 0) return true;
  const domain = extractDomain(url);
  return allowedDomains.some((d) => domain === d || domain.endsWith(`.${d}`));
}

function parseHtml(
  html: string,
  maxResults: number,
  baseUrl: string,
  config: SearchConfig,
  filters?: SearchParams["filters"],
): SearchResult[] {
  const minTitle = config.minTitleLength ?? 5;
  const minSnippet = config.minSnippetLength ?? 0;

  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(html);
  } catch (err) {
    throw new SearchError("Failed to parse HTML", "PARSE_ERROR", err);
  }

  $(
    "script, style, noscript, nav, footer, header, iframe, [aria-hidden='true']",
  ).remove();

  const seen = new Set<string>();
  const candidates: SearchResult[] = [];

  for (const strategy of SELECTOR_STRATEGIES) {
    $(strategy.container).each((_, el) => {
      if (candidates.length >= maxResults * 3) return false;
      const $el = $(el);

      const rawHref = firstHref($el, $, strategy.url);
      if (!rawHref) return;

      const url = normalizeUrl(rawHref, baseUrl);
      if (!url) return;

      const urlKey = url.replace(/\/$/, "").toLowerCase();
      if (seen.has(urlKey)) return;
      seen.add(urlKey);

      const title = firstText($el, strategy.title) || url;
      const snippet = firstText($el, strategy.snippet);

      if (title.length < minTitle) return;
      if (snippet.length < minSnippet) return;
      if (NAVIGATION_RE.test(rawHref)) return;
      if (AD_RE.test(url)) return;
      if (!isDomainAllowed(url, filters?.allowedDomains)) return;

      const result: SearchResult = {
        title,
        url,
        snippet,
        domain: extractDomain(url),
      };
      result.score = scoreResult(result);
      candidates.push(result);
    });

    if (candidates.length >= maxResults) break;
  }

  candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return candidates.slice(0, maxResults).map(({ score: _score, ...r }) => r);
}

async function fetchWithRetry(
  url: string,
  config: SearchConfig,
): Promise<string> {
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const timeout = config.timeout ?? DEFAULT_TIMEOUT;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) await sleep(backoffMs(attempt - 1));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        headers: { ...DEFAULT_HEADERS, ...config.headers },
        signal: controller.signal,
        redirect: "follow",
      });

      if (response.status === 429 || response.status === 503) {
        lastError = new SearchError(
          `Rate limited (HTTP ${response.status})`,
          "HTTP_ERROR",
        );
        continue;
      }

      if (!response.ok) {
        throw new SearchError(
          `HTTP ${response.status} from ${url}`,
          "HTTP_ERROR",
        );
      }

      return await response.text();
    } catch (err) {
      if (err instanceof SearchError) throw err;
      if (err instanceof DOMException && err.name === "AbortError") {
        lastError = new SearchError(
          `Request timed out after ${timeout}ms`,
          "TIMEOUT",
          err,
        );
        continue;
      }
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof SearchError
    ? lastError
    : new SearchError(
        `Failed after ${maxRetries} attempts: ${String(lastError)}`,
        "HTTP_ERROR",
        lastError,
      );
}

function buildEngineUrl(
  engine: SearchEngine,
  query: string,
  maxResults: number,
  config: SearchConfig,
  location?: UserLocation,
): string {
  const q = encodeURIComponent(query.trim());
  let url: string;

  switch (engine) {
    case "duckduckgo":
      url = `https://html.duckduckgo.com/html/?q=${q}&kl=us-en&ia=web`;
      break;
    case "brave":
      url = `https://search.brave.com/search?q=${q}&source=web&count=${Math.min(maxResults, 20)}`;
      break;
    case "searxng": {
      const base = (config.searxngBaseUrl ?? "https://searx.be").replace(
        /\/$/,
        "",
      );
      url = `${base}/search?q=${q}&format=html&language=en&engines=google,bing,duckduckgo&pageno=1`;
      break;
    }
    case "generic":
      url = `https://www.mojeek.com/search?q=${q}&fmt=html&results=${Math.min(maxResults, 10)}`;
      break;
  }

  if (location?.country) {
    const separator = url.includes("?") ? "&" : "?";
    url += `${separator}kl=${location.country.toLowerCase()}-en`;
  }

  return url;
}

export async function scrapeSearchPage(
  url: string,
  maxResults = 5,
  config: SearchConfig = {},
  filters?: SearchParams["filters"],
): Promise<SearchResult[]> {
  try {
    new URL(url);
  } catch {
    throw new SearchError(`Invalid URL: ${url}`, "INVALID_URL");
  }

  const html = await fetchWithRetry(url, config);
  const results = parseHtml(html, maxResults, url, config, filters);

  if (results.length === 0) {
    throw new SearchError("No results found on the page", "NO_RESULTS");
  }

  return results;
}

export async function search(
  params: SearchParams | string,
  maxResultsOrConfig: number | SearchConfig = 5,
  configOrFilters: SearchConfig | SearchParams["filters"] = {},
): Promise<SearchResult[]> {
  const paramsObj: SearchParams =
    typeof params === "string"
      ? {
          query: params,
          maxResults:
            typeof maxResultsOrConfig === "number" ? maxResultsOrConfig : 8,
        }
      : params;

  const config: SearchConfig =
    typeof maxResultsOrConfig === "object"
      ? maxResultsOrConfig
      : typeof configOrFilters === "object" &&
          !Array.isArray(configOrFilters) &&
          "timeout" in configOrFilters
        ? (configOrFilters as SearchConfig)
        : {};

  const filters =
    typeof configOrFilters === "object" &&
    !Array.isArray(configOrFilters) &&
    "allowedDomains" in configOrFilters
      ? (configOrFilters as SearchParams["filters"])
      : typeof maxResultsOrConfig === "object"
        ? (maxResultsOrConfig as SearchParams).filters
        : paramsObj.filters;

  const query = paramsObj.query;
  const maxResults =
    paramsObj.maxResults ??
    (paramsObj.contextSize
      ? CONTEXT_SIZE_MAP[paramsObj.contextSize]
      : typeof maxResultsOrConfig === "number"
        ? maxResultsOrConfig
        : 8);

  if (!query || query.trim().length < 2) {
    throw new SearchError(
      "Query must be at least 2 characters",
      "INVALID_QUERY",
    );
  }

  const effectiveMax = Math.min(maxResults, MAX_RESULTS);
  const engines = paramsObj.engines ?? ["duckduckgo", "brave", "generic"];
  const errors: Array<{ engine: SearchEngine; error: unknown }> = [];

  for (const engine of engines) {
    const url = buildEngineUrl(
      engine,
      query,
      effectiveMax,
      config,
      paramsObj.userLocation,
    );
    try {
      const results = await scrapeSearchPage(
        url,
        effectiveMax,
        config,
        filters,
      );
      if (results.length > 0) return results;
    } catch (err) {
      errors.push({ engine, error: err });
    }
  }

  const summary = errors
    .map(({ engine, error }) => `${engine}: ${String(error)}`)
    .join("; ");
  throw new SearchError(
    `All engines failed. Errors: ${summary}`,
    "ALL_ENGINES_FAILED",
  );
}

export function formatResultsAsContext(
  results: SearchResult[],
  maxCharacters?: number,
): string {
  const limit = maxCharacters ?? MAX_CONTEXT_CHARACTERS;
  const parts: string[] = [];
  let totalLength = 0;

  for (const r of results) {
    const entry = `[${r.title}](${r.url})\n${r.snippet}`;
    if (totalLength + entry.length + 2 > limit) break;
    parts.push(entry);
    totalLength += entry.length + 2;
  }

  return parts.join("\n\n");
}
