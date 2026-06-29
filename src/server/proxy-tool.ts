// ── Proxy-side tool execution ───────────────────────────────────────────
//
// The proxy intercepts certain tool calls (e.g. web_search) so the LLM
// never sees raw search HTML — it gets formatted context instead.

import { webSearchTool } from "./web-search-tool";
import { logError } from "./logger";

// ── Tool definitions (Anthropic format) ────────────────────────────────

export const WEB_SEARCH_TOOL = {
  name: "web_search",
  description:
    "Search the web for current information on a topic. " +
    "Returns search results with titles, URLs, and snippets.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "The search query to find information about",
      },
    },
    required: ["query"],
  },
};

export const PROXY_TOOLS = [WEB_SEARCH_TOOL] as const;

// ── Tool injection ─────────────────────────────────────────────────────

export function injectProxyTools(body: Record<string, unknown>): void {
  const raw = body.tools;
  const existingTools = (Array.isArray(raw) ? raw : []) as Array<{
    name: string;
  }>;
  for (const t of PROXY_TOOLS) {
    if (!existingTools.some((e) => e.name === t.name)) {
      existingTools.push(t);
    }
  }
  if (!Array.isArray(raw)) {
    body.tools = existingTools;
  }
}

// ── Tool result interception ───────────────────────────────────────────
//
// Scans the Anthropic-format messages for tool_result blocks whose
// tool_use_id corresponds to a proxy tool call, executes them locally,
// and replaces the content with the real result.

interface ToolCallInfo {
  name: string;
  input: Record<string, unknown>;
}

function collectToolCallIds(
  messages: Array<Record<string, unknown>>,
): Map<string, ToolCallInfo> {
  const map = new Map<string, ToolCallInfo>();
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;

    // Anthropic format: content array with type: "tool_use" blocks
    if (Array.isArray(msg.content)) {
      for (const block of msg.content as Array<Record<string, unknown>>) {
        if (block.type === "tool_use" && typeof block.id === "string") {
          map.set(block.id, {
            name: String(block.name ?? ""),
            input:
              block.input && typeof block.input === "object"
                ? (block.input as Record<string, unknown>)
                : {},
          });
        }
      }
    }

    // OpenAI format: tool_calls array (in case body was partially converted)
    if (Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls as Array<Record<string, unknown>>) {
        if (typeof tc.id === "string") {
          const fn = tc.function as Record<string, unknown> | undefined;
          let input: Record<string, unknown> = {};
          if (fn && typeof fn.arguments === "string") {
            try {
              input = JSON.parse(fn.arguments) as Record<string, unknown>;
            } catch {
              // malformed — leave empty
            }
          }
          map.set(tc.id, {
            name: String(fn?.name ?? ""),
            input,
          });
        }
      }
    }
  }
  return map;
}

function isProxyTool(name: string): boolean {
  return PROXY_TOOLS.some((t) => t.name === name);
}

async function executeProxyTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  if (name === "web_search") {
    const query = String(input.query ?? "");
    if (!query) return "Error: no search query provided";
    try {
      const result = await webSearchTool({ query, maxResults: 5 });
      return result.context;
    } catch (err) {
      logError("web_search", err);
      return `Search failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return `Unknown proxy tool: ${name}`;
}

export async function interceptProxyToolResults(
  body: Record<string, unknown>,
): Promise<void> {
  const messages = body.messages as Array<Record<string, unknown>> | undefined;
  if (!messages) return;

  // Quick skip: no tool_result blocks in any user message
  if (
    !messages.some(
      (m) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        (m.content as Array<Record<string, unknown>>).some(
          (b) => b.type === "tool_result",
        ),
    )
  )
    return;

  const toolCallMap = collectToolCallIds(messages);
  if (toolCallMap.size === 0) return;

  let anyIntercepted = false;

  for (const msg of messages) {
    if (msg.role !== "user" || !Array.isArray(msg.content)) continue;

    const blocks = msg.content as Array<Record<string, unknown>>;
    for (const block of blocks) {
      if (block.type !== "tool_result") continue;

      const toolUseId = String(block.tool_use_id ?? "");
      const info = toolCallMap.get(toolUseId);
      if (!info || !isProxyTool(info.name)) continue;

      const result = await executeProxyTool(info.name, info.input);

      // Replace content — may be string or array of content blocks
      if (typeof block.content === "string" || !block.content) {
        block.content = result;
      } else if (Array.isArray(block.content)) {
        block.content = [{ type: "text", text: result }];
      }

      anyIntercepted = true;
    }
  }

  if (anyIntercepted) {
    // Strip proxy tools from the tools list so NIM doesn't see them —
    // the results are already injected.
    body.tools = ((body.tools ?? []) as Array<{ name: string }>).filter(
      (t) => !isProxyTool(t.name),
    );
    if ((body.tools as Array<unknown>).length === 0) {
      delete body.tools;
    }
  }
}
