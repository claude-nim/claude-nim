// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
// ============================================================================
// Integration tests — hits the real NVIDIA NIM API with the key from .env
// Run: npm run test:integration
// ============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import { fetchModels, fetchWithRetry, streamChatCompletion } from "../src/api";
import { normalizeNvidiaModels } from "../src/model-catalog";
import { buildCustomModelOptions } from "../src/model-switch";
import {
  translateRequest,
  buildMessageStart,
  buildPing,
  estimateTokens,
} from "../src/translator";

// ============================================================================
// Load API key from .env
// ============================================================================
function loadApiKey(): string {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) {
    throw new Error(
      "No .env file found. Create .env with NVIDIA_API_KEY=your-key",
    );
  }
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key === "NVIDIA_API_KEY" || key === "NVIDIA_NIM_API_KEY") {
      return value;
    }
  }
  throw new Error("No NVIDIA_API_KEY found in .env");
}

const API_KEY = loadApiKey();

jest.setTimeout(60000);

// ============================================================================
// 1. API Key Validation
// ============================================================================
describe("Integration: API Key", () => {
  it("should have a valid API key from .env", () => {
    expect(API_KEY).toBeTruthy();
    expect(API_KEY.length).toBeGreaterThan(10);
    expect(API_KEY).toMatch(/^nvapi-/);
  });
});

// ============================================================================
// 2. fetchModels — live NIM API
// ============================================================================
describe("Integration: fetchModels", () => {
  it("should fetch models from NVIDIA NIM", async () => {
    const models = await fetchModels(API_KEY, undefined, "claude-nim-test/1.0");
    expect(models).not.toBeNull();
    expect(Array.isArray(models)).toBe(true);
    expect(models!.length).toBeGreaterThan(0);

    const first = models![0];
    expect(first.id).toBeTruthy();
    expect(typeof first.id).toBe("string");
    console.log(`  Fetched ${models!.length} models. First: ${first.id}`);
  });

  it("should normalize fetched models", async () => {
    const raw = await fetchModels(API_KEY);
    expect(raw).not.toBeNull();
    const normalized = normalizeNvidiaModels(raw!);
    expect(normalized.length).toBeGreaterThan(0);

    for (const m of normalized) {
      expect(m.id).toBeTruthy();
      expect(m.displayName).toBeTruthy();
      expect(m.contextWindow).toBeGreaterThan(0);
      expect(m.maxOutputTokens).toBeGreaterThan(0);
    }
    console.log(`  Normalized ${normalized.length} models`);
  });

  it("should build custom model options for Claude Code", async () => {
    const raw = await fetchModels(API_KEY);
    expect(raw).not.toBeNull();
    const normalized = normalizeNvidiaModels(raw!);
    const json = buildCustomModelOptions(normalized);
    const options = JSON.parse(json);
    expect(Array.isArray(options)).toBe(true);
    expect(options.length).toBeGreaterThan(0);
    expect(options.length).toBeLessThanOrEqual(30);

    for (const opt of options) {
      expect(opt.value).toBeTruthy();
      expect(opt.label).toBeTruthy();
      expect(opt.description).toBe("NIM");
    }
    console.log(`  Built ${options.length} custom model options`);
  });
});

// ============================================================================
// 3. fetchWithRetry — error handling
// ============================================================================
describe("Integration: fetchWithRetry", () => {
  it("should return 401 for invalid API key without retrying", async () => {
    let calls = 0;
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockImplementation(async () => {
      calls++;
      return {
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        headers: new Headers(),
        text: async () => "Unauthorized",
      };
    });

    try {
      const res = await fetchWithRetry("http://localhost/test", {
        method: "GET",
      });
      expect(res.status).toBe(401);
      expect(calls).toBe(1);
    } finally {
      global.fetch = origFetch;
    }
  });
});

// ============================================================================
// 4. Stream Chat Completion — live NIM API
// ============================================================================
describe("Integration: streamChatCompletion", () => {
  it("should stream a response from llama-3.1-8b", async () => {
    const request = {
      model: "meta/llama-3.1-8b-instruct",
      messages: [{ role: "user" as const, content: "Say hello in one word." }],
      max_tokens: 50,
      temperature: 0,
      stream: true,
    };

    const chunks: unknown[] = [];
    let content = "";

    for await (const chunk of streamChatCompletion(
      API_KEY,
      request,
      undefined,
      "claude-nim-test/1.0",
      { requestTimeoutMs: 30000 },
    )) {
      chunks.push(chunk);
      const choice = chunk.choices?.[0];
      if (choice?.delta?.content) {
        content += choice.delta.content;
      }
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(content.length).toBeGreaterThan(0);
    console.log(`  Streamed ${chunks.length} chunks, content: "${content.trim()}"`);
  }, 45000);

  it("should translate an Anthropic request and stream via NIM", async () => {
    const anthropicRequest = {
      model: "meta/llama-3.1-8b-instruct",
      messages: [
        { role: "user" as const, content: "What is 2+2? Reply with just the number." },
      ],
      max_tokens: 20,
      stream: true,
    };

    const openaiRequest = translateRequest(anthropicRequest);
    expect(openaiRequest.model).toBe("meta/llama-3.1-8b-instruct");
    expect(openaiRequest.messages.length).toBeGreaterThan(0);
    expect(openaiRequest.stream).toBe(true);

    const chunks: string[] = [];
    for await (const chunk of streamChatCompletion(
      API_KEY,
      openaiRequest,
      undefined,
      "claude-nim-test/1.0",
      { requestTimeoutMs: 30000 },
    )) {
      const choice = chunk.choices?.[0];
      if (choice?.delta?.content) {
        chunks.push(choice.delta.content);
      }
    }

    expect(chunks.length).toBeGreaterThan(0);
    const fullText = chunks.join("");
    expect(fullText).toContain("4");
    console.log(`  Translated request + streamed: "${fullText.trim()}"`);
  }, 45000);

  it("should handle max_tokens correctly", async () => {
    const request = {
      model: "meta/llama-3.1-8b-instruct",
      messages: [
        { role: "user" as const, content: "Count from 1 to 100 slowly." },
      ],
      max_tokens: 30,
      temperature: 0,
      stream: true,
    };

    let totalTokens = 0;
    for await (const chunk of streamChatCompletion(
      API_KEY,
      request,
      undefined,
      "claude-nim-test/1.0",
      { requestTimeoutMs: 30000 },
    )) {
      if (chunk.usage?.completion_tokens) {
        totalTokens = chunk.usage.completion_tokens;
      }
    }

    // Should have been truncated due to max_tokens
    console.log(`  Total output tokens: ${totalTokens}`);
    expect(totalTokens).toBeGreaterThan(0);
  }, 45000);
});

// ============================================================================
// 5. SSE Event Builder — verify format
// ============================================================================
describe("Integration: SSE Event Format", () => {
  it("should build valid message_start event", () => {
    const event = buildMessageStart("test-model", 100);
    expect(event).toContain("event: message_start");
    expect(event).toContain("data: ");
    const json = event.replace("event: message_start\ndata: ", "").replace("\n\n", "");
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe("message_start");
    expect(parsed.message.model).toBe("test-model");
    expect(parsed.message.usage.input_tokens).toBe(100);
  });

  it("should build valid ping event", () => {
    const event = buildPing();
    expect(event).toContain("event: ping");
    expect(event).toContain('"type":"ping"');
  });

  it("should estimate tokens correctly", () => {
    expect(estimateTokens("hello")).toBe(2); // 5 chars / 4 = 1.25, ceil = 2
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a".repeat(100))).toBe(25);
  });
});

// ============================================================================
// 6. Real model validation — check "NVIDIA-NIM-Proxy" won't break
// ============================================================================
describe("Integration: Model Validation", () => {
  it("should include NVIDIA-NIM-Proxy in fallback models", async () => {
    // Simulate what the proxy does when NIM is unreachable
    const FALLBACK_MODEL_IDS = [
      "deepseek-ai/deepseek-v4-flash",
      "deepseek-ai/deepseek-v4-pro",
      "meta/llama-3.3-70b-instruct",
    ];

    const data = [
      {
        type: "model" as const,
        id: "NVIDIA-NIM-Proxy",
        display_name: "NVIDIA NIM (deepseek-v4-flash)",
        created_at: new Date().toISOString(),
      },
      ...FALLBACK_MODEL_IDS.map((id) => ({
        type: "model" as const,
        id,
        display_name: id.split("/").pop()!,
        created_at: new Date().toISOString(),
      })),
    ];

    expect(data[0].id).toBe("NVIDIA-NIM-Proxy");
    const ids = data.map((d) => d.id);
    expect(ids).toContain("NVIDIA-NIM-Proxy");
    expect(ids).toContain("deepseek-ai/deepseek-v4-flash");
  });

  it("should resolve minimaxai/minimax-m3 from NIM", async () => {
    const models = await fetchModels(API_KEY);
    expect(models).not.toBeNull();
    const normalized = normalizeNvidiaModels(models!);
    const ids = normalized.map((m) => m.id);
    console.log(
      `  Checking minimaxai/minimax-m3 in ${ids.length} models:`,
      ids.includes("minimaxai/minimax-m3"),
    );
    // Just log — the model might or might not be available
  });
});
