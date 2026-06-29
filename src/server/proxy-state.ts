export type BunServer = ReturnType<typeof Bun.serve>;

export class ProxyState {
  private static instance: ProxyState;

  server: BunServer | null = null;
  currentPort: number | null = null;
  activeApiKey: string | null = null;
  showReasoningEnabled = false;
  modelsCacheTTLMs: number = 5 * 60 * 1000;
  requestTimeoutMs: number = 120_000;
  activeDefaultModel: string | undefined = undefined;
  modelsCache: {
    data: Record<string, unknown>;
    timestamp: number;
    apiKey: string;
  } | null = null;

  readonly activeStreams = new Set<AbortController>();

  private constructor() {}

  static getInstance(): ProxyState {
    if (!ProxyState.instance) {
      ProxyState.instance = new ProxyState();
    }
    return ProxyState.instance;
  }

  invalidateModelsCache(): void {
    this.modelsCache = null;
  }

  reset(): void {
    this.server = null;
    this.currentPort = null;
    this.activeApiKey = null;
    this.modelsCache = null;
    for (const ac of this.activeStreams) {
      ac.abort();
    }
    this.activeStreams.clear();
  }
}

export const state = ProxyState.getInstance();
