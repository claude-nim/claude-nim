// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
// ============================================================================
// Anthropic ↔ OpenAI format translator
// Zero dependencies — pure TypeScript translation layer
// ============================================================================

import { getModelAdapter } from "./adapters/index";
import {
  OcGoChatMessage,
  OcGoChatRequest,
  OcGoTool,
  OcGoToolCall,
  JsonObject,
  OcGoContentPart,
} from "./types";
import {
  AnthropicMessage,
  AnthropicMessagesRequest,
  AnthropicTool,
  AnthropicToolResultContent,
  AnthropicToolUseContent,
} from "./anthropic-types";

// ============================================================================
// Request: Anthropic → OpenAI (incoming Claude Code request → NIM)
// ============================================================================
// Request: Anthropic → OpenAI (incoming Claude Code request → NIM)
// ============================================================================

export function sanitizeString(text: string): string {
  return text.replace(/\uFFFD/g, "");
}

export function scrubPromptInjection(text: string): string {
  return text
    .replace(/ignore\s+(all\s+)?previous\s+instructions/gi, "[REDACTED]")
    .replace(/you\s+are\s+now\s+/gi, "you were asked to be ");
}

export function pruneContext(messages: OcGoChatMessage[]): OcGoChatMessage[] {
  const MAX_CHARS = 100_000;
  let totalChars = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      totalChars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "text" && block.text)
          totalChars += block.text.length;
      }
    }
  }

  if (totalChars <= MAX_CHARS) return messages;

  const result = JSON.parse(JSON.stringify(messages)) as OcGoChatMessage[];
  const PROTECTED_BOUNDARY = Math.max(0, result.length - 3);

  for (let i = 0; i < PROTECTED_BOUNDARY; i++) {
    if (totalChars <= MAX_CHARS) break;
    const msg = result[i];
    if (msg.role !== "tool") continue;

    if (typeof msg.content === "string" && msg.content.length > 500) {
      const charsBefore = msg.content.length;
      msg.content = `[Trimmed by Proxy Context Pruner: Original size ${charsBefore} chars]`;
      totalChars -= charsBefore - msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (let j = 0; j < msg.content.length; j++) {
        const block = msg.content[j];
        if (block.type === "text" && block.text && block.text.length > 500) {
          const charsBefore = block.text.length;
          block.text = `[Trimmed by Proxy Context Pruner: Original size ${charsBefore} chars]`;
          totalChars -= charsBefore - block.text.length;
        }
      }
    }
  }

  return result;
}

function convertAnthropicMessages(
  messages: AnthropicMessage[],
): OcGoChatMessage[] {
  const result: OcGoChatMessage[] = [];

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      let txt = msg.content;
      if (msg.role === "user") txt = scrubPromptInjection(txt);
      result.push({ role: msg.role, content: txt });
      continue;
    }

    // Group content blocks by type
    const textParts: string[] = [];
    const toolUses: AnthropicToolUseContent[] = [];
    const toolResults: AnthropicToolResultContent[] = [];
    const imageParts: { mimeType: string; data: string }[] = [];

    for (const block of msg.content) {
      switch (block.type) {
        case "text":
          textParts.push(block.text);
          break;
        case "tool_use":
          toolUses.push(block);
          break;
        case "tool_result":
          toolResults.push(block);
          break;
        case "image":
          imageParts.push({
            mimeType: block.source.media_type,
            data: block.source.data,
          });
          break;
      }
    }

    // Assistant message with tool calls
    if (msg.role === "assistant" && toolUses.length > 0) {
      const toolCalls: OcGoToolCall[] = toolUses.map((tu) => ({
        id: tu.id,
        type: "function" as const,
        function: {
          name: tu.name,
          arguments: JSON.stringify(tu.input ?? {}),
        },
      }));

      result.push({
        role: "assistant",
        content: textParts.join("\n") || "",
        tool_calls: toolCalls,
      });
      continue;
    }

    // User message with tool results
    if (toolResults.length > 0) {
      // First, emit any text content as a user message
      if (textParts.length > 0) {
        let txt = textParts.join("\n");
        txt = scrubPromptInjection(txt);
        result.push({ role: "user", content: txt });
      }

      // Then emit each tool result as a separate tool message
      for (const tr of toolResults) {
        let content: string | import("./types").OcGoContentPart[] = "";
        if (typeof tr.content === "string") {
          content = sanitizeString(tr.content);
        } else if (Array.isArray(tr.content)) {
          const parts: import("./types").OcGoContentPart[] = [];
          for (const block of tr.content) {
            if (block.type === "text" && block.text) {
              parts.push({ type: "text", text: sanitizeString(block.text) });
            } else if (block.type === "image" && block.source) {
              parts.push({
                type: "image_url",
                image_url: {
                  url: `data:${block.source.media_type};base64,${block.source.data}`,
                },
              });
            }
          }
          if (parts.some((p) => p.type === "image_url")) {
            content = parts;
          } else {
            content = parts.map((p) => p.text).join("\n");
          }
        }

        if (tr.is_error) {
          if (typeof content === "string") {
            content = `[ERROR] ${content}`;
          } else {
            content.unshift({ type: "text", text: "[ERROR] " });
          }
        }

        result.push({
          role: "tool",
          tool_call_id: tr.tool_use_id,
          content: content || "(empty result)",
        });
      }
      continue;
    }

    // Regular message with possible images
    if (imageParts.length > 0) {
      const contentParts: Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      > = [];
      if (textParts.length > 0) {
        let txt = textParts.join("\n");
        if (msg.role === "user") txt = scrubPromptInjection(txt);
        contentParts.push({ type: "text", text: txt });
      }
      for (const img of imageParts) {
        contentParts.push({
          type: "image_url",
          image_url: { url: `data:${img.mimeType};base64,${img.data}` },
        });
      }
      result.push({
        role: msg.role,
        content: contentParts as OcGoContentPart[],
      });
    } else {
      let txt = textParts.join("\n");
      if (msg.role === "user") txt = scrubPromptInjection(txt);
      result.push({
        role: msg.role,
        content: txt || "(empty message)",
      });
    }
  }

  return result;
}

function convertAnthropicTools(
  tools?: AnthropicTool[],
): OcGoTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;

  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: (tool.input_schema ?? { type: "object" }) as JsonObject,
    },
  }));
}

function convertToolChoice(
  toolChoice?: AnthropicMessagesRequest["tool_choice"],
): OcGoChatRequest["tool_choice"] {
  if (!toolChoice) return undefined;

  switch (toolChoice.type) {
    case "auto":
      return "auto";
    case "any":
      return "required";
    case "tool":
      return toolChoice.name
        ? { type: "function", function: { name: toolChoice.name } }
        : "auto";
    default:
      return "auto";
  }
}

/**
 * Convert an incoming Anthropic Messages API request into an OpenAI-compatible
 * request body for NVIDIA NIM.
 */
export function translateRequest(
  req: AnthropicMessagesRequest,
): OcGoChatRequest {
  const adapter = getModelAdapter(req.model);
  const profile = adapter.getProfile({ toolsEnabled: !!req.tools?.length });

  const messages = convertAnthropicMessages(req.messages);

  // Inject system message
  const systemText =
    typeof req.system === "string"
      ? req.system
      : Array.isArray(req.system)
        ? req.system.map((s) => s.text).join("\n")
        : undefined;

  if (systemText) {
    messages.unshift({ role: "system", content: systemText });
  }

  // Inject adapter-specific extra system messages
  for (const extra of profile.extraSystemMessages) {
    messages.push({ role: "system", content: extra });
  }

  // Apply adapter-specific message workarounds
  let finalMessages = adapter.applyMessagesWorkaround
    ? adapter.applyMessagesWorkaround(messages)
    : messages;

  finalMessages = pruneContext(finalMessages);

  const tools = convertAnthropicTools(req.tools);

  const result: OcGoChatRequest = {
    model: req.model,
    messages: finalMessages,
    max_tokens: req.max_tokens,
    temperature:
      req.temperature ??
      (tools ? profile.toolTemperature : profile.defaultTemperature),
    stream: req.stream ?? true,
    tools,
    tool_choice: tools ? convertToolChoice(req.tool_choice) : undefined,
  };

  if (req.top_p !== undefined) result.top_p = req.top_p;
  if (req.stop_sequences) result.stop = req.stop_sequences;

  return result;
}

// ============================================================================
// Response: OpenAI SSE → Anthropic SSE (NIM stream → Claude Code)
// ============================================================================

let messageCounter = 0;

function generateMessageId(): string {
  return `msg_nim_${Date.now().toString(36)}_${(messageCounter++).toString(36)}`;
}

/**
 * Build the Anthropic `message_start` event from the first OpenAI chunk.
 */
export function buildMessageStart(
  model: string,
  inputTokens: number = 0,
): string {
  const event = {
    type: "message_start",
    message: {
      id: generateMessageId(),
      type: "message",
      role: "assistant",
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: inputTokens,
        output_tokens: 0,
      },
    },
  };
  return `event: message_start\ndata: ${JSON.stringify(event)}\n\n`;
}

export function buildContentBlockStart(
  index: number,
  type: "text" | "tool_use",
  toolUse?: { id: string; name: string },
): string {
  let block: unknown;
  if (type === "text") {
    block = { type: "text", text: "" };
  } else {
    block = {
      type: "tool_use",
      id: toolUse!.id,
      name: toolUse!.name,
      input: {},
    };
  }

  const event = {
    type: "content_block_start",
    index,
    content_block: block,
  };
  return `event: content_block_start\ndata: ${JSON.stringify(event)}\n\n`;
}

export function buildTextDelta(index: number, text: string): string {
  const event = {
    type: "content_block_delta",
    index,
    delta: { type: "text_delta", text },
  };
  return `event: content_block_delta\ndata: ${JSON.stringify(event)}\n\n`;
}

export function buildToolInputDelta(
  index: number,
  partialJson: string,
): string {
  const event = {
    type: "content_block_delta",
    index,
    delta: { type: "input_json_delta", partial_json: partialJson },
  };
  return `event: content_block_delta\ndata: ${JSON.stringify(event)}\n\n`;
}

export function buildContentBlockStop(index: number): string {
  const event = { type: "content_block_stop", index };
  return `event: content_block_stop\ndata: ${JSON.stringify(event)}\n\n`;
}

export function buildMessageDelta(
  stopReason: "end_turn" | "max_tokens" | "tool_use" | "stop_sequence",
  outputTokens: number,
): string {
  const event = {
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: outputTokens },
  };
  return `event: message_delta\ndata: ${JSON.stringify(event)}\n\n`;
}

export function buildMessageStop(): string {
  return `event: message_stop\ndata: {"type":"message_stop"}\n\n`;
}

export function buildPing(): string {
  return `event: ping\ndata: {"type":"ping"}\n\n`;
}

/**
 * Map OpenAI finish_reason to Anthropic stop_reason.
 */
export function mapStopReason(
  finishReason: string | null,
  hasToolCalls: boolean,
): "end_turn" | "max_tokens" | "tool_use" | "stop_sequence" {
  if (hasToolCalls) return "tool_use";
  switch (finishReason) {
    case "length":
      return "max_tokens";
    case "stop":
      return "end_turn";
    case "tool_calls":
      return "tool_use";
    default:
      return "end_turn";
  }
}

/**
 * Rough token estimation for input (used for usage reporting).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
