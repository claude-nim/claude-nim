// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details

import { fetchModels } from "../api";
import {
  normalizeNvidiaModels,
  saveModelsCache,
  loadModelsCache,
} from "../api/model-catalog";
import { getCurrentModel } from "../api/model-switch";
import {
  encodeNimGatewayModelId,
  encodeNoThinkGatewayModelId,
} from "./gateway-model-ids";
import { debugLog } from "../extension/output-channel";
import { state } from "./proxy-state";

/** Shape of a single model entry in the API response. */
export interface ModelEntry {
  type: "model";
  id: string;
  display_name: string;
  created_at: string;
}

/** Shape of the full models list response. */
export interface ModelsResponse {
  data: ModelEntry[];
  has_more: boolean;
  first_id: string;
  last_id: string;
}

/**
 * Get model data from in-memory cache, NIM API, disk cache, or extreme fallback.
 * This is the single source of truth for all model-listing routes.
 */
export async function getOrFetchModelsData(): Promise<ModelsResponse> {
  // 1. In-memory cache hit
  if (
    state.modelsCache &&
    state.modelsCache.apiKey === state.activeApiKey &&
    Date.now() - state.modelsCache.timestamp < state.modelsCacheTTLMs
  ) {
    return state.modelsCache.data as unknown as ModelsResponse;
  }

  // 2. Fetch from NIM API
  try {
    const rawModels = await fetchModels(
      state.activeApiKey!,
      undefined,
      "claude-nim-proxy/1.0",
      state.requestTimeoutMs,
    );
    if (rawModels) {
      const normalized = normalizeNvidiaModels(rawModels);
      saveModelsCache(normalized);

      const data: ModelEntry[] = normalized.map((m) => ({
        type: "model" as const,
        id: m.id,
        display_name: m.displayName,
        created_at: new Date(Date.now() - 86400000).toISOString(),
      }));

      const currentNim =
        state.activeDefaultModel ||
        getCurrentModel() ||
        normalized[0]?.id ||
        "";
      if (currentNim) {
        data.push({
          type: "model" as const,
          id: "NVIDIA-NIM-Proxy",
          display_name: `NVIDIA NIM (${currentNim})`,
          created_at: new Date(Date.now() - 86400000).toISOString(),
        });
      }

      const responseData: ModelsResponse = {
        data,
        has_more: false,
        first_id: data[0]?.id ?? "",
        last_id: data[data.length - 1]?.id ?? "",
      };

      state.modelsCache = {
        data: responseData as unknown as Record<string, unknown>,
        timestamp: Date.now(),
        apiKey: state.activeApiKey!,
      };
      return responseData;
    }
  } catch (err) {
    debugLog(
      "proxy",
      `Model fetch failed (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  // 3. Disk cache fallback
  const diskCache = loadModelsCache();
  if (diskCache && diskCache.length > 0) {
    debugLog("proxy", "NIM models unavailable, using disk cache fallback.");
    const data: ModelEntry[] = diskCache.map((m) => ({
      type: "model" as const,
      id: m.id,
      display_name: m.displayName,
      created_at: new Date(Date.now() - 86400000).toISOString(),
    }));
    const currentNim =
      state.activeDefaultModel || getCurrentModel() || diskCache[0]?.id || "";
    if (currentNim) {
      data.push({
        type: "model" as const,
        id: "NVIDIA-NIM-Proxy",
        display_name: `NVIDIA NIM (${currentNim})`,
        created_at: new Date(Date.now() - 86400000).toISOString(),
      });
    }
    return {
      data,
      has_more: false,
      first_id: data[0]?.id ?? "",
      last_id: data[data.length - 1]?.id ?? "",
    };
  }

  // 4. Extreme fallback — just the proxy entry
  debugLog("proxy", "NIM models unavailable, using minimal fallback.");
  const currentNim =
    state.activeDefaultModel || getCurrentModel() || "deepseek-ai/deepseek-r1";
  const data: ModelEntry[] = [
    {
      type: "model",
      id: "NVIDIA-NIM-Proxy",
      display_name: `NVIDIA NIM (${currentNim})`,
      created_at: new Date(Date.now() - 86400000).toISOString(),
    },
  ];
  return {
    data,
    has_more: false,
    first_id: data[0].id,
    last_id: data[0].id,
  };
}

/** Response entry shape for the Anthropic `/v1/models` endpoint. */
interface ModelsListEntry {
  object: "model";
  created: number;
  owned_by: string;
  created_at: string;
  display_name: string;
  id: string;
  type: "model";
}

/**
 * Build a full Response for the `/v1/models` endpoint using the cached/fetched
 * model data with gateway-encoded IDs and a virtual proxy entry.
 */
export async function handleModelsRequest(): Promise<Response> {
  const modelsData = await getOrFetchModelsData();

  const seen = new Set<string>();
  const data: ModelsListEntry[] = [];

  for (const m of modelsData.data) {
    // Thinking variant
    const thinkingId = encodeNimGatewayModelId(m.id);
    if (!seen.has(thinkingId)) {
      seen.add(thinkingId);
      data.push({
        object: "model" as const,
        created: Math.floor(Date.now() / 1000),
        owned_by: "nim-proxy",
        created_at: m.created_at,
        display_name: m.display_name,
        id: thinkingId,
        type: "model" as const,
      });
    }

    // No-thinking variant (Claude Code treats "claude-3-*" prefix as no-thinking)
    const noThinkId = encodeNoThinkGatewayModelId(m.id);
    if (!seen.has(noThinkId)) {
      seen.add(noThinkId);
      data.push({
        object: "model" as const,
        created: Math.floor(Date.now() / 1000) + 1,
        owned_by: "nim-proxy",
        created_at: m.created_at,
        display_name: `${m.display_name} (no thinking)`,
        id: noThinkId,
        type: "model" as const,
      });
    }
  }

  return new Response(
    JSON.stringify({
      object: "list",
      data,
      first_id: data[0]?.id ?? null,
      has_more: false,
      last_id: data[data.length - 1]?.id ?? null,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}
