// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details

import * as http from "node:http";
import * as vscode from "vscode";
import { streamChatCompletion } from "../api";
import { getCurrentModel } from "../model-switch";
import { debugLog } from "../output-channel";
import {
  translateRequest,
  buildMessageStart,
  buildContentBlockStart,
  buildTextDelta,
  buildToolInputDelta,
  buildContentBlockStop,
  buildMessageDelta,
  buildMessageStop,
  buildPing,
  mapStopReason,
  estimateTokens,
} from "../translator";
import { repairToolArguments } from "../tool-validator";
import { parseTextEmbeddedToolCalls } from "../tool-parser";
import { jsonrepair } from "jsonrepair";
import { recordMetric } from "../dashboard";
import type { AnthropicMessagesRequest } from "../anthropic-types";
import { sendError } from "./http-helpers";
import { ReasoningStripper } from "./reasoning-stripper";
import { state } from "./proxy-state";
import { generateId } from "../constants";

/**
 * Handle a streaming /v1/messages request.
 * Translates the Anthropic request to OpenAI format, streams chunks from NIM,
 * and re-assembles them into Anthropic SSE events.
 */
export async function handleMessagesStream(
  req: http.IncomingMessage,
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

  const requestModel = body.model;
  debugLog(
    "proxy",
    `→ ${requestModel} (stream, max_tokens=${body.max_tokens})`,
  );

  const openaiRequest = translateRequest(body);
  openaiRequest.stream = true;

  const abortController = new AbortController();
  state.activeStreams.add(abortController);

  // Metrics capture
  const metricStart = Date.now();
  const metricId = generateId();
  const contextCharCount = body.messages
    ? body.messages.reduce(
        (sum, m) =>
          sum +
          (typeof m.content === "string"
            ? m.content.length
            : JSON.stringify(m.content).length),
        0,
      )
    : 0;

  req.on("close", () => {
    abortController.abort();
    state.activeStreams.delete(abortController);
  });

  try {
    // Send headers and initial events immediately (don't wait for first NIM chunk)
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "X-Accel-Buffering": "no",
    });
    res.write(buildPing());
    let inputChars = 0;
    for (const m of openaiRequest.messages) {
      inputChars +=
        typeof m.content === "string"
          ? m.content.length
          : JSON.stringify(m.content).length;
    }
    const inputTokens = Math.ceil(inputChars / 4);
    res.write(buildMessageStart(requestModel, inputTokens));

    const stream = streamChatCompletion(
      apiKey,
      openaiRequest,
      abortController.signal,
      "claude-nim-proxy/1.0",
      { requestTimeoutMs: state.requestTimeoutMs },
    );

    let timeToFirstTokenMs = 0;
    let firstChunkReceived = false;
    let contentBlockIndex = 0;
    let textBlockStarted = false;
    const activeToolCalls = new Map<
      number,
      { id: string; name: string; argsParts: string[]; blockIndex: number }
    >();
    let outputTokens = 0;
    let hasToolCalls = false;
    let lastFinishReason: string | null = null;
    let pendingText = "";
    const stripper = new ReasoningStripper();

    const flushTextSegments = (force = false) => {
      if (!pendingText) return;

      const { segments, incompleteText } =
        parseTextEmbeddedToolCalls(pendingText);
      pendingText = incompleteText;

      if (force && pendingText) {
        segments.push({ type: "text", text: pendingText });
        pendingText = "";
      }

      for (const seg of segments) {
        if (seg.type === "text" && seg.text) {
          if (!textBlockStarted) {
            res.write(buildContentBlockStart(contentBlockIndex, "text"));
            textBlockStarted = true;
          }
          res.write(buildTextDelta(contentBlockIndex, seg.text));
          outputTokens += estimateTokens(seg.text);
        } else if (seg.type === "toolCall") {
          if (textBlockStarted) {
            res.write(buildContentBlockStop(contentBlockIndex));
            contentBlockIndex++;
            textBlockStarted = false;
          }

          const toolId = `toolu_${Date.now().toString(36)}_${contentBlockIndex}`;
          res.write(
            buildContentBlockStart(contentBlockIndex, "tool_use", {
              id: toolId,
              name: seg.toolCall.name,
            }),
          );
          res.write(
            buildToolInputDelta(
              contentBlockIndex,
              JSON.stringify(seg.toolCall.args),
            ),
          );
          res.write(buildContentBlockStop(contentBlockIndex));
          contentBlockIndex++;
          hasToolCalls = true;
        } else if (seg.type === "invalidToolCall") {
          const errText = `[Invalid tool call: ${seg.name || "unknown"}]`;
          if (!textBlockStarted) {
            res.write(buildContentBlockStart(contentBlockIndex, "text"));
            textBlockStarted = true;
          }
          res.write(buildTextDelta(contentBlockIndex, errText));
          outputTokens += estimateTokens(errText);
        }
      }
    };

    try {
      for await (const chunk of stream) {
        if (!firstChunkReceived) {
          timeToFirstTokenMs = Date.now() - metricStart;
          firstChunkReceived = true;
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;

        if (delta.content) {
          const textToProcess = state.showReasoningEnabled
            ? delta.content
            : stripper.process(delta.content);
          if (textToProcess) {
            pendingText += textToProcess;
            flushTextSegments();
          }
        }

        if (delta.tool_calls) {
          if (pendingText) flushTextSegments(true);

          for (const tc of delta.tool_calls) {
            const tcIndex = tc.index ?? 0;

            if (!activeToolCalls.has(tcIndex)) {
              if (textBlockStarted) {
                res.write(buildContentBlockStop(contentBlockIndex));
                contentBlockIndex++;
                textBlockStarted = false;
              }

              const toolId =
                tc.id || `toolu_${Date.now().toString(36)}_${tcIndex}`;
              const toolName = tc.function?.name || "unknown";
              activeToolCalls.set(tcIndex, {
                id: toolId,
                name: toolName,
                argsParts: [],
                blockIndex: contentBlockIndex,
              });
              res.write(
                buildContentBlockStart(contentBlockIndex, "tool_use", {
                  id: toolId,
                  name: toolName,
                }),
              );
              hasToolCalls = true;
              contentBlockIndex++;
            }

            const tool = activeToolCalls.get(tcIndex)!;
            if (tc.function?.arguments) {
              tool.argsParts.push(tc.function.arguments);
            }
          }
        }

        if (choice.finish_reason) {
          lastFinishReason = choice.finish_reason;
        }

        if (chunk.usage?.completion_tokens) {
          outputTokens = chunk.usage.completion_tokens;
        }
      }
    } catch (innerErr) {
      // Headers already sent — can't change status, send error SSE event
      const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
      debugLog("proxy", `NIM stream error: ${msg}`);
      // Close any open content blocks so Claude Code doesn't hang
      try {
        if (textBlockStarted) {
          res.write(buildContentBlockStop(contentBlockIndex));
        }
        for (const [, tool] of activeToolCalls) {
          res.write(buildContentBlockStop(tool.blockIndex));
        }
      } catch { /* ignore — socket may already be closed */ }
      const errorEvent = {
        type: "error",
        error: { type: "api_error", message: msg },
      };
      try { res.write(`data: ${JSON.stringify(errorEvent)}\n\n`); } catch { /* ignore */ }
      recordMetric({
        id: metricId,
        timestamp: metricStart,
        model: requestModel,
        stream: true,
        inputTokens,
        outputTokens,
        latencyMs: Date.now() - metricStart,
        timeToFirstTokenMs,
        status: "error",
        error: msg,
        messageCount: body.messages?.length ?? 0,
        contextCharCount: JSON.stringify(body).length,
      });
      return;
    }

    // Flush any remaining text
    if (!state.showReasoningEnabled) {
      const remainingText = stripper.flush();
      if (remainingText) {
        pendingText += remainingText;
      }
    }
    flushTextSegments(true);

    if (textBlockStarted) {
      res.write(buildContentBlockStop(contentBlockIndex));
    }

    // Repair and send buffered tool calls
    for (const [, tool] of activeToolCalls) {
      let finalArgs = tool.argsParts.join("");
      try {
        const parsedArgs = JSON.parse(jsonrepair(finalArgs));
        finalArgs = JSON.stringify(
          repairToolArguments(tool.name, parsedArgs, undefined),
        );
      } catch {
        // If repair fails, send as is and hope for the best
      }
      if (finalArgs) {
        res.write(buildToolInputDelta(tool.blockIndex, finalArgs));
      }
      res.write(buildContentBlockStop(tool.blockIndex));
    }

    const stopReason = mapStopReason(lastFinishReason, hasToolCalls);
    res.write(buildMessageDelta(stopReason, outputTokens));
    res.write(buildMessageStop());

    // Record metric
    recordMetric({
      id: metricId,
      timestamp: metricStart,
      model: requestModel,
      stream: true,
      inputTokens,
      outputTokens,
      latencyMs: Date.now() - metricStart,
      timeToFirstTokenMs,
      status: "success",
      messageCount: body.messages?.length ?? 0,
      contextCharCount: contextCharCount,
    });

    debugLog(
      "proxy",
      `← ${requestModel} (${stopReason}, ~${outputTokens} tokens)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("AbortError") || msg.includes("aborted")) {
      debugLog("proxy", "Client disconnected");
    } else {
      // Record error metric
      recordMetric({
        id: metricId,
        timestamp: metricStart,
        model: requestModel,
        stream: true,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - metricStart,
        timeToFirstTokenMs: 0,
        status: "error",
        error: msg,
        messageCount: body.messages?.length ?? 0,
        contextCharCount: JSON.stringify(body).length,
      });

      debugLog("proxy", `Stream error: ${msg}`);
      try {
        vscode.window.showErrorMessage(`Claude-NIM Proxy stream error: ${msg}`);
      } catch {
        // Ignored if VS Code not available
      }
      try {
        const errorEvent = {
          type: "error",
          error: { type: "api_error", message: msg },
        };
        res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
      } catch {
        // Ignored
      }
    }
  } finally {
    state.activeStreams.delete(abortController);
    res.end();
  }
}
