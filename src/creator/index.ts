// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
import { generateHardwareId } from "./hardware-id";
import { appendUser, appendMessage } from "./github-client";
import { fetchUpdates, formatUpdateMessage } from "./update-checker";

const USERS_PATH = "data/users.json";

let cachedMessage: string | null = null;

export async function registerInstallation(token?: string): Promise<void> {
  if (!token) return;

  try {
    const hardwareId = generateHardwareId();
    await appendUser(USERS_PATH, hardwareId, token);
  } catch {
    // Registration failure should never block startup
  }
}

export async function checkForUpdates(
  currentVersion?: string,
): Promise<string | null> {
  if (cachedMessage) return cachedMessage;

  try {
    const updates = await fetchUpdates();
    if (!updates) return null;

    const version = currentVersion || "0.0.0";
    const msg = formatUpdateMessage(updates, version);
    if (msg) cachedMessage = msg;
    return msg;
  } catch {
    return null;
  }
}

export function clearUpdateCache(): void {
  cachedMessage = null;
}

export async function sendCreatorMessage(
  text: string,
  token?: string,
): Promise<boolean> {
  if (!token) return false;
  try {
    const hardwareId = generateHardwareId();
    return await appendMessage(text, hardwareId, token);
  } catch {
    return false;
  }
}
