// ── Gateway Model IDs ────────────────────────────────────────────────────
//
// Encodes provider/model references as gateway-safe model IDs so Claude Code
// native /model picker works. Format: anthropic/<providerId>/<modelId>
// Matches FCC (free-claude-code) schema exactly.
//
// Two variants per model:
//   anthropic/<providerId>/<modelId>       — thinking enabled
//   claude-3-fcc-no-think/<providerId>/... — no thinking (Claude Code treats
//     any model id containing "claude-3-" as no-thinking)

const GATEWAY_PREFIX = "anthropic";
const NO_THINK_PREFIX = "claude-3-fcc-no-think";
const PROVIDER_ID = "nvidia_nim";

export interface GatewayModelRef {
  readonly providerId: string;
  readonly modelId: string;
}

/**
 * Encode a NIM model ID (e.g. "nvidia/nemotron-3-super-120b-a12b") as a
 * gateway model ID: "anthropic/nvidia_nim/nvidia/nemotron-3-super-120b-a12b"
 */
export function encodeNimGatewayModelId(nimModelId: string): string {
  if (!nimModelId) return "anthropic/nvidia_nim/unknown";
  return `${GATEWAY_PREFIX}/${PROVIDER_ID}/${nimModelId}`;
}

/**
 * Encode a NIM model ID as a "no thinking" gateway model ID.
 * Claude Code treats any model id containing "claude-3-" as not supporting
 * thinking, so using this prefix disables client-side thinking.
 */
export function encodeNoThinkGatewayModelId(nimModelId: string): string {
  if (!nimModelId) return "claude-3-fcc-no-think/nvidia_nim/unknown";
  return `${NO_THINK_PREFIX}/${PROVIDER_ID}/${nimModelId}`;
}

/**
 * Decode a gateway model ID back to the raw NIM model ID.
 * "anthropic/nvidia_nim/nvidia/nemotron-3-super-120b-a12b" → "nvidia/nemotron-3-super-120b-a12b"
 */
export function decodeNimGatewayModelId(gatewayId: string): string | null {
  if (
    !gatewayId.startsWith(`${GATEWAY_PREFIX}/`) &&
    !gatewayId.startsWith(`${NO_THINK_PREFIX}/`)
  )
    return null;
  const prefix = gatewayId.startsWith(`${GATEWAY_PREFIX}/`)
    ? `${GATEWAY_PREFIX}/`
    : `${NO_THINK_PREFIX}/`;
  const rest = gatewayId.slice(prefix.length);
  const firstSlash = rest.indexOf("/");
  if (firstSlash < 0) return null;
  const providerId = rest.slice(0, firstSlash);
  if (providerId !== PROVIDER_ID) return null;
  const modelId = rest.slice(firstSlash + 1);
  if (!modelId) return null;
  return modelId.replace(/\/+$/, "");
}

export function isGatewayModelId(modelId: string): boolean {
  return decodeNimGatewayModelId(modelId) !== null;
}
