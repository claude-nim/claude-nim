// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details

/**
 * Server entry point — startProxyServer, stopProxyServer, isProxyRunning
 * and configuration setters.
 *
 * This is the only module that creates/destroys the http.Server.
 * All routing is delegated to ./routes.ts.
 */

import * as http from "node:http";
import * as vscode from "vscode";
import { PROVIDER_DISPLAY_NAME } from "../constants";
import { debugLog } from "../output-channel";
import {
  initModelState,
  getCurrentModel,
  setCurrentModel,
} from "../model-switch";
import { initDashboard } from "../dashboard";
import { createRequestHandler } from "./routes";
import { state } from "./proxy-state";

// ============================================================================
// Configuration setters (called by extension.ts)
// ============================================================================

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

// ============================================================================
// Server lifecycle
// ============================================================================

export function startProxyServer(
  port: number,
  apiKey: string,
  defaultModel?: string,
  onStatus?: (running: boolean, port?: number) => void,
): Promise<void> {
  if (state.server) {
    vscode.window.showInformationMessage(
      `Claude-NIM Proxy is already running on port ${state.currentPort}`,
    );
    onStatus?.(true, state.currentPort ?? undefined);
    return Promise.resolve();
  }

  state.activeApiKey = apiKey;
  state.currentPort = port;
  initModelState();
  initDashboard();
  if (defaultModel) {
    state.activeDefaultModel = defaultModel;
    setCurrentModel(defaultModel);
  } else {
    state.activeDefaultModel = getCurrentModel() || undefined;
  }

  state.server = http.createServer(createRequestHandler());

  // Track connected sockets so we can force-close them on stop
  state.server.on("connection", (socket) => {
    state.activeSockets.add(socket);
    socket.on("close", () => state.activeSockets.delete(socket));
  });

  return new Promise<void>((resolve, reject) => {
    state.server!.on("error", (err: NodeJS.ErrnoException) => {
      let msg = `Failed to start ${PROVIDER_DISPLAY_NAME} Proxy: ${err.message}`;
      if (err.code === "EADDRINUSE") {
        msg = `Port ${port} is already in use. Please configure a different proxyPort in settings.`;
      }
      vscode.window.showErrorMessage(msg);
      debugLog("proxy", msg);
      state.reset();
      onStatus?.(false);
      reject(err);
    });

    state.server!.listen(port, "127.0.0.1", () => {
      vscode.window.showInformationMessage(
        `${PROVIDER_DISPLAY_NAME} Proxy started on port ${port}`,
      );
      debugLog("proxy", `Server started on 127.0.0.1:${port}`);
      onStatus?.(true, port);
      resolve();
    });
  });
}

export function stopProxyServer(): void {
  for (const stream of state.activeStreams) {
    stream.abort();
  }
  state.activeStreams.clear();

  // Force-close all keep-alive sockets so server.close() completes immediately
  for (const socket of state.activeSockets) {
    socket.destroy();
  }
  state.activeSockets.clear();

  if (state.server) {
    state.server.close(() => {
      vscode.window.showInformationMessage(
        `${PROVIDER_DISPLAY_NAME} Proxy stopped`,
      );
      debugLog("proxy", "Server stopped");
    });
    state.reset();
  }
}

export function isProxyRunning(): boolean {
  return state.server !== null;
}
