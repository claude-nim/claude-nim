// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
import { fetchWithRetry } from "./index";

export interface NIMModel {
  readonly id: string;
  readonly object: string;
  readonly created: number;
  readonly owned_by: string;
}

interface ModelsResponse {
  data: NIMModel[];
}

export async function fetchNimModels(apiKey: string): Promise<NIMModel[]> {
  const res = await fetchWithRetry(
    "https://integrate.api.nvidia.com/v1/models",
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    },
    3,
    10000,
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NVIDIA NIM API error (${res.status}): ${text}`);
  }

  const data = (await res.json()) as ModelsResponse;
  return (data.data ?? []).filter(
    (m) => !m.id.includes("embed") && !m.id.includes("rerank"),
  );
}
