// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
import * as http from "http";
import { startProxyServer, stopProxyServer } from "../src/server";
import { state } from "../src/server/proxy-state";

jest.setTimeout(30000);

// Mock the API module so models-handler.ts gets fake data
jest.mock("../src/api", () => {
  const mockModels = [
    { id: "meta/llama-3.1-405b-instruct" },
    { id: "deepseek-ai/deepseek-v4-flash" },
    { id: "minimaxai/minimax-m3" },
  ];
  return {
    fetchModels: jest.fn().mockResolvedValue(mockModels),
    fetchWithRetry: jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    }),
    streamChatCompletion: jest.fn(),
  };
});

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function httpGet(url: string): Promise<{
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
}> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () =>
          resolve({
            status: res.statusCode!,
            body: data,
            headers: res.headers,
          }),
        );
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

function httpPost(
  url: string,
  body: string,
  headers?: Record<string, string>,
): Promise<{
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
}> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () =>
          resolve({
            status: res.statusCode!,
            body: data,
            headers: res.headers,
          }),
        );
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function httpOptions(
  url: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: "OPTIONS",
      },
      (res) => {
        let d = "";
        res.on("data", (c: Buffer) => (d += c.toString()));
        res.on("end", () =>
          resolve({ status: res.statusCode!, headers: res.headers }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Fake NIM response builder
// ---------------------------------------------------------------------------
function fakeNimChunk(content: string, finish: string | null): string {
  const data = JSON.stringify({
    id: "chatcmpl-123",
    object: "chat.completion.chunk",
    created: Date.now(),
    model: "test",
    choices: [
      {
        index: 0,
        delta: content ? { role: "assistant", content } : {},
        finish_reason: finish,
      },
    ],
  });
  return `data: ${data}\n\n`;
}

function fakeNimDone(): string {
  return "data: [DONE]\n\n";
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Proxy Server", () => {
  const PORT = 3461;
  const BASE = `http://127.0.0.1:${PORT}`;
  let origFetch: typeof global.fetch;

  beforeAll(async () => {
    origFetch = global.fetch;
    global.fetch = jest
      .fn()
      .mockImplementation(
        async (url: string, init?: RequestInit): Promise<Response> => {
          if (typeof url === "string" && url.includes("/chat/completions")) {
            const body = init?.body ? JSON.parse(init.body as string) : {};
            const isStream = body.stream !== false;

            if (isStream) {
              const encoder = new TextEncoder();
              const stream = new ReadableStream({
                async start(controller) {
                  controller.enqueue(
                    encoder.encode(fakeNimChunk("Hello", null)),
                  );
                  controller.enqueue(
                    encoder.encode(fakeNimChunk(" world", "stop")),
                  );
                  controller.enqueue(encoder.encode(fakeNimDone()));
                  controller.close();
                },
              });
              return new Response(stream, {
                status: 200,
                headers: { "Content-Type": "text/event-stream" },
              });
            }

            const json = JSON.stringify({
              id: "chatcmpl-123",
              object: "chat.completion",
              created: Date.now(),
              model: body.model || "test",
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: "Hello world",
                  },
                  finish_reason: "stop",
                },
              ],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 3,
                total_tokens: 13,
              },
            });
            return new Response(json, {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response("Not found", { status: 404 });
        },
      ) as unknown as typeof fetch;

    startProxyServer(PORT, "test-api-key-123", "deepseek-ai/deepseek-v4-flash");
    await new Promise((r) => setTimeout(r, 500));
  });

  afterAll(() => {
    stopProxyServer();
    global.fetch = origFetch;
  });

  // ========================================================================
  // Health
  // ========================================================================
  describe("Health", () => {
    it("GET /health returns 200", async () => {
      const res = await httpGet(`${BASE}/health`);
      expect(res.status).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.status).toBe("ok");
      expect(json.model).toBe("deepseek-ai/deepseek-v4-flash");
    });
  });

  // ========================================================================
  // CORS
  // ========================================================================
  describe("CORS", () => {
    it("OPTIONS /v1/messages returns 204", async () => {
      const res = await httpOptions(`${BASE}/v1/messages`);
      expect(res.status).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe("*");
    });
  });

  // ========================================================================
  // /v1/models
  // ========================================================================
  describe("GET /v1/models", () => {
    it("returns model list with gateway IDs", async () => {
      const res = await httpGet(`${BASE}/v1/models`);
      expect(res.status).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.object).toBe("list");
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data.length).toBeGreaterThan(0);

      const ids = json.data.map((m: any) => m.id);
      expect(ids).toContain(
        "anthropic/nvidia_nim/meta/llama-3.1-405b-instruct",
      );

      const gatewayId = ids.find((id: string) => id.startsWith("anthropic/"));
      expect(gatewayId).toBeTruthy();
    });

    it("includes first_id and last_id", async () => {
      const res = await httpGet(`${BASE}/v1/models`);
      const json = JSON.parse(res.body);
      expect(json.first_id).toBeTruthy();
      expect(json.last_id).toBeTruthy();
      expect(json.has_more).toBe(false);
    });

    it("caches results across calls", async () => {
      const r1 = await httpGet(`${BASE}/v1/models`);
      const r2 = await httpGet(`${BASE}/v1/models`);
      expect(JSON.parse(r1.body).data.length).toBe(
        JSON.parse(r2.body).data.length,
      );
    });
  });

  // ========================================================================
  // /v1/messages — streaming
  // ========================================================================
  describe("POST /v1/messages (streaming)", () => {
    it("returns SSE stream with message events", (done) => {
      const postData = JSON.stringify({
        model: "deepseek-ai/deepseek-v4-flash",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 100,
      });

      const req = http.request(
        `${BASE}/v1/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(postData),
          },
        },
        (res) => {
          expect(res.statusCode).toBe(200);
          expect(res.headers["content-type"]).toBe("text/event-stream");

          let data = "";
          res.on("data", (chunk: Buffer) => (data += chunk.toString()));
          res.on("end", () => {
            expect(data).toContain("event: message_start");
            expect(data).toContain("event: message_delta");
            expect(data).toContain("event: message_stop");
            expect(data).toContain('"model":"test"');
            done();
          });
        },
      );
      req.write(postData);
      req.end();
    });

    it("returns 400 for invalid JSON", async () => {
      const res = await httpPost(`${BASE}/v1/messages`, "not-json");
      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // /v1/messages — non-streaming
  // ========================================================================
  describe("POST /v1/messages (non-streaming)", () => {
    it("returns JSON response", async () => {
      const postData = JSON.stringify({
        model: "deepseek-ai/deepseek-v4-flash",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 50,
        stream: false,
      });

      const res = await httpPost(`${BASE}/v1/messages`, postData);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("application/json");
      const json = JSON.parse(res.body);
      expect(json.type).toBe("message");
      expect(json.content[0].text).toBe("Hello world");
    });
  });

  // ========================================================================
  // /v1/messages/count_tokens
  // ========================================================================
  describe("POST /v1/messages/count_tokens", () => {
    it("returns token count", async () => {
      const res = await httpPost(
        `${BASE}/v1/messages/count_tokens`,
        JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      );
      expect(res.status).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.input_tokens).toBe(8);
    });
  });

  // ========================================================================
  // /api/model
  // ========================================================================
  describe("/api/model", () => {
    it("GET returns current model", async () => {
      const res = await httpGet(`${BASE}/api/model`);
      expect(res.status).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.model).toBe(
        "anthropic/nvidia_nim/deepseek-ai/deepseek-v4-flash",
      );
    });

    it("POST changes the model", async () => {
      const res = await httpPost(
        `${BASE}/api/model`,
        JSON.stringify({ model: "meta/llama-3.1-405b-instruct" }),
      );
      expect(res.status).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.ok).toBe(true);
      expect(json.model).toBe("meta/llama-3.1-405b-instruct");

      const check = await httpGet(`${BASE}/api/model`);
      expect(JSON.parse(check.body).model).toBe(
        "anthropic/nvidia_nim/meta/llama-3.1-405b-instruct",
      );
    });

    it("POST with empty body returns 400", async () => {
      const res = await httpPost(`${BASE}/api/model`, JSON.stringify({}));
      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // /api/key
  // ========================================================================
  describe("/api/key", () => {
    it("POST updates the API key", async () => {
      const res = await httpPost(
        `${BASE}/api/key`,
        JSON.stringify({ apiKey: "new-key-456" }),
      );
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body).ok).toBe(true);
    });

    it("POST without key returns 400", async () => {
      const res = await httpPost(`${BASE}/api/key`, JSON.stringify({}));
      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // /api/stats
  // ========================================================================
  describe("/api/stats", () => {
    it("returns stats object", async () => {
      const res = await httpGet(`${BASE}/api/stats`);
      expect(res.status).toBe(200);
      const json = JSON.parse(res.body);
      expect(typeof json.totalRequests).toBe("number");
      expect(typeof json.totalTokens).toBe("number");
      expect(typeof json.avgLatencyMs).toBe("number");
      expect(typeof json.uptimeMs).toBe("number");
    });
  });

  // ========================================================================
  // /api/models (dashboard endpoint)
  // ========================================================================
  describe("/api/models", () => {
    it("returns model list", async () => {
      const res = await httpGet(`${BASE}/api/models`);
      expect(res.status).toBe(200);
      const json = JSON.parse(res.body);
      expect(Array.isArray(json)).toBe(true);
    });
  });

  // ========================================================================
  // Dashboard
  // ========================================================================
  describe("Dashboard", () => {
    it("GET /dashboard returns HTML", async () => {
      const res = await httpGet(`${BASE}/dashboard`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.body).toContain("<!DOCTYPE html>");
    });

    it("GET /dashboard-client.js returns JavaScript", async () => {
      const res = await httpGet(`${BASE}/dashboard-client.js`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("javascript");
    });
  });

  // ========================================================================
  // activeStreams tracking
  // ========================================================================
  describe("activeStreams", () => {
    it("should track and clean up streaming connections", async () => {
      const postData = JSON.stringify({
        model: "deepseek-ai/deepseek-v4-flash",
        messages: [{ role: "user", content: "Count" }],
        max_tokens: 50,
      });

      const initialCount = state.activeStreams.size;
      const req = http.request(
        `${BASE}/v1/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(postData),
          },
        },
        () => {},
      );
      req.write(postData);
      req.end();

      await new Promise((r) => setTimeout(r, 200));
      const afterCount = state.activeStreams.size;
      expect(afterCount).toBe(initialCount);
    });
  });

  // ========================================================================
  // 404
  // ========================================================================
  describe("Unknown routes", () => {
    it("returns 404 for unknown paths", async () => {
      const res = await httpGet(`${BASE}/unknown-route`);
      expect(res.status).toBe(404);
    });
  });
});
