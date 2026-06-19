// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
// ============================================================================
// Server routes — unit tests for every endpoint and edge case
// ============================================================================
import * as http from "http";
import { startProxyServer, stopProxyServer } from "../src/server";

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.setTimeout(15000);

jest.mock("../src/api", () => {
  return {
    fetchModels: jest.fn().mockResolvedValue([
      { id: "meta/llama-3.1-405b-instruct", object: "model", created: 1234, owned_by: "nvidia" },
      { id: "deepseek-ai/deepseek-v4-flash", object: "model", created: 1234, owned_by: "nvidia" },
    ]),
    fetchWithRetry: jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    }),
    streamChatCompletion: jest.fn().mockImplementation(
      async function* (apiKey: string, req: any, signal?: AbortSignal) {
        yield {
          id: "mock-stream",
          object: "chat.completion.chunk",
          created: 1234,
          model: req.model || "test",
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "Test response" },
              finish_reason: null,
            },
          ],
        };
        yield {
          id: "mock-stream",
          object: "chat.completion.chunk",
          created: 1234,
          model: req.model || "test",
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        };
      },
    ),
  };
});

function get(url: string): Promise<{ status: number; body: string; headers: any }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode!, body: data, headers: res.headers }));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function post(url: string, body: string, headers?: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          ...headers,
        },
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve({ status: res.statusCode!, body: d }));
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function options(url: string): Promise<{ status: number; headers: any }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: "OPTIONS" },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("Server Routes", () => {
  const PORT = 3460;
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll((done) => {
    startProxyServer(PORT, "test-key", "deepseek-ai/deepseek-v4-flash");
    setTimeout(done, 500);
  });

  afterAll(() => stopProxyServer());

  // ==========================================================================
  // Health
  // ==========================================================================
  describe("Health", () => {
    it("GET / returns 200", async () => {
      const r = await get(`${BASE}/`);
      expect(r.status).toBe(200);
      expect(JSON.parse(r.body).status).toBe("ok");
    });

    it("GET /health returns 200", async () => {
      const r = await get(`${BASE}/health`);
      expect(r.status).toBe(200);
    });
  });

  // ==========================================================================
  // CORS
  // ==========================================================================
  describe("CORS", () => {
    it("OPTIONS returns 204 with CORS headers", async () => {
      const r = await options(`${BASE}/v1/messages`);
      expect(r.status).toBe(204);
      expect(r.headers["access-control-allow-origin"]).toBe("*");
      expect(r.headers["access-control-allow-methods"]).toContain("POST");
    });
  });

  // ==========================================================================
  // /v1/models
  // ==========================================================================
  describe("GET /v1/models", () => {
    it("returns model list with NVIDIA-NIM-Proxy", async () => {
      const r = await get(`${BASE}/v1/models`);
      expect(r.status).toBe(200);
      const j = JSON.parse(r.body);
      expect(j.data.length).toBeGreaterThan(0);
      const ids = j.data.map((m: any) => m.id);
      expect(ids).toContain("NVIDIA-NIM-Proxy");
      expect(ids).toContain("deepseek-ai/deepseek-v4-flash");
    });

    it("includes first_id and last_id", async () => {
      const r = await get(`${BASE}/v1/models`);
      const j = JSON.parse(r.body);
      expect(j.first_id).toBeTruthy();
      expect(j.last_id).toBeTruthy();
    });

    it("caches results", async () => {
      const r1 = await get(`${BASE}/v1/models`);
      const r2 = await get(`${BASE}/v1/models`);
      expect(JSON.parse(r1.body).data.length).toBe(JSON.parse(r2.body).data.length);
    });
  });

  // ==========================================================================
  // /v1/messages
  // ==========================================================================
  describe("POST /v1/messages", () => {
    it("streams SSE on valid request", (done) => {
      const body = JSON.stringify({
        model: "deepseek-ai/deepseek-v4-flash",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 100,
      });
      const req = http.request(
        `${BASE}/v1/messages`,
        { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
        (res) => {
          expect(res.statusCode).toBe(200);
          expect(res.headers["content-type"]).toBe("text/event-stream");
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            expect(data).toContain("event: message_start");
            expect(data).toContain("Test response");
            expect(data).toContain("event: message_stop");
            done();
          });
        },
      );
      req.write(body);
      req.end();
    });

    it("uses default model when model is missing", async () => {
      const body = JSON.stringify({ messages: [{ role: "user", content: "Hi" }], max_tokens: 50 });
      const r = await post(`${BASE}/v1/messages`, body);
      expect(r.status).toBe(200);
    });

    it("returns 400 for invalid JSON", async () => {
      const r = await post(`${BASE}/v1/messages`, "not-json");
      expect(r.status).toBe(400);
    });

    it("overrides NVIDIA-NIM-Proxy model name", (done) => {
      const body = JSON.stringify({
        model: "NVIDIA-NIM-Proxy",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 50,
      });
      const req = http.request(
        `${BASE}/v1/messages`,
        { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            expect(data).toContain("event: message_start");
            done();
          });
        },
      );
      req.write(body);
      req.end();
    });

    it("overrides Claude model names with default model", (done) => {
      const body = JSON.stringify({
        model: "claude-opus-4-8",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 50,
      });
      const req = http.request(
        `${BASE}/v1/messages`,
        { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            expect(data).toContain("event: message_start");
            done();
          });
        },
      );
      req.write(body);
      req.end();
    });
  });

  // ==========================================================================
  // /api/status
  // ==========================================================================
  describe("GET /api/status", () => {
    it("returns running status", async () => {
      const r = await get(`${BASE}/api/status`);
      const j = JSON.parse(r.body);
      expect(j.running).toBe(true);
      expect(j.port).toBe(PORT);
      expect(j.hasApiKey).toBe(true);
    });
  });

  // ==========================================================================
  // /api/model
  // ==========================================================================
  describe("/api/model", () => {
    it("GET returns current model", async () => {
      const r = await get(`${BASE}/api/model`);
      expect(JSON.parse(r.body).model).toBe("deepseek-ai/deepseek-v4-flash");
    });

    it("POST changes model", async () => {
      const r = await post(`${BASE}/api/model`, JSON.stringify({ model: "meta/llama-3.1-405b-instruct" }));
      expect(r.status).toBe(200);
      expect(JSON.parse(r.body).ok).toBe(true);
    });

    it("POST with empty string resets model", async () => {
      await post(`${BASE}/api/model`, JSON.stringify({ model: "temp" }));
      const r = await post(`${BASE}/api/model`, JSON.stringify({ model: "" }));
      expect(r.status).toBe(200);
    });

    it("POST without model returns 400", async () => {
      const r = await post(`${BASE}/api/model`, JSON.stringify({}));
      expect(r.status).toBe(400);
    });
  });

  // ==========================================================================
  // /api/key
  // ==========================================================================
  describe("POST /api/key", () => {
    it("updates API key", async () => {
      const r = await post(`${BASE}/api/key`, JSON.stringify({ apiKey: "new-key" }));
      expect(r.status).toBe(200);
      expect(JSON.parse(r.body).ok).toBe(true);
    });

    it("returns 400 without key", async () => {
      const r = await post(`${BASE}/api/key`, JSON.stringify({}));
      expect(r.status).toBe(400);
    });
  });

  // ==========================================================================
  // /api/stats
  // ==========================================================================
  describe("GET /api/stats", () => {
    it("returns stats object", async () => {
      const r = await get(`${BASE}/api/stats`);
      const j = JSON.parse(r.body);
      expect(typeof j.totalRequests).toBe("number");
      expect(typeof j.totalTokens).toBe("number");
      expect(typeof j.avgLatencyMs).toBe("number");
      expect(typeof j.uptimeMs).toBe("number");
      expect(j.uptimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // /api/metrics/history
  // ==========================================================================
  describe("GET /api/metrics/history", () => {
    it("returns array", async () => {
      const r = await get(`${BASE}/api/metrics/history`);
      expect(r.status).toBe(200);
      expect(Array.isArray(JSON.parse(r.body))).toBe(true);
    });
  });

  // ==========================================================================
  // /dashboard
  // ==========================================================================
  describe("Dashboard", () => {
    it("GET /dashboard returns HTML", async () => {
      const r = await get(`${BASE}/dashboard`);
      expect(r.status).toBe(200);
      expect(r.headers["content-type"]).toContain("text/html");
      expect(r.body).toContain("<!DOCTYPE html>");
    });

    it("GET /dashboard-client.js returns JS", async () => {
      const r = await get(`${BASE}/dashboard-client.js`);
      expect(r.status).toBe(200);
      expect(r.headers["content-type"]).toContain("javascript");
    });
  });

  // ==========================================================================
  // 404
  // ==========================================================================
  describe("404", () => {
    it("returns 404 for unknown routes", async () => {
      const r = await get(`${BASE}/v1/unknown`);
      expect(r.status).toBe(404);
      const j = JSON.parse(r.body);
      expect(j.type).toBe("error");
      expect(j.error.type).toBe("not_found_error");
    });
  });
});
