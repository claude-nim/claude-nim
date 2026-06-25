// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details

import * as http from "node:http";
import * as vscode from "vscode";
import { streamChatCompletion } from "../api";
import { getCurrentModel } from "../model-switch";
import { debugLog } from "../output-channel";
import { translateRequest, mapStopReason, estimateTokens } from "../translator";
import { repairToolArguments } from "../tool-validator";
import { parseTextEmbeddedToolCalls } from "../tool-parser";
import { jsonrepair } from "jsonrepair";
import { recordMetric } from "../dashboard";
import type { AnthropicMessagesRequest } from "../anthropic-types";
import { sendJson, sendError } from "./http-helpers";
import { ReasoningStripper } from "./reasoning-stripper";
import { state } from "./proxy-state";
import { generateId } from "../constants";

/**
 * Handle a non-streaming /v1/messages request.
 * Internally still streams from NIM to collect the full response,
 * then assembles and returns a single JSON message.
 */
export async function handleMessagesNonStream(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  body: AnthropicMessagesRequest,
  apiKey: string,
  defaultModel?: string,
): Promise<void> {
  // Priority: getCurrentModel() (set via menu or /model) > defaultModel > body.model
  const overrideModel = getCurrentModel() || defaultModel || "";
  if (overrideModel) {
    body.model = overrideModel;
  } else if (body.model === "NVIDIA-NIM-Proxy") {
    body.model = "";
  }

  if (!body.model) {
    sendError(res, 400, "invalid_request_error", "model is required");
    return;
  }

  // Reject known Claude model names with a helpful error
  if (body.model.startsWith("claude-")) {
    sendError(
      res,
      400,
      "invalid_request_error",
      "No default NIM model configured. Use 'Select Default Model' in VS Code, " +
        "start the proxy with --model <name>, or use /model <name> in chat.",
    );
    return;
  }

  if (!body.model) {
    sendError(res, 400, "invalid_request_error", "model is required");
    return;
  }

  // Reject known Claude model names with a helpful error
  if (body.model.startsWith("claude-")) {
    sendError(
      res,
      400,
      "invalid_request_error",
      "No default NIM model configured. Use 'Select Default Model' in VS Code, " +
        "start the proxy with --model <name>, or use /model <name> in chat.",
    );
    return;
  }

  const requestModel = body.model;
  debugLog(
    "proxy",
    `→ ${requestModel} (non-stream, max_tokens=${body.max_tokens})`,
  );

  const openaiRequest = translateRequest(body);
  openaiRequest.stream = true;

  const metricStart = Date.now();
  const metricId = generateId();

  const contentBlocks: unknown[] = [];
  let textContent = "";
  const stripper = new ReasoningStripper();
  const toolCalls: Array<{ id: string; name: string; argsParts: string[] }> =
    [];
  let outputTokens = 0;
  let lastFinishReason: string | null = null;
  let timeToFirstTokenMs = 0;
  let firstChunkReceived = false;

  try {
    for await (const chunk of streamChatCompletion(
      apiKey,
      openaiRequest,
      undefined,
      "claude-nim-proxy/1.0",
      { requestTimeoutMs: state.requestTimeoutMs },
    )) {
      if (!firstChunkReceived) {
        timeToFirstTokenMs = Date.now() - metricStart;
        firstChunkReceived = true;
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;

      if (choice.delta.content) {
        const textToProcess = state.showReasoningEnabled
          ? choice.delta.content
          : stripper.process(choice.delta.content);
        if (textToProcess) {
          textContent += textToProcess;
        }
        outputTokens += estimateTokens(choice.delta.content);
      }

      if (choice.delta.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCalls[idx]) {
            toolCalls[idx] = {
              id: tc.id || `toolu_${Date.now().toString(36)}_${idx}`,
              name: tc.function?.name || "unknown",
              argsParts: [],
            };
          }
          if (tc.function?.arguments) {
            toolCalls[idx].argsParts.push(tc.function.arguments);
          }
        }
      }

      if (choice.finish_reason) lastFinishReason = choice.finish_reason;
      if (chunk.usage?.completion_tokens)
        outputTokens = chunk.usage.completion_tokens;
    }

    if (!state.showReasoningEnabled) {
      const remainingText = stripper.flush();
      if (remainingText) {
        textContent += remainingText;
      }
    }

    if (textContent) {
      // Parse any embedded tools in the final non-streamed text
      const { segments } = parseTextEmbeddedToolCalls(textContent);
      for (const seg of segments) {
        if (seg.type === "text") {
          contentBlocks.push({ type: "text", text: seg.text });
        } else if (seg.type === "toolCall") {
          contentBlocks.push({
            type: "tool_use",
            id: `toolu_${Date.now().toString(36)}`,
            name: seg.toolCall.name,
            input: seg.toolCall.args,
          });
        }
      }
    }
    for (const tc of toolCalls) {
      if (!tc) continue;
      let input: unknown = {};
      const args = tc.argsParts.join("");
      try {
        const parsedArgs = JSON.parse(jsonrepair(args));
        input = repairToolArguments(tc.name, parsedArgs, undefined);
      } catch {
        try {
          input = JSON.parse(args);
        } catch {
          input = {};
        }
      }
      contentBlocks.push({
        type: "tool_use",
        id: tc.id,
        name: tc.name,
        input,
      });
    }

    const hasTools = toolCalls.some(Boolean);
    const stopReason = mapStopReason(lastFinishReason, hasTools);
    const inputTokens = estimateTokens(JSON.stringify(openaiRequest.messages));

    sendJson(res, 200, {
      id: `msg_nim_${Date.now().toString(36)}`,
      type: "message",
      role: "assistant",
      content: contentBlocks,
      model: requestModel,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      },
    });

    // Record metric
    recordMetric({
      id: metricId,
      timestamp: metricStart,
      model: requestModel,
      stream: false,
      inputTokens,
      outputTokens,
      latencyMs: Date.now() - metricStart,
      timeToFirstTokenMs,
      status: "success",
      messageCount: body.messages?.length ?? 0,
      contextCharCount: JSON.stringify(body).length,
    });

    debugLog(
      "proxy",
      `← ${requestModel} (${stopReason}, ~${outputTokens} tokens)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    debugLog("proxy", `Request error: ${msg}`);
    try {
      vscode.window.showErrorMessage(`Claude-NIM Proxy error: ${msg}`);
    } catch {
      // Ignored if VS Code not available
    }
    let status = 502;
    let type = "api_error";
    if (msg.includes("[AUTH_FAILED]")) {
      status = 401;
      type = "authentication_error";
    } else if (msg.includes("[RATE_LIMITED]")) {
      status = 429;
      type = "rate_limit_error";
    }
    sendError(res, status, type, msg);

    // Record error metric
    recordMetric({
      id: metricId,
      timestamp: metricStart,
      model: requestModel,
      stream: false,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - metricStart,
      timeToFirstTokenMs,
      status: "error",
      error: msg,
      messageCount: body.messages?.length ?? 0,
      contextCharCount: JSON.stringify(body).length,
    });
  }
}
