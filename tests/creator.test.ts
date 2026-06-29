// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
import { generateHardwareId } from "../src/creator/hardware-id";
import { formatUpdateMessage } from "../src/creator/update-checker";
import type { UpdateData } from "../src/creator/update-checker";

describe("hardware-id", () => {
  it("should return a 16-char hex string", () => {
    const id = generateHardwareId();
    expect(id).toHaveLength(16);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("should return the same id on repeated calls", () => {
    const first = generateHardwareId();
    const second = generateHardwareId();
    expect(first).toBe(second);
  });
});

describe("update-checker", () => {
  const baseUpdates: UpdateData = {
    latestVersion: "1.0.18",
    announcements: [],
    fastestModels: [],
    communityStats: { totalUsers: 0, totalRequests: 0, topModel: "" },
  };

  it("should return null when no updates exist", () => {
    const msg = formatUpdateMessage(baseUpdates, "1.0.18");
    expect(msg).toBeNull();
  });

  it("should show new version available", () => {
    const updates: UpdateData = {
      ...baseUpdates,
      latestVersion: "2.0.0",
    };
    const msg = formatUpdateMessage(updates, "1.0.18");
    expect(msg).toContain("2.0.0");
  });

  it("should show announcements", () => {
    const updates: UpdateData = {
      ...baseUpdates,
      announcements: [
        {
          id: "ann-1",
          date: "2026-06-28",
          type: "benchmark",
          title: "DeepSeek V4 is fastest",
          body: "40% faster inference",
        },
      ],
    };
    const msg = formatUpdateMessage(updates, "1.0.18");
    expect(msg).toContain("DeepSeek V4 is fastest");
  });

  it("should show fastest models", () => {
    const updates: UpdateData = {
      ...baseUpdates,
      fastestModels: [
        { model: "deepseek-v4", rank: 1, tokensPerSec: 142 },
        { model: "llama-3.3", rank: 2, tokensPerSec: 98 },
      ],
    };
    const msg = formatUpdateMessage(updates, "1.0.18");
    expect(msg).toContain("deepseek-v4");
    expect(msg).toContain("142");
  });

  it("should show community stats", () => {
    const updates: UpdateData = {
      ...baseUpdates,
      communityStats: {
        totalUsers: 42,
        totalRequests: 15000,
        topModel: "deepseek-v4",
      },
    };
    const msg = formatUpdateMessage(updates, "1.0.18");
    expect(msg).toContain("42 users");
    expect(msg).toContain("15,000");
  });

  it("should handle all update types together", () => {
    const updates: UpdateData = {
      latestVersion: "2.0.0",
      announcements: [
        {
          id: "ann-1",
          date: "2026-06-28",
          type: "new-model",
          title: "Gemma 3 released",
          body: "New model available",
        },
      ],
      fastestModels: [{ model: "deepseek-v4", rank: 1, tokensPerSec: 142 }],
      communityStats: {
        totalUsers: 10,
        totalRequests: 500,
        topModel: "deepseek-v4",
      },
    };
    const msg = formatUpdateMessage(updates, "1.0.18");
    expect(msg).toContain("2.0.0");
    expect(msg).toContain("Gemma 3 released");
    expect(msg).toContain("deepseek-v4");
    expect(msg).toContain("10 users");
  });
});
