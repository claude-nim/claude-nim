// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
import * as http from "http";
import { startProxyServer, stopProxyServer } from "../src/server";

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.setTimeout(60000); // 60s timeout for stress test

jest.mock("../src/api", () => {
  return {
    fetchModels: jest.fn().mockResolvedValue([]),
    fetchWithRetry: jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    }),
    streamChatCompletion: async function* (
      apiKey: string,
      req: any,
      signal: AbortSignal,
    ) {
      // Simulate an infinite stream that stays open until aborted
      try {
        while (!signal.aborted) {
          yield {
            id: "stress",
            object: "chat.completion.chunk",
            created: 1234,
            model: "test",
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "." },
                finish_reason: null,
              },
            ],
          };
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      } finally {
        // Stream aborted cleanup
      }
    },
  };
});

describe("Stress Test & Graceful Shutdown", () => {
  const PORT = 3458;
  const CONCURRENT_CONNECTIONS = 100;

  beforeAll((done) => {
    startProxyServer(PORT, "test-api-key");
    setTimeout(done, 500);
  });

  afterAll(() => {
    stopProxyServer();
  });

  it("should handle 100 concurrent SSE streams and cleanly kill them all on stopProxyServer", async () => {
    const postData = JSON.stringify({
      model: "meta/llama-3.1-405b-instruct",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 100,
    });

    const requests: http.ClientRequest[] = [];
    const responses: http.IncomingMessage[] = [];

    // Spin up connections
    for (let i = 0; i < CONCURRENT_CONNECTIONS; i++) {
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
          // Consume data so the 'end' event fires
          res.on("data", () => {});
          responses.push(res);
        },
      );
      req.write(postData);
      req.end();
      requests.push(req);
    }

    // Wait until all responses have received headers and started streaming
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (responses.length === CONCURRENT_CONNECTIONS) {
          clearInterval(check);
          resolve();
        }
      }, 50);
    });

    expect(responses.length).toBe(CONCURRENT_CONNECTIONS);

    // Verify all responses close
    const closedPromises = responses.map(
      (res) =>
        new Promise<void>((resolve) => {
          const onDone = () => {
            resolve();
          };
          if (res.complete) {
            onDone();
          } else {
            res.on("close", onDone);
            res.on("end", onDone);
            res.on("error", onDone);
          }
        }),
    );

    // Call stopProxyServer, which should trigger AbortControllers and close all streams instantly
    stopProxyServer();

    await Promise.all(closedPromises);

    console.log("Done!");

    // If we reach here, it means all 100 connections were cleanly aborted!
    expect(true).toBe(true);
  });
});
