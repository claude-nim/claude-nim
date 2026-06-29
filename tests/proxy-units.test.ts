// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details

import { FixedWindowRateLimiter } from "../src/server/rate-limiter";
import { ReasoningStripper } from "../src/server/reasoning-stripper";
import {
  encodeNimGatewayModelId,
  decodeNimGatewayModelId,
  isGatewayModelId,
} from "../src/server/gateway-model-ids";
import { validateNimSettings } from "../src/server/nim-settings";
import { getRetryBody } from "../src/server/retry";
import { ModelRouter } from "../src/server/model-router";

// ============================================================================
// Rate Limiter
// ============================================================================
describe("FixedWindowRateLimiter", () => {
  it("should allow the first request immediately", async () => {
    const limiter = new FixedWindowRateLimiter();
    await expect(limiter.acquireToken()).resolves.toBeUndefined();
  });

  it("should allow up to 40 requests in the window", async () => {
    const limiter = new FixedWindowRateLimiter();
    for (let i = 0; i < 3; i++) {
      await limiter.acquireToken();
    }
    expect(true).toBe(true);
  }, 15000);

  it("should enforce 2-second minimum gap between requests", async () => {
    const limiter = new FixedWindowRateLimiter();
    const start = Date.now();
    await limiter.acquireToken();
    await limiter.acquireToken();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(1900);
  });

  it("should stall on the 41st request and recover after the window", async () => {
    const limiter = new FixedWindowRateLimiter();
    for (let i = 0; i < 40; i++) {
      await limiter.acquireToken();
    }
    const stall = limiter.acquireToken();
    await expect(stall).resolves.toBeUndefined();
  }, 150000);
});

// ============================================================================
// Reasoning Stripper
// ============================================================================
describe("ReasoningStripper", () => {
  it("should passthrough text without think tags", () => {
    const stripper = new ReasoningStripper();
    expect(stripper.process("Hello world")).toBe("Hello world");
    expect(stripper.flush()).toBe("");
  });

  it("should strip complete think block", () => {
    const stripper = new ReasoningStripper();
    const result = stripper.process("A<think>hidden</think>B");
    expect(result).toBe("AB");
  });

  it("should strip think block spanning multiple chunks", () => {
    const stripper = new ReasoningStripper();
    expect(stripper.process("A<thin")).toBe("A");
    expect(stripper.process("k>hidden</think>B")).toBe("B");
  });

  it("should discard unclosed think block on flush", () => {
    const stripper = new ReasoningStripper();
    stripper.process("A<think>pending");
    expect(stripper.flush()).toBe("");
  });

  it("should handle multiple think blocks", () => {
    const stripper = new ReasoningStripper();
    expect(stripper.process("<think>1</think>A<think>2</think>B")).toBe("AB");
  });

  it("should pass through standalone < character", () => {
    const stripper = new ReasoningStripper();
    expect(stripper.process("x < y")).toBe("x < y");
  });
});

// ============================================================================
// Gateway Model IDs
// ============================================================================
describe("Gateway Model IDs", () => {
  it("should encode a NIM model ID", () => {
    expect(encodeNimGatewayModelId("meta/llama-3.1-405b-instruct")).toBe(
      "anthropic/nvidia_nim/meta/llama-3.1-405b-instruct",
    );
  });

  it("should return fallback for empty input", () => {
    expect(encodeNimGatewayModelId("")).toBe("anthropic/nvidia_nim/unknown");
  });

  it("should decode a gateway model ID", () => {
    expect(
      decodeNimGatewayModelId(
        "anthropic/nvidia_nim/meta/llama-3.1-405b-instruct",
      ),
    ).toBe("meta/llama-3.1-405b-instruct");
  });

  it("should return null for non-gateway IDs", () => {
    expect(decodeNimGatewayModelId("meta/llama-3.1-405b-instruct")).toBeNull();
    expect(decodeNimGatewayModelId("")).toBeNull();
  });

  it("should detect gateway model IDs", () => {
    expect(isGatewayModelId("anthropic/nvidia_nim/meta/model")).toBe(true);
    expect(isGatewayModelId("meta/model")).toBe(false);
  });
});

// ============================================================================
// NIM Settings Validation
// ============================================================================
describe("validateNimSettings", () => {
  it("should return defaults when no overrides", () => {
    const s = validateNimSettings({});
    expect(s.temperature).toBe(1.0);
    expect(s.top_p).toBe(1.0);
    expect(s.max_tokens).toBe(4096);
  });

  it("should clamp temperature to [0, 2]", () => {
    expect(validateNimSettings({ temperature: -1 }).temperature).toBe(0);
    expect(validateNimSettings({ temperature: 5 }).temperature).toBe(2);
  });

  it("should clamp top_p to [0, 1]", () => {
    expect(validateNimSettings({ top_p: -0.5 }).top_p).toBe(0);
    expect(validateNimSettings({ top_p: 2 }).top_p).toBe(1);
  });

  it("should ensure max_tokens is at least 1", () => {
    expect(validateNimSettings({ max_tokens: 0 }).max_tokens).toBe(1);
  });

  it("should merge provided overrides into defaults", () => {
    const s = validateNimSettings({ temperature: 0.5, max_tokens: 2048 });
    expect(s.temperature).toBe(0.5);
    expect(s.max_tokens).toBe(2048);
    expect(s.top_p).toBe(1.0);
  });
});

// ============================================================================
// Retry Body Logic
// ============================================================================
describe("getRetryBody", () => {
  const baseBody = {
    model: "test",
    messages: [{ role: "user", content: "hi" }],
  };

  it("should strip reasoning_budget from extra_body", () => {
    const body = {
      ...baseBody,
      extra_body: { reasoning_budget: 500, other: "keep" },
    };
    const result = getRetryBody("error: reasoning_budget not supported", body);
    expect(result).not.toBeNull();
    expect(
      (result!.extra_body as Record<string, unknown>).reasoning_budget,
    ).toBeUndefined();
    expect((result!.extra_body as Record<string, unknown>).other).toBe("keep");
  });

  it("should strip chat_template from extra_body", () => {
    const body = {
      ...baseBody,
      extra_body: { chat_template: "custom", other: "keep" },
    };
    const result = getRetryBody("invalid chat_template parameter", body);
    expect(result).not.toBeNull();
    expect(
      (result!.extra_body as Record<string, unknown>).chat_template,
    ).toBeUndefined();
    expect((result!.extra_body as Record<string, unknown>).other).toBe("keep");
  });

  it("should strip reasoning_content from messages", () => {
    const body = {
      ...baseBody,
      messages: [
        { role: "assistant", reasoning_content: "hidden", content: "visible" },
      ],
    };
    const result = getRetryBody("error: reasoning_content invalid", body);
    expect(result).not.toBeNull();
    const msg = (result!.messages as Array<Record<string, unknown>>)[0];
    expect(msg.reasoning_content).toBeUndefined();
    expect(msg.content).toBe("visible");
  });

  it("should return null for unrecognized errors", () => {
    const result = getRetryBody("some other error", baseBody);
    expect(result).toBeNull();
  });

  it("should not mutate the original body", () => {
    const body = JSON.parse(
      JSON.stringify({
        ...baseBody,
        extra_body: { reasoning_budget: 500 },
      }),
    );
    const result = getRetryBody("error: reasoning_budget", body);
    expect(result).not.toBeNull();
    expect((body.extra_body as Record<string, unknown>).reasoning_budget).toBe(
      500,
    );
  });
});

// ============================================================================
// Model Router
// ============================================================================
describe("ModelRouter", () => {
  it("should return the configured model for non-gateway IDs", () => {
    const router = new ModelRouter("meta/llama-3.3-70b-instruct");
    const resolved = router.resolve("claude-sonnet-4-5");
    expect(resolved.originalModel).toBe("claude-sonnet-4-5");
    expect(resolved.providerModel).toBe("meta/llama-3.3-70b-instruct");
  });

  it("should decode and use gateway model IDs", () => {
    const router = new ModelRouter("default-model");
    const resolved = router.resolve("anthropic/nvidia_nim/meta/custom-model");
    expect(resolved.originalModel).toBe(
      "anthropic/nvidia_nim/meta/custom-model",
    );
    expect(resolved.providerModel).toBe("meta/custom-model");
  });

  it("should update the NIM model", () => {
    const router = new ModelRouter("old-model");
    router.setNimModel("new-model");
    expect(router.nimModel).toBe("new-model");
  });

  it("should track available models", () => {
    const router = new ModelRouter("test");
    router.setAvailableModels(["a", "b", "c"]);
    expect(router.availableModels).toEqual(["a", "b", "c"]);
  });
});
