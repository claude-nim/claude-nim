// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type * as http from "node:http";

// ============================================================================
// Types
// ============================================================================

export interface RequestMetric {
  id: string;
  timestamp: number;
  model: string;
  stream: boolean;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  timeToFirstTokenMs: number;
  status: "success" | "error";
  error?: string;
  messageCount: number;
  contextCharCount: number;
}

export interface StatsSummary {
  totalRequests: number;
  totalTokens: number;
  avgLatencyMs: number;
  peakTokensPerSec: number;
  uptimeMs: number;
}

// ============================================================================
// Config
// ============================================================================

const DATA_DIR = path.join(os.homedir(), ".claude-nim");
const METRICS_FILE = path.join(DATA_DIR, "metrics.jsonl");
const RING_BUFFER_SIZE = 1_000;

// ============================================================================
// State
// ============================================================================

const ringBuffer: RequestMetric[] = [];
const sseClients = new Set<http.ServerResponse>();
const startTime = Date.now();

// ============================================================================
// File I/O
// ============================================================================

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadMetricsFromFile(): void {
  try {
    if (!fs.existsSync(METRICS_FILE)) return;
    const lines = fs
      .readFileSync(METRICS_FILE, "utf8")
      .split("\n")
      .filter((l) => l.trim());
    // Take last RING_BUFFER_SIZE entries
    const tail = lines.slice(-RING_BUFFER_SIZE);
    for (const line of tail) {
      try {
        ringBuffer.push(JSON.parse(line) as RequestMetric);
      } catch {
        // skip corrupt line
      }
    }
  } catch {
    // ignore read errors
  }
}

function appendToMetricsFile(metric: RequestMetric): void {
  try {
    ensureDir();
    fs.appendFileSync(METRICS_FILE, JSON.stringify(metric) + "\n");
    // Rotate if too large
    if (fs.existsSync(METRICS_FILE)) {
      const stat = fs.statSync(METRICS_FILE);
      if (stat.size > 2 * 1024 * 1024) {
        // 2MB limit — keep last 5000 lines
        const lines = fs
          .readFileSync(METRICS_FILE, "utf8")
          .split("\n")
          .filter((l) => l.trim());
        const trimmed = lines.slice(-5_000);
        fs.writeFileSync(METRICS_FILE, trimmed.join("\n") + "\n");
      }
    }
  } catch {
    // ignore write errors
  }
}

// ============================================================================
// Public API
// ============================================================================

export function initDashboard(): void {
  loadMetricsFromFile();
}

export function recordMetric(metric: RequestMetric): void {
  // 1. Push to ring buffer
  ringBuffer.push(metric);
  if (ringBuffer.length > RING_BUFFER_SIZE) {
    ringBuffer.shift();
  }

  // 2. Append to file
  appendToMetricsFile(metric);

  // 3. Broadcast to SSE clients
  const payload = `data: ${JSON.stringify(metric)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

export function getMetricsHistory(): RequestMetric[] {
  return ringBuffer.slice(-200); // last 200 for initial load
}

export function getMetricsSSE(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "X-Accel-Buffering": "no",
  });

  // SSE comment to establish connection
  res.write(":ok\n\n");

  // Send recent history as initial batch
  const history = getMetricsHistory();
  for (const m of history) {
    res.write(`data: ${JSON.stringify(m)}\n\n`);
  }

  sseClients.add(res);

  // Keepalive heartbeat every 15s to prevent proxy/browser from closing
  const heartbeat = setInterval(() => {
    try {
      res.write(":heartbeat\n\n");
    } catch {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 15_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
}

export function getStats(): StatsSummary {
  const totalRequests = ringBuffer.length;
  const totalTokens = ringBuffer.reduce(
    (sum, m) => sum + m.inputTokens + m.outputTokens,
    0,
  );
  const avgLatencyMs =
    totalRequests > 0
      ? ringBuffer.reduce((sum, m) => sum + m.latencyMs, 0) / totalRequests
      : 0;

  // Peak tokens per second (max across all requests)
  let peakTokensPerSec = 0;
  for (const m of ringBuffer) {
    if (m.latencyMs > 0) {
      const tps = ((m.inputTokens + m.outputTokens) / m.latencyMs) * 1000;
      if (tps > peakTokensPerSec) peakTokensPerSec = tps;
    }
  }

  return {
    totalRequests,
    totalTokens,
    avgLatencyMs: Math.round(avgLatencyMs),
    peakTokensPerSec: Math.round(peakTokensPerSec),
    uptimeMs: Date.now() - startTime,
  };
}

export function removeSSEClient(res: http.ServerResponse): void {
  sseClients.delete(res);
}
