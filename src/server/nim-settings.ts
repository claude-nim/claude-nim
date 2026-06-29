// ── NVIDIA NIM provider settings ─────────────────────────────────────────

const DEFAULT_MAX_TOKENS = 4096;

export interface NimSettings {
  temperature: number;
  top_p: number;
  top_k: number;
  max_tokens: number;
  presence_penalty: number;
  frequency_penalty: number;
  min_p: number;
  repetition_penalty: number;
  seed: number | null;
  stop: string | null;
  parallel_tool_calls: boolean;
  ignore_eos: boolean;
  min_tokens: number;
  chat_template: string | null;
  request_id: string | null;
}

export const DEFAULT_NIM_SETTINGS: NimSettings = {
  temperature: 1.0,
  top_p: 1.0,
  top_k: -1,
  max_tokens: DEFAULT_MAX_TOKENS,
  presence_penalty: 0.0,
  frequency_penalty: 0.0,
  min_p: 0.0,
  repetition_penalty: 1.0,
  seed: null,
  stop: null,
  parallel_tool_calls: true,
  ignore_eos: false,
  min_tokens: 0,
  chat_template: null,
  request_id: null,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function validateNimSettings(
  overrides: Partial<NimSettings>,
): NimSettings {
  const merged = { ...DEFAULT_NIM_SETTINGS, ...overrides };
  merged.temperature = clamp(merged.temperature, 0, 2);
  merged.top_p = clamp(merged.top_p, 0, 1);
  merged.max_tokens = Math.max(1, merged.max_tokens);
  merged.min_tokens = Math.max(0, merged.min_tokens);
  merged.presence_penalty = clamp(merged.presence_penalty, -2, 2);
  merged.frequency_penalty = clamp(merged.frequency_penalty, -2, 2);
  return merged;
}

export function nimExtraBody(settings: NimSettings): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  if (settings.top_k >= 0) extra.top_k = settings.top_k;
  if (settings.min_p > 0) extra.min_p = settings.min_p;
  if (settings.repetition_penalty !== 1.0)
    extra.repetition_penalty = settings.repetition_penalty;
  if (settings.min_tokens > 0) extra.min_tokens = settings.min_tokens;
  if (settings.chat_template) extra.chat_template = settings.chat_template;
  if (settings.request_id) extra.request_id = settings.request_id;
  if (settings.ignore_eos) extra.ignore_eos = true;
  return extra;
}
