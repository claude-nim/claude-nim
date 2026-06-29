import {
  search,
  formatResultsAsContext,
  type SearchResult,
  type SearchParams,
  type SearchConfig,
} from "./web-search";

export interface WebSearchConfig {
  fallback?: SearchConfig;
}

export interface WebSearchResult {
  results: SearchResult[];
  source: string;
  context: string;
}

export async function webSearchTool(
  params: SearchParams,
  config: WebSearchConfig = {},
): Promise<WebSearchResult> {
  const results = await search(params, config.fallback ?? {});
  const context = formatResultsAsContext(results);

  return {
    results,
    source: "fallback",
    context,
  };
}

export { formatResultsAsContext };
export type { SearchResult, SearchParams, SearchConfig };
