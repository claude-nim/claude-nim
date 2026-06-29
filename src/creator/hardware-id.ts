// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
import { createHash } from "node:crypto";
import { hostname, platform, arch, userInfo } from "node:os";

let cachedId: string | null = null;

export function generateHardwareId(): string {
  if (cachedId) return cachedId;

  const raw = `${hostname()}${platform()}${arch()}${userInfo().username}`;
  cachedId = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return cachedId;
}
