// ── Fixed Window Stalling Rate Limiter ─────────────────────────────────────

export class FixedWindowRateLimiter {
  private maxRequests: number = 40;
  private windowMs: number = 60_000;
  private minGapMs: number = 2_000;

  private requestCount: number = 0;
  private windowStartTime: number | null = null;
  private lastRequestTime: number = 0;
  private stallQueue = 0;

  /**
   * Checks the rate limit. Enforces a minimum 2-second gap between
   * consecutive requests and stalls when the 40-request ceiling is hit.
   */
  async acquireToken(abortSignal?: AbortSignal): Promise<void> {
    const now = Date.now();

    // 1. Enforce minimum gap between consecutive requests
    const elapsed = now - this.lastRequestTime;
    if (this.lastRequestTime > 0 && elapsed < this.minGapMs) {
      await sleepOrAbort(this.minGapMs - elapsed, abortSignal);
    }
    this.lastRequestTime = Date.now();

    // 2. Check for abort before proceeding
    if (abortSignal?.aborted) return;

    // 3. First request ever, or window has naturally expired
    if (
      this.windowStartTime === null ||
      this.lastRequestTime - this.windowStartTime >= this.windowMs
    ) {
      this.windowStartTime = this.lastRequestTime;
      this.requestCount = 1;
      return;
    }

    // 4. We are within the current 1-minute window
    if (this.requestCount < this.maxRequests) {
      this.requestCount++;
      return;
    }

    // 5. Rate limit hit — stall until the next window
    const timeRemaining =
      this.windowMs - (this.lastRequestTime - this.windowStartTime);

    this.stallQueue++;
    await sleepOrAbort(timeRemaining, abortSignal);

    // 6. Wake up — split into first (reset) and followers (increment)
    this.lastRequestTime = Date.now();
    this.stallQueue--;
    if (
      this.windowStartTime === null ||
      this.lastRequestTime - this.windowStartTime >= this.windowMs
    ) {
      this.windowStartTime = this.lastRequestTime;
      this.requestCount = 1;
    } else {
      this.requestCount++;
    }
  }
}

function sleepOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (!signal) {
      setTimeout(resolve, ms);
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
