// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
import { fetchWithRetry } from "../src/api";
import { buildCustomModelOptions } from "../src/api/model-options";

// ============================================================================
// fetchWithRetry
// ============================================================================
describe("fetchWithRetry", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it("should retry on 429 rate limit and succeed on second attempt", async () => {
    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: false,
          status: 429,
          headers: new Headers({ "retry-after": "0" }),
          text: async () => "Rate limited",
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      };
    });

    const response = await fetchWithRetry("http://localhost/test", {
      method: "GET",
    });
    expect(callCount).toBe(2);
    expect(response.ok).toBe(true);
  });

  it("should return immediately on 401 without retrying", async () => {
    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      return {
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      };
    });

    const response = await fetchWithRetry("http://localhost/test", {
      method: "GET",
    });
    expect(response.status).toBe(401);
    expect(callCount).toBe(1);
  });

  it("should retry on 503 server error", async () => {
    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      return {
        ok: false,
        status: 503,
        text: async () => "Service Unavailable",
      };
    });

    await expect(
      fetchWithRetry("http://localhost/test", { method: "GET" }, 3),
    ).rejects.toThrow();
    expect(callCount).toBe(3);
  });

  it("should abort when signal is aborted externally", async () => {
    const controller = new AbortController();
    mockFetch.mockImplementation(
      () =>
        new Promise((_, reject) => {
          controller.signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );

    const promise = fetchWithRetry(
      "http://localhost/test",
      { method: "GET", signal: controller.signal },
      3,
    );

    controller.abort();
    await expect(promise).rejects.toThrow("AbortError");
  });
});

// ============================================================================
// buildCustomModelOptions
// ============================================================================
describe("buildCustomModelOptions", () => {
  it("should format models into JSON options array", () => {
    const models = [
      { id: "meta/llama-3.3-70b-instruct", displayName: "Llama 3.3 70B" },
      { id: "deepseek/deepseek-r1", displayName: "DeepSeek R1" },
    ];

    const json = buildCustomModelOptions(models);
    const options = JSON.parse(json);

    expect(Array.isArray(options)).toBe(true);
    expect(options).toHaveLength(2);
    expect(options[0]).toEqual({
      value: "meta/llama-3.3-70b-instruct",
      label: "Llama 3.3 70B",
      description: "NIM",
    });
    expect(options[1]).toEqual({
      value: "deepseek/deepseek-r1",
      label: "DeepSeek R1",
      description: "NIM",
    });
  });

  it("should cap at 30 models", () => {
    const models = Array.from({ length: 50 }, (_, i) => ({
      id: `model-${i}`,
      displayName: `Model ${i}`,
    }));
    const json = buildCustomModelOptions(models);
    const options = JSON.parse(json);
    expect(options).toHaveLength(30);
  });

  it("should return empty array for empty input", () => {
    const json = buildCustomModelOptions([]);
    expect(JSON.parse(json)).toEqual([]);
  });
});
