// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details

export interface ToolSchema {
  required?: string[];
}

export interface SkippedToolCall {
  name: string;
  required: string[];
}

export function buildToolCallCanonicalKey(name: string, args: unknown): string {
  return `${name}:${JSON.stringify(args)}`;
}

export function hasRequiredToolArguments(
  args: unknown,
  schema: ToolSchema | undefined,
): boolean {
  const required = schema?.required ?? [];
  if (required.length === 0) {
    return true;
  }
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return false;
  }
  const record = args as Record<string, unknown>;
  return required.every(
    (key) =>
      key in record &&
      record[key] !== undefined &&
      record[key] !== null &&
      record[key] !== "",
  );
}

export function buildInvalidToolCallFallback(
  skippedToolCalls: readonly SkippedToolCall[],
): string | undefined {
  const skippedWithRequiredArgs = skippedToolCalls.find(
    (toolCall) => toolCall.required.length > 0,
  );
  if (skippedWithRequiredArgs) {
    const requiredArgs = skippedWithRequiredArgs.required
      .map((arg) => `\`${arg}\``)
      .join(", ");
    return `Tool call \`${skippedWithRequiredArgs.name}\` was rejected: missing ${requiredArgs}. Retry with all required fields filled.`;
  }

  const firstSkippedToolCall = skippedToolCalls[0];
  if (!firstSkippedToolCall) {
    return undefined;
  }

  return `Tool call \`${firstSkippedToolCall.name}\` had invalid arguments. Retry with a valid JSON object.`;
}

export function buildInvalidToolCallRetryMessage(
  skippedToolCalls: readonly SkippedToolCall[],
): string | undefined {
  const skippedWithRequiredArgs = skippedToolCalls.find(
    (toolCall) => toolCall.required.length > 0,
  );
  if (skippedWithRequiredArgs) {
    const requiredList = skippedWithRequiredArgs.required.join(", ");
    return [
      `Your previous tool call "${skippedWithRequiredArgs.name}" was rejected because it was missing required arguments: ${requiredList}.`,
      `Retry NOW. Provide a valid JSON object containing ALL of: ${requiredList}.`,
      "Do not call any tool with an empty object or missing fields.",
      "Do not ask the user to retry. Do not explain the error.",
    ].join(" ");
  }

  const firstSkippedToolCall = skippedToolCalls[0];
  if (!firstSkippedToolCall) {
    return undefined;
  }

  return [
    `Your previous tool call "${firstSkippedToolCall.name}" was rejected due to invalid or incomplete arguments.`,
    "Retry NOW with a complete, valid JSON object.",
    "Do not emit malformed JSON or empty arguments.",
    "Do not ask the user to retry. Do not explain what went wrong.",
  ].join(" ");
}

export function repairToolArguments(
  args: unknown,
  schema?: ToolSchema,
): unknown {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return args;
  }

  const record = args as Record<string, unknown>;
  const repaired: Record<string, unknown> = {};

  for (const key of Object.keys(record)) {
    repaired[key] = record[key]; // copy first
  }

  if (schema?.required) {
    for (const key of schema.required) {
      const val = repaired[key];
      if (typeof val === "string") {
        const lower = val.toLowerCase().trim();
        if (lower === "true" || lower === "yes" || lower === "1") {
          repaired[key] = true;
        } else if (lower === "false" || lower === "no" || lower === "0") {
          repaired[key] = false;
        }
      } else if (typeof val === "number") {
        // numbers are fine as-is, models often give them correctly
      } else if (val === undefined) {
        // default missing required string/number/boolean to empty/null
        repaired[key] = null;
      }
    }
  }

  return repaired;
}

export function getCompletedToolCallKeys(
  messages: readonly { role: string; content: unknown }[],
  toolSchemas: ReadonlyMap<string, ToolSchema>,
): Set<string> {
  let startIndex = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "user") {
      continue;
    }

    const contentArray = Array.isArray(message.content) ? message.content : [];
    const hasNonToolResultContent = contentArray.some((part) => {
      const toolResultPart = part as {
        type?: string;
        tool_use_id?: string;
        content?: unknown;
      };
      return toolResultPart.type !== "tool_result";
    });

    if (hasNonToolResultContent) {
      startIndex = i + 1;
      break;
    }
  }

  const completedCallIds = new Set<string>();

  for (const message of messages.slice(startIndex)) {
    const contentArray = Array.isArray(message.content) ? message.content : [];
    for (const part of contentArray) {
      const toolResultPart = part as {
        type?: string;
        tool_use_id?: string;
        content?: unknown;
      };
      if (
        toolResultPart.type === "tool_result" &&
        typeof toolResultPart.tool_use_id === "string"
      ) {
        completedCallIds.add(toolResultPart.tool_use_id);
      }
    }
  }

  const keys = new Set<string>();
  for (const message of messages.slice(startIndex)) {
    const contentArray = Array.isArray(message.content) ? message.content : [];
    for (const part of contentArray) {
      const toolCallPart = part as {
        type?: string;
        id?: string;
        name?: string;
        input?: unknown;
      };
      if (
        toolCallPart.type !== "tool_use" ||
        typeof toolCallPart.id !== "string" ||
        !completedCallIds.has(toolCallPart.id) ||
        typeof toolCallPart.name !== "string"
      ) {
        continue;
      }

      const repairedArgs = repairToolArguments(
        toolCallPart.input ?? {},
        toolSchemas.get(toolCallPart.name),
      );
      keys.add(buildToolCallCanonicalKey(toolCallPart.name, repairedArgs));
    }
  }

  return keys;
}
