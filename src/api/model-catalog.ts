// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { NvidiaModelSummary } from "../shared/types";
export interface NormalizedNvidiaModel {
  id: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsVision: boolean;
}

const DATA_DIR = path.join(os.homedir(), ".claude-nim");
const CACHE_FILE = path.join(DATA_DIR, "models-cache.json");

export function saveModelsCache(models: NormalizedNvidiaModel[]): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(models, null, 2), "utf8");
  } catch {
    // ignore
  }
}

export function loadModelsCache(): NormalizedNvidiaModel[] | null {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
      if (
        Array.isArray(data) &&
        data.length > 0 &&
        isNormalizedNvidiaModel(data[0])
      ) {
        return data as NormalizedNvidiaModel[];
      }
    }
  } catch {
    // ignore
  }
  return null;
}

const DEFAULT_CONTEXT_WINDOW = 131072;
const DEFAULT_MAX_OUTPUT_TOKENS = 65536;
const NON_CHAT_MODEL_ID_PATTERNS = [
  /(^|[/_-])bge([-_/]|$)/i,
  /(^|[/_-])(clip|detector|embed|embedcode|embedqa|embedding|gliner|parse|rerank|retriever|reward)([-_/]|$)/i,
];

const KNOWN_MODEL_OVERRIDES: Record<string, Partial<NormalizedNvidiaModel>> = {
  "meta/llama-4-maverick-17b-128e-instruct": {
    displayName: "Llama 4 Maverick 17B 128E Instruct",
  },
  "meta/llama-4-scout-17b-16e-instruct": {
    displayName: "Llama 4 Scout 17B 16E Instruct",
  },
  "nvidia/nemotron-4-340b-instruct": {
    displayName: "Nemotron 4 340B Instruct",
  },
  "nvidia/llama-3.1-nemotron-70b-instruct": {
    displayName: "Llama 3.1 Nemotron 70B Instruct",
  },
  "nvidia/llama-3.1-nemotron-ultra-253b-v1": {
    displayName: "Llama 3.1 Nemotron Ultra 253B",
  },
  "mistralai/mistral-large": {
    displayName: "Mistral Large",
  },
  "mistralai/mistral-large-2407": {
    displayName: "Mistral Large 2407",
  },
  "mistralai/mixtral-8x22b-instruct-v0.1": {
    displayName: "Mixtral 8x22B Instruct",
  },
  "qwen/qwen2.5-72b-instruct": {
    displayName: "Qwen 2.5 72B Instruct",
  },
  "qwen/qwen2.5-coder-32b-instruct": {
    displayName: "Qwen 2.5 Coder 32B Instruct",
  },
  "microsoft/phi-3.5-mini-instruct": {
    displayName: "Phi 3.5 Mini Instruct",
  },
  "01-ai/yi-large": {
    displayName: "Yi Large",
  },
  "google/gemma-2-27b-it": {
    displayName: "Gemma 2 27B IT",
  },
  "google/gemma-2-9b-it": {
    displayName: "Gemma 2 9B IT",
  },
  "google/gemma-3-27b-it": {
    displayName: "Gemma 3 27B IT",
  },
  "google/gemma-3-12b-it": {
    displayName: "Gemma 3 12B IT",
  },
  "minimaxai/minimax-m3": {
    displayName: "MiniMax M3",
    contextWindow: 1_048_576,
    maxOutputTokens: 524_288,
    supportsVision: true,
    supportsTools: true,
  },
  "minimaxai/minimax-m2.7": {
    displayName: "MiniMax M2.7",
    contextWindow: 1_048_576,
    maxOutputTokens: 131_072,
    supportsVision: false,
    supportsTools: true,
  },
  "deepseek-ai/deepseek-r1": {
    displayName: "DeepSeek R1",
  },
  "deepseek-ai/deepseek-v3": {
    displayName: "DeepSeek V3",
  },
  "deepseek-ai/deepseek-v3-0324": {
    displayName: "DeepSeek V3 0324",
  },
  "qwen/qwq-32b-preview": {
    displayName: "QwQ 32B Preview",
  },
  "nvidia/llama-3.1-nemotron-ultra-253b-v1:awq-moe": {
    displayName: "Llama 3.1 Nemotron Ultra 253B (AWQ MoE)",
  },
  "anthropic/claude-3-5-sonnet": {
    displayName: "Claude 3.5 Sonnet",
  },
  "anthropic/claude-3-5-haiku": {
    displayName: "Claude 3.5 Haiku",
  },
  "anthropic/claude-3-opus": {
    displayName: "Claude 3 Opus",
  },
  "microsoft/phi-4": {
    displayName: "Phi 4",
  },
  "microsoft/phi-4-mini-instruct": {
    displayName: "Phi 4 Mini Instruct",
  },
};

export function normalizeNvidiaModels(
  models: NvidiaModelSummary[],
): NormalizedNvidiaModel[] {
  const seenIds = new Set<string>();
  const normalizedModels: NormalizedNvidiaModel[] = [];

  for (const model of models) {
    if (seenIds.has(model.id) || !isChatModel(model)) {
      continue;
    }
    seenIds.add(model.id);
    normalizedModels.push(normalizeNvidiaModel(model));
  }

  return normalizedModels;
}

export function isNormalizedNvidiaModel(
  value: unknown,
): value is NormalizedNvidiaModel {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<NormalizedNvidiaModel>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.displayName === "string" &&
    typeof candidate.contextWindow === "number" &&
    typeof candidate.maxOutputTokens === "number" &&
    typeof candidate.supportsTools === "boolean" &&
    typeof candidate.supportsVision === "boolean"
  );
}

function normalizeNvidiaModel(
  model: NvidiaModelSummary,
): NormalizedNvidiaModel {
  const override = KNOWN_MODEL_OVERRIDES[model.id];

  return {
    id: model.id,
    displayName:
      model.name ?? override?.displayName ?? deriveDisplayName(model.id),
    contextWindow:
      getPositiveNumber(override?.contextWindow) ??
      getPositiveNumber(model.metadata?.context_window) ??
      DEFAULT_CONTEXT_WINDOW,
    maxOutputTokens:
      getPositiveNumber(override?.maxOutputTokens) ??
      getPositiveNumber(model.metadata?.max_output_tokens) ??
      getPositiveNumber(model.metadata?.max_tokens) ??
      DEFAULT_MAX_OUTPUT_TOKENS,
    supportsTools:
      model.capabilities?.tool_calling ?? override?.supportsTools ?? true,
    supportsVision:
      model.capabilities?.vision ?? override?.supportsVision ?? false,
  };
}

function isChatModel(model: NvidiaModelSummary): boolean {
  if (model.capabilities?.chat === true) {
    return true;
  }

  if (model.capabilities?.chat === false) {
    return false;
  }

  return !isClearlyNonChatModelId(model.id);
}

function isClearlyNonChatModelId(modelId: string): boolean {
  return NON_CHAT_MODEL_ID_PATTERNS.some((pattern) => pattern.test(modelId));
}

function deriveDisplayName(modelId: string): string {
  const lastSegment = modelId.split("/").at(-1);
  return lastSegment && lastSegment.length > 0 ? lastSegment : modelId;
}

function getPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

/** Shared model-family classification rules (used by both model-catalog and CLI). */
export const MODEL_FAMILY_RULES: [RegExp, string][] = [
  [/deepseek/, "DeepSeek"],
  [/gemma/, "Gemma"],
  [/llama/, "Llama"],
  [/nemotron/, "Nemotron"],
  [/mistral|mixtral/, "Mistral"],
  [/minimax/, "Minimax"],
  [/qwen|qwq/, "Qwen"],
  [/phi/, "Phi"],
  [/yi(?![a-z])/, "Yi"],
  [/claude/, "Claude"],
  [/gpt/, "GPT"],
  [/jamba/, "Jamba"],
  [/dbrx/, "DBRX"],
  [/starcoder/, "Starcoder"],
  [/command-r/, "Command-R"],
  [/falcon/, "Falcon"],
  [/solar/, "Solar"],
  [/codegeex/, "CodeGeeX"],
  [/seed/, "Seed"],
  [/sea-lion/, "Sea-Lion"],
  [/fuyu/, "Fuyu"],
  [/deplot/, "DePlot"],
  [/kosmos/, "Kosmos"],
  [/olmo/, "OLMo"],
  [/c4ai/, "C4AI"],
  [/aya/, "Aya"],
  [/bloom/, "BLOOM"],
  [/nvidia/, "Nvidia"],
  [/google/, "Google"],
  [/microsoft/, "Microsoft"],
  [/meta/, "Meta"],
  [/anthropic/, "Anthropic"],
];

/** Preferred display order for model families. */
export const MODEL_FAMILY_ORDER: string[] = [
  "DeepSeek",
  "Gemma",
  "Llama",
  "Minimax",
  "Mistral",
  "Nemotron",
  "Phi",
  "Qwen",
  "Yi",
  "Claude",
  "GPT",
  "Other",
];

function getModelFamily(model: NormalizedNvidiaModel): string {
  const id = model.id.toLowerCase();
  for (const [regex, family] of MODEL_FAMILY_RULES) {
    if (regex.test(id)) return family;
  }
  const provider = model.id.split("/")[0];
  return provider
    ? provider.charAt(0).toUpperCase() + provider.slice(1)
    : "Other";
}

export function groupModelsByFamily(
  models: NormalizedNvidiaModel[],
): Map<string, NormalizedNvidiaModel[]> {
  const groups = new Map<string, NormalizedNvidiaModel[]>();

  for (const model of models) {
    const family = getModelFamily(model);

    if (!groups.has(family)) {
      groups.set(family, []);
    }
    groups.get(family)!.push(model);
  }

  const sortedMap = new Map<string, NormalizedNvidiaModel[]>();
  const keys = Array.from(groups.keys()).sort((a, b) => {
    if (a === "Other") return 1;
    if (b === "Other") return -1;
    return a.localeCompare(b);
  });

  for (const key of keys) {
    sortedMap.set(key, groups.get(key)!);
  }

  return sortedMap;
}
