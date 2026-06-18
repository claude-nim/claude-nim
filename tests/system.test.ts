// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
import * as http from "http";
import { startProxyServer, stopProxyServer } from "../src/server";

// We mock the API layer so the server doesn't actually hit NVIDIA NIM during tests.
jest.mock("../src/api", () => {
  return {
    fetchModels: jest.fn().mockResolvedValue([
      {
        id: "meta/llama-3.1-405b-instruct",
        object: "model",
        created: 1234,
        owned_by: "nvidia",
      },
    ]),
    fetchWithRetry: jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    }),
    streamChatCompletion: async function* () {
      yield {
        id: "test",
        object: "chat.completion.chunk",
        created: 1234,
        model: "test",
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: "Hello from NIM!" },
            finish_reason: null,
          },
        ],
      };
      yield {
        id: "test",
        object: "chat.completion.chunk",
        created: 1234,
        model: "test",
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
  };
});

describe("System End-to-End Test", () => {
  const PORT = 3457;

  beforeAll((done) => {
    startProxyServer(PORT, "test-api-key");
    setTimeout(done, 500); // give server time to start
  });

  afterAll(() => {
    stopProxyServer();
  });

  it("should serve /v1/models endpoint", (done) => {
    http.get(`http://127.0.0.1:${PORT}/v1/models`, (res) => {
      expect(res.statusCode).toBe(200);
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        const json = JSON.parse(data);
        expect(json.data.length).toBeGreaterThan(0);
        expect(json.data[0].type).toBe("model");
        expect(json.data[0].id).toBeDefined();
        done();
      });
    });
  });

  it("should stream SSE from /v1/messages", (done) => {
    const postData = JSON.stringify({
      model: "meta/llama-3.1-405b-instruct",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 100,
    });

    const req = http.request(
      `http://127.0.0.1:${PORT}/v1/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
          "x-api-key": "test-key",
        },
      },
      (res) => {
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-type"]).toBe("text/event-stream");

        let data = "";
        res.on("data", (chunk) => {
          data += chunk.toString();
        });
        res.on("end", () => {
          expect(data).toContain("event: message_start");
          expect(data).toContain("Hello from NIM!");
          expect(data).toContain("event: message_stop");
          done();
        });
      },
    );

    req.write(postData);
    req.end();
  });
});
