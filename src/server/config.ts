import { join } from "node:path";
import { unlinkSync } from "node:fs";
import type { NimSettings } from "./nim-settings";

export interface Config {
  apiKey: string;
  readonly model: string;
  readonly nimSettings?: Partial<NimSettings>;
}

const CONFIG_FILENAME = "config.temp.json";

function configPath(): string {
  return join(import.meta.dir, "..", CONFIG_FILENAME);
}

export async function saveConfig(config: Config): Promise<void> {
  await Bun.write(configPath(), JSON.stringify(config, null, 2));
}

export async function loadConfig(): Promise<Config | null> {
  try {
    const file = Bun.file(configPath());
    if (!(await file.exists())) return null;
    const data = JSON.parse(await file.text()) as Partial<Config>;
    if (typeof data.apiKey !== "string" || !data.apiKey) return null;
    if (typeof data.model !== "string" || !data.model) return null;
    return data as Config;
  } catch {
    return null;
  }
}

export function clearConfig(): void {
  try {
    unlinkSync(configPath());
  } catch {
    // File may not exist — that's fine
  }
}

export async function configExists(): Promise<boolean> {
  return Bun.file(configPath()).exists();
}
