// ── NIM 400-error retry with body downgrades ────────────────────────────

function deepClone<T>(obj: T): T {
  return structuredClone(obj);
}

function stripReasoningBudget(body: Record<string, unknown>): boolean {
  const extra = body.extra_body;
  if (!extra || typeof extra !== "object") return false;
  const e = extra as Record<string, unknown>;
  let removed = "reasoning_budget" in e;
  delete e.reasoning_budget;
  const ctk = e.chat_template_kwargs;
  if (
    ctk &&
    typeof ctk === "object" &&
    "reasoning_budget" in (ctk as Record<string, unknown>)
  ) {
    delete (ctk as Record<string, unknown>).reasoning_budget;
    removed = true;
  }
  return removed;
}

function stripChatTemplate(body: Record<string, unknown>): boolean {
  const extra = body.extra_body;
  if (!extra || typeof extra !== "object") return false;
  const e = extra as Record<string, unknown>;
  if ("chat_template" in e) {
    delete e.chat_template;
    return true;
  }
  return false;
}

function stripReasoningContent(body: Record<string, unknown>): boolean {
  const messages = body.messages;
  if (!Array.isArray(messages)) return false;
  let removed = false;
  for (const msg of messages) {
    if (
      msg &&
      typeof msg === "object" &&
      "reasoning_content" in (msg as Record<string, unknown>)
    ) {
      delete (msg as Record<string, unknown>).reasoning_content;
      removed = true;
    }
  }
  return removed;
}

export type RetryBodyFn = (
  body: Record<string, unknown>,
) => Record<string, unknown> | null;

const RE_REASONING_BUDGET = /\breasoning_budget\b/i;
const RE_CHAT_TEMPLATE = /\bchat_template\b/i;
const RE_REASONING_CONTENT = /\breasoning_content\b/i;

export function getRetryBody(
  errorText: string,
  body: Record<string, unknown>,
): Record<string, unknown> | null {
  if (RE_REASONING_BUDGET.test(errorText)) {
    const cloned = deepClone(body);
    if (stripReasoningBudget(cloned)) return cloned;
    return null;
  }

  if (RE_CHAT_TEMPLATE.test(errorText)) {
    const cloned = deepClone(body);
    if (stripChatTemplate(cloned)) return cloned;
    return null;
  }

  if (RE_REASONING_CONTENT.test(errorText)) {
    const cloned = deepClone(body);
    if (stripReasoningContent(cloned)) return cloned;
    return null;
  }

  return null;
}
