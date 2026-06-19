// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
// ============================================================================
// Proxy integration test — full server lifecycle with mocked API
// ============================================================================
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { startProxyServer, stopProxyServer } from "../src/server";

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.setTimeout(30000);

jest.mock("../src/api", () => {
  const mockModels = [
    { id: "meta/llama-3.1-405b-instruct", object: "model", created: 1234, owned_by: "nvidia" },
    { id: "deepseek-ai/deepseek-v4-flash", object: "model", created: 1234, owned_by: "nvidia" },
    { id: "minimaxai/minimax-m3", object: "model", created: 1234, owned_by: "nvidia" },
  ];
  return {
    fetchModels: jest.fn().mockResolvedValue(mockModels),
    streamChatCompletion: jest.fn().mockImplementation(
      async function* (apiKey: string, req: any, signal?: AbortSignal) {
        yield {
          id: "test-stream",
          object: "chat.completion.chunk",
          created: 1234,
          model: req.model || "test",
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "Hello from mock!" },
              finish_reason: null,
            },
          ],
        };
        yield {
          id: "test-stream",
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
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };
      },
    ),
  };
});

function httpGet(url: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode!, body: data, headers: res.headers }));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function httpPost(url: string, body: string, headers?: Record<string, string>): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode!, body: data, headers: res.headers }));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

describe("Proxy Server — Full Lifecycle", () => {
  const PORT = 3459;
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll((done) => {
    startProxyServer(PORT, "test-api-key-123", "deepseek-ai/deepseek-v4-flash");
    setTimeout(done, 600);
  });

  afterAll(() => {
    stopProxyServer();
  });

  // ========================================================================
  // Health
  // ========================================================================
  it("GET / should return 200 with status ok", async () => {
    const res = await httpGet(`${BASE}/`);
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.status).toBe("ok");
    expect(json.service).toBe("Claude-NIM Proxy");
  });

  it("GET /health should return 200", async () => {
    const res = await httpGet(`${BASE}/health`);
    expect(res.status).toBe(200);
  });

  it("GET /unknown-route should return 404", async () => {
    const res = await httpGet(`${BASE}/unknown`);
    expect(res.status).toBe(404);
  });

  // ========================================================================
  // CORS
  // ========================================================================
  it("OPTIONS should return 204 with CORS headers", async () => {
    const res = await new Promise<{ status: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      const parsed = new URL(`${BASE}/v1/messages`);
      const req = http.request(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname,
          method: "OPTIONS",
        },
        (r) => {
          let d = "";
          r.on("data", (c) => (d += c));
          r.on("end", () => resolve({ status: r.statusCode!, headers: r.headers }));
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  // ========================================================================
  // /v1/models
  // ========================================================================
  it("GET /v1/models should return model list with NVIDIA-NIM-Proxy", async () => {
    const res = await httpGet(`${BASE}/v1/models`);
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.data).toBeDefined();
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBeGreaterThan(0);

    const ids = json.data.map((m: any) => m.id);
    expect(ids).toContain("NVIDIA-NIM-Proxy");
    expect(ids).toContain("deepseek-ai/deepseek-v4-flash");
  });

  it("GET /v1/models should cache results", async () => {
    const res1 = await httpGet(`${BASE}/v1/models`);
    const res2 = await httpGet(`${BASE}/v1/models`);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    const j1 = JSON.parse(res1.body);
    const j2 = JSON.parse(res2.body);
    expect(j1.data.length).toBe(j2.data.length);
  });

  // ========================================================================
  // /v1/messages — stream
  // ========================================================================
  it("POST /v1/messages should stream SSE response", (done) => {
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
        res.on("data", (chunk) => (data += chunk.toString()));
        res.on("end", () => {
          expect(data).toContain("event: message_start");
          expect(data).toContain("Hello from mock!");
          expect(data).toContain("event: message_stop");
          done();
        });
      },
    );
    req.write(postData);
    req.end();
  });

  // ========================================================================
  // /v1/messages — model override
  // ========================================================================
  it("should override model when NVIDIA-NIM-Proxy is sent", (done) => {
    const postData = JSON.stringify({
      model: "NVIDIA-NIM-Proxy",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 50,
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
        let data = "";
        res.on("data", (chunk) => (data += chunk.toString()));
        res.on("end", () => {
          expect(data).toContain("event: message_start");
          done();
        });
      },
    );
    req.write(postData);
    req.end();
  });

  // ========================================================================
  // /v1/messages — no model should 400
  // ========================================================================
  it("should use default model when model is missing", async () => {
    const postData = JSON.stringify({
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 50,
    });
    const res = await httpPost(`${BASE}/v1/messages`, postData);
    expect(res.status).toBe(200);
  });

  // ========================================================================
  // /api/status
  // ========================================================================
  it("GET /api/status should return running status", async () => {
    const res = await httpGet(`${BASE}/api/status`);
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.running).toBe(true);
    expect(json.port).toBe(PORT);
    expect(json.model).toBe("deepseek-ai/deepseek-v4-flash");
    expect(json.hasApiKey).toBe(true);
  });

  // ========================================================================
  // /api/model — GET and POST
  // ========================================================================
  it("GET /api/model should return current model", async () => {
    const res = await httpGet(`${BASE}/api/model`);
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.model).toBe("deepseek-ai/deepseek-v4-flash");
  });

  it("POST /api/model should change the model", async () => {
    const res = await httpPost(`${BASE}/api/model`, JSON.stringify({ model: "meta/llama-3.1-405b-instruct" }));
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.ok).toBe(true);
    expect(json.model).toBe("meta/llama-3.1-405b-instruct");

    // Verify it changed
    const check = await httpGet(`${BASE}/api/model`);
    const checkJson = JSON.parse(check.body);
    expect(checkJson.model).toBe("meta/llama-3.1-405b-instruct");
  });

  it("POST /api/model with empty string should reset", async () => {
    await httpPost(`${BASE}/api/model`, JSON.stringify({ model: "test-reset" }));
    const res = await httpPost(`${BASE}/api/model`, JSON.stringify({ model: "" }));
    expect(res.status).toBe(200);
  });

  // ========================================================================
  // /api/key
  // ========================================================================
  it("POST /api/key should update the API key", async () => {
    const res = await httpPost(`${BASE}/api/key`, JSON.stringify({ apiKey: "new-key-456" }));
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.ok).toBe(true);
  });

  it("POST /api/key without key should return 400", async () => {
    const res = await httpPost(`${BASE}/api/key`, JSON.stringify({}));
    expect(res.status).toBe(400);
  });

  // ========================================================================
  // /api/stats
  // ========================================================================
  it("GET /api/stats should return stats", async () => {
    const res = await httpGet(`${BASE}/api/stats`);
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(typeof json.totalRequests).toBe("number");
    expect(typeof json.totalTokens).toBe("number");
    expect(typeof json.avgLatencyMs).toBe("number");
    expect(typeof json.uptimeMs).toBe("number");
  });

  // ========================================================================
  // /api/metrics/history
  // ========================================================================
  it("GET /api/metrics/history should return array", async () => {
    const res = await httpGet(`${BASE}/api/metrics/history`);
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(Array.isArray(json)).toBe(true);
  });

  // ========================================================================
  // /dashboard
  // ========================================================================
  it("GET /dashboard should return HTML", async () => {
    const res = await httpGet(`${BASE}/dashboard`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("<!DOCTYPE html>");
  });

  it("GET /dashboard-client.js should return JavaScript", async () => {
    const res = await httpGet(`${BASE}/dashboard-client.js`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("javascript");
  });

  // ========================================================================
  // /api/models (dashboard endpoint)
  // ========================================================================
  it("GET /api/models should return model list", async () => {
    const res = await httpGet(`${BASE}/api/models`);
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(Array.isArray(json)).toBe(true);
    expect(json.length).toBeGreaterThan(0);
  });
});
