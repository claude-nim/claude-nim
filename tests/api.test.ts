// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
import { fetchWithRetry } from "../src/api";

describe("API Middleware", () => {
  it("should retry on 429 rate limit responses", async () => {
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: false,
          status: 429,
          headers: new Headers({ "retry-after": "1" }),
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

  it("should return immediately on 401 Unauthorized without retrying", async () => {
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(async () => {
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
});
