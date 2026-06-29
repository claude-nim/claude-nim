// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require("../../package.json") as { version: string };

export const PROVIDER_DISPLAY_NAME = "NVIDIA NIM";
export const SECRET_STORAGE_KEY = "nvidia-nim.apiKey";
export const DEBUG_STATE_KEY = "nvidia-nim.debug";
export const DEBUG_ENV_VAR = "NVIDIA_NIM_DEBUG";
export const MANAGE_COMMAND_ID = "nvidia-nim.manage";
export const TOGGLE_DEBUG_LOGGING_COMMAND_ID = "nvidia-nim.toggleDebugLogging";
export const OPEN_DEBUG_LOG_COMMAND_ID = "nvidia-nim.openDebugLog";
export const TOGGLE_SHOW_REASONING_COMMAND_ID =
  "nvidia-nim.toggleShowReasoning";
export const LAUNCH_CLAUDE_CODE_COMMAND_ID = "nvidia-nim.launchClaudeCode";
export const SELECT_DEFAULT_MODEL_COMMAND_ID = "nvidia-nim.selectDefaultModel";
export const SHOW_REASONING_STATE_KEY = "nvidia-nim.showReasoning";

export const BASE_URL = "https://integrate.api.nvidia.com/v1";
export const EXTENSION_VERSION: string = pkg.version;

/** Maximum retry delay in milliseconds */
export const MAX_RETRY_DELAY_MS = 30000;

/** Base retry delay in milliseconds */
export const BASE_RETRY_DELAY_MS = 1000;

/** Maximum time (ms) between stream chunks before timeout */
export const STREAM_IDLE_TIMEOUT_MS = 120000;

export const STREAM_IDLE_TIMEOUT_MIN_MS = 60000;
export const STREAM_IDLE_TIMEOUT_MAX_MS = 300000;

/** Monotonic ID counter — avoids random string allocations per request. */
let _idCounter = 0;
export function generateId(): string {
  return `msg_${(_idCounter++).toString(36)}_${Date.now().toString(36)}`;
}
