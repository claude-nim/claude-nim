// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
import { normalizeNvidiaModels } from "../src/model-catalog";

describe("Model Catalog Filter", () => {
  it("should filter out non-chat models", () => {
    const rawModels = [
      { id: "meta/llama-3.1-405b-instruct" },
      { id: "nvidia/nv-embedqa-e5-v5" },
      { id: "snowflake/arctic-embed-l" },
      { id: "mistralai/mixtral-8x7b-instruct-v0.1" },
    ];

    const filtered = normalizeNvidiaModels(rawModels);
    expect(filtered.length).toBe(2);
    expect(filtered[0].id).toBe("meta/llama-3.1-405b-instruct");
    expect(filtered[1].id).toBe("mistralai/mixtral-8x7b-instruct-v0.1");
  });

  it("should calculate correct context window", () => {
    const rawModels = [{ id: "meta/llama-3.1-405b-instruct" }];

    const filtered = normalizeNvidiaModels(rawModels);
    expect(filtered[0].contextWindow).toBe(131072);
  });
});
