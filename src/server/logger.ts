// ── ANSI colours ──────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[96m",
  green: "\x1b[92m",
  yellow: "\x1b[93m",
  red: "\x1b[91m",
  magenta: "\x1b[95m",
  blue: "\x1b[94m",
} as const;

// ── Public API ─────────────────────────────────────────────────────────────

export function logError(context: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`${C.red}✗ [Proxy Error] ${context}:${C.reset} ${msg}`);
}
