// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
import {
  normalizeNvidiaModels,
  isNormalizedNvidiaModel,
  groupModelsByFamily,
} from "../src/api/model-catalog";

// ============================================================================
// normalizeNvidiaModels
// ============================================================================
describe("normalizeNvidiaModels", () => {
  it("should filter out non-chat models by ID pattern", () => {
    const rawModels = [
      { id: "meta/llama-3.1-405b-instruct" },
      { id: "nvidia/nv-embedqa-e5-v5" },
      { id: "snowflake/arctic-embed-l" },
      { id: "mistralai/mixtral-8x7b-instruct-v0.1" },
    ] as any[];

    const filtered = normalizeNvidiaModels(rawModels);
    expect(filtered).toHaveLength(2);
    expect(filtered[0].id).toBe("meta/llama-3.1-405b-instruct");
    expect(filtered[1].id).toBe("mistralai/mixtral-8x7b-instruct-v0.1");
  });

  it("should filter by capabilities.chat flag", () => {
    const rawModels = [
      { id: "model-a", capabilities: { chat: true } },
      { id: "model-b", capabilities: { chat: false } },
      { id: "model-c" },
    ] as any[];

    const filtered = normalizeNvidiaModels(rawModels);
    expect(filtered).toHaveLength(2);
    expect(filtered[0].id).toBe("model-a");
    expect(filtered[1].id).toBe("model-c");
  });

  it("should deduplicate by ID", () => {
    const rawModels = [
      { id: "meta/llama-3.1-405b-instruct" },
      { id: "meta/llama-3.1-405b-instruct" },
    ] as any[];

    expect(normalizeNvidiaModels(rawModels)).toHaveLength(1);
  });

  it("should assign default context window of 131072", () => {
    const models = normalizeNvidiaModels([{ id: "meta/test-model" }] as any[]);
    expect(models[0].contextWindow).toBe(131072);
  });

  it("should assign default max output tokens of 65536", () => {
    const models = normalizeNvidiaModels([{ id: "meta/test-model" }] as any[]);
    expect(models[0].maxOutputTokens).toBe(65536);
  });

  it("should apply known model overrides", () => {
    const models = normalizeNvidiaModels([
      { id: "minimaxai/minimax-m3" },
    ] as any[]);
    expect(models[0].displayName).toBe("MiniMax M3");
    expect(models[0].contextWindow).toBe(1_048_576);
    expect(models[0].supportsVision).toBe(true);
    expect(models[0].supportsTools).toBe(true);
  });

  it("should use metadata values when available", () => {
    const models = normalizeNvidiaModels([
      {
        id: "meta/test-model",
        name: "Test Model",
        metadata: { context_window: 32000, max_output_tokens: 8000 },
      },
    ] as any[]);
    expect(models[0].displayName).toBe("Test Model");
    expect(models[0].contextWindow).toBe(32000);
    expect(models[0].maxOutputTokens).toBe(8000);
  });
});

// ============================================================================
// isNormalizedNvidiaModel
// ============================================================================
describe("isNormalizedNvidiaModel", () => {
  it("should validate a proper model object", () => {
    expect(
      isNormalizedNvidiaModel({
        id: "test",
        displayName: "Test",
        contextWindow: 100,
        maxOutputTokens: 50,
        supportsTools: true,
        supportsVision: false,
      }),
    ).toBe(true);
  });

  it("should reject null", () => {
    expect(isNormalizedNvidiaModel(null)).toBe(false);
  });

  it("should reject objects with wrong types", () => {
    expect(
      isNormalizedNvidiaModel({
        id: 123,
        displayName: "Test",
        contextWindow: 100,
        maxOutputTokens: 50,
        supportsTools: true,
        supportsVision: false,
      }),
    ).toBe(false);
  });
});

// ============================================================================
// groupModelsByFamily
// ============================================================================
describe("groupModelsByFamily", () => {
  const models = [
    { id: "deepseek/deepseek-r1", displayName: "R1" },
    { id: "meta/llama-3.3-70b", displayName: "Llama" },
    { id: "mistralai/mistral-large", displayName: "Mistral" },
    { id: "unknown/test", displayName: "Test" },
  ] as any[];

  it("should group models by family", () => {
    const groups = groupModelsByFamily(models);
    expect(groups.has("DeepSeek")).toBe(true);
    expect(groups.has("Llama")).toBe(true);
    expect(groups.has("Mistral")).toBe(true);
  });

  it("should put unmatched models in a provider-based family", () => {
    const groups = groupModelsByFamily(models);
    expect(groups.has("Unknown")).toBe(true);
    const unknown = groups.get("Unknown")!;
    expect(unknown[0].id).toBe("unknown/test");
  });

  it("should group provider-based families for unknown model IDs", () => {
    const m = [{ id: "nvidia/custom-nim", displayName: "NIM" }] as any[];
    const groups = groupModelsByFamily(m);
    expect(groups.has("Nvidia")).toBe(true);
  });

  it("should sort Other to the end among real families", () => {
    const m = [{ id: "unknown/foo", displayName: "Foo" }] as any[];
    const groups = groupModelsByFamily(m);
    const keys = Array.from(groups.keys());
    expect(keys[keys.length - 1]).toBe("Unknown");
  });
});
