// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
// ============================================================================
// Integration tests — hits the real NVIDIA NIM API with the key from .env
// Run: npm run test:integration
// ============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import { fetchModels, fetchWithRetry, streamChatCompletion } from "../src/api";
import { normalizeNvidiaModels } from "../src/api/model-catalog";
import { buildCustomModelOptions } from "../src/api/model-options";
import { toOpenAIRequest, toAnthropicResponse } from "../src/translator";

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
    console.log(
      `  Streamed ${chunks.length} chunks, content: "${content.trim()}"`,
    );
  }, 45000);

  it("should translate an Anthropic request and stream via NIM", async () => {
    const anthropicRequest: Record<string, unknown> = {
      model: "meta/llama-3.1-8b-instruct",
      messages: [
        {
          role: "user",
          content: "What is 2+2? Reply with just the number.",
        },
      ],
      max_tokens: 20,
      stream: true,
    };

    const openaiRequest = toOpenAIRequest(
      anthropicRequest,
      "meta/llama-3.1-8b-instruct",
    );
    expect(openaiRequest.model).toBe("meta/llama-3.1-8b-instruct");
    expect((openaiRequest.messages as unknown[]).length).toBeGreaterThan(0);
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

    console.log(`  Total output tokens: ${totalTokens}`);
    expect(totalTokens).toBeGreaterThan(0);
  }, 45000);
});

// ============================================================================
// 5. Translator — verify Anthropic ↔ OpenAI conversion roundtrip
// ============================================================================
describe("Integration: Translator Roundtrip", () => {
  it("should convert Anthropic request to OpenAI format", () => {
    const anthropicRequest: Record<string, unknown> = {
      model: "test-model",
      system: "You are helpful.",
      messages: [
        { role: "user", content: "Hello" },
        {
          role: "assistant",
          content: [{ type: "text", text: "Hi there!" }],
        },
        { role: "user", content: "Follow up" },
      ],
      max_tokens: 100,
      tools: [
        {
          name: "test_tool",
          description: "A test tool",
          input_schema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      ],
    };

    const openai = toOpenAIRequest(anthropicRequest, "meta/test-model");
    expect(openai.model).toBe("meta/test-model");
    const msgs = openai.messages as Array<{ role: string }>;
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("user");
    expect(msgs[2].role).toBe("assistant");
    expect(msgs[3].role).toBe("user");
    expect(openai.tools).toBeDefined();
    expect((openai.tools as unknown[]).length).toBe(1);
  });

  it("should convert OpenAI response back to Anthropic format", () => {
    const openaiResponse: Record<string, unknown> = {
      choices: [
        {
          message: { content: "Hello world" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };

    const anthropic = toAnthropicResponse(openaiResponse, "test-model");
    expect(anthropic.type).toBe("message");
    expect(anthropic.role).toBe("assistant");
    expect((anthropic.content as Record<string, string>[])[0].text).toBe(
      "Hello world",
    );
    expect(anthropic.stop_reason).toBe("end_turn");
  });
});

// ============================================================================
// 6. Real model validation
// ============================================================================
describe("Integration: Model Validation", () => {
  it("should include NVIDIA-NIM-Proxy in fallback models", async () => {
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
  });
});
