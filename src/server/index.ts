import { PROVIDER_DISPLAY_NAME } from "../shared/constants";
import {
  initModelState,
  getCurrentModel,
  setCurrentModel,
} from "../api/model-switch";
import { initDashboard, resetSessionStats } from "../dashboard";
import { createServer, type ServerState } from "./routes";
import { ModelRouter } from "./model-router";
import { validateNimSettings } from "./nim-settings";
import { FixedWindowRateLimiter } from "./rate-limiter";
import { state } from "./proxy-state";

let starting = false;

export function setShowReasoning(enabled: boolean): void {
  state.showReasoningEnabled = enabled;
}

export function setModelsCacheTTL(minutes: number): void {
  state.modelsCacheTTLMs = Math.max(1, minutes) * 60 * 1000;
}

export function setRequestTimeout(seconds: number): void {
  state.requestTimeoutMs = Math.max(10, seconds) * 1000;
}

export function setDefaultModel(model: string | undefined): void {
  state.activeDefaultModel = model;
}

export function getStreamIdleTimeout(): number {
  return state.requestTimeoutMs;
}

export function startProxyServer(
  port: number,
  apiKey: string,
  defaultModel?: string,
  onStatus?: (running: boolean, port?: number) => void,
): Promise<void> {
  if (state.server) {
    onStatus?.(true, state.currentPort ?? undefined);
    return Promise.resolve();
  }
  if (starting) {
    return Promise.resolve();
  }
  starting = true;

  try {
    state.activeApiKey = apiKey;
    state.currentPort = port;
    initModelState();
    initDashboard();
    resetSessionStats();

    const modelName =
      defaultModel || getCurrentModel() || "meta/llama-3.3-70b-instruct";
    if (defaultModel) {
      state.activeDefaultModel = defaultModel;
      setCurrentModel(defaultModel);
    } else {
      state.activeDefaultModel = getCurrentModel() || undefined;
    }

    const config = { apiKey, model: modelName };
    const router = new ModelRouter(modelName);
    const nimSettings = validateNimSettings({});
    const rateLimiter = new FixedWindowRateLimiter();

    const serverState: ServerState = {
      router,
      nimSettings,
      startTime: Date.now(),
      requestCount: 0,
      rateLimiter,
    };

    state.server = createServer(config, serverState, port);
    onStatus?.(true, port);
    return Promise.resolve();
  } catch (err) {
    const msg = `Failed to start ${PROVIDER_DISPLAY_NAME} Proxy: ${err}`;
    onStatus?.(false);
    state.reset();
    return Promise.reject(new Error(msg));
  } finally {
    starting = false;
  }
}

export function stopProxyServer(): void {
  for (const stream of state.activeStreams) {
    stream.abort();
  }
  state.activeStreams.clear();

  if (state.server) {
    try {
      state.server.stop();
    } catch {
      /* ignore */
    }
  }
  state.reset();
}

export function isProxyRunning(): boolean {
  return state.server !== null;
}
