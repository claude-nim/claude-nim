// ── NIM tool parameter aliasing ──────────────────────────────────────────
//
// NVIDIA NIM rejects tool parameters with reserved names (e.g. "type").
// We alias them to safe names like "_fcc_arg_type" and restore them
// in the response.

const NIM_TOOL_ARGUMENT_ALIASES_KEY = "_fcc_nim_tool_argument_aliases";
const NIM_TOOL_PARAMETER_ALIAS_PREFIX = "_fcc_arg_";
const NIM_UNSAFE_TOOL_PARAMETER_NAMES = new Set(["type"]);

function needsAlias(name: string): boolean {
  return NIM_UNSAFE_TOOL_PARAMETER_NAMES.has(name);
}

function makeAlias(name: string, reserved: Set<string>): string {
  const safeTail = [...name]
    .filter((c) => c === "_" || /[a-zA-Z0-9]/.test(c))
    .join("")
    .replace(/^_+|_+$/g, "");
  const candidate = `${NIM_TOOL_PARAMETER_ALIAS_PREFIX}${safeTail || "arg"}`;
  let alias = candidate;
  let suffix = 2;
  while (reserved.has(alias)) {
    alias = `${candidate}_${suffix}`;
    suffix++;
  }
  reserved.add(alias);
  return alias;
}

function collectPropertyNames(value: unknown): Set<string> {
  const names = new Set<string>();
  if (value && typeof value === "object") {
    if (Array.isArray(value)) {
      for (const item of value) {
        for (const n of collectPropertyNames(item)) names.add(n);
      }
    } else {
      const dict = value as Record<string, unknown>;
      const props = dict.properties as Record<string, unknown>;
      if (props && typeof props === "object" && !Array.isArray(props)) {
        for (const key of Object.keys(props)) {
          if (typeof key === "string") names.add(key);
          for (const n of collectPropertyNames(props[key])) names.add(n);
        }
      }
      for (const key of Object.keys(dict)) {
        if (key !== "properties") {
          for (const n of collectPropertyNames(dict[key])) names.add(n);
        }
      }
    }
  }
  return names;
}

function aliasSchemaPropertyNames(
  value: unknown,
  reserved: Set<string>,
  aliasToOriginal: Map<string, string>,
  originalToAlias: Map<string, string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((v) =>
      aliasSchemaPropertyNames(v, reserved, aliasToOriginal, originalToAlias),
    );
  }
  if (!value || typeof value !== "object") return value;

  const dict = value as Record<string, unknown>;
  const localAliases = new Map<string, string>();
  const aliased: Record<string, unknown> = {};

  const props = dict.properties;
  if (props && typeof props === "object" && !Array.isArray(props)) {
    const aliasedProps: Record<string, unknown> = {};
    for (const [propName, propSchema] of Object.entries(props)) {
      const aliasedSchema = aliasSchemaPropertyNames(
        propSchema,
        reserved,
        aliasToOriginal,
        originalToAlias,
      );
      if (typeof propName === "string" && needsAlias(propName)) {
        let alias = originalToAlias.get(propName);
        if (!alias) {
          alias = makeAlias(propName, reserved);
          aliasToOriginal.set(alias, propName);
          originalToAlias.set(propName, alias);
        }
        localAliases.set(propName, alias);
        aliasedProps[alias] = aliasedSchema;
      } else {
        aliasedProps[propName] = aliasedSchema;
      }
    }
    aliased.properties = aliasedProps;
  }

  for (const [key, item] of Object.entries(dict)) {
    if (key === "properties") continue;
    if (key === "required" && Array.isArray(item)) {
      aliased[key] = item.map((r: unknown) =>
        typeof r === "string" ? (localAliases.get(r) ?? r) : r,
      );
      continue;
    }
    aliased[key] = aliasSchemaPropertyNames(
      item,
      reserved,
      aliasToOriginal,
      originalToAlias,
    );
  }
  return aliased;
}

function aliasToolParameters(
  parameters: Record<string, unknown>,
): [Record<string, unknown>, Map<string, string>] {
  const aliasToOriginal = new Map<string, string>();
  const originalToAlias = new Map<string, string>();
  const reserved = collectPropertyNames(parameters);
  const aliased = aliasSchemaPropertyNames(
    parameters,
    reserved,
    aliasToOriginal,
    originalToAlias,
  ) as Record<string, unknown>;
  return [aliased, aliasToOriginal];
}

export type ToolAliasMap = Record<string, Record<string, string>>;

export function sanitizeToolSchemas(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const tools = body.tools;
  if (!Array.isArray(tools)) return body;

  const toolArgumentAliases: ToolAliasMap = {};
  const sanitizedTools: unknown[] = [];

  for (const tool of tools) {
    if (!tool || typeof tool !== "object") {
      sanitizedTools.push(tool);
      continue;
    }
    const t = tool as Record<string, unknown>;
    const sanitizedTool: Record<string, unknown> = { ...t };
    const fn = t.function;
    if (fn && typeof fn === "object" && !Array.isArray(fn)) {
      const func = fn as Record<string, unknown>;
      const sanitizedFn: Record<string, unknown> = { ...func };
      const params = func.parameters;
      if (params && typeof params === "object" && !Array.isArray(params)) {
        const [aliased, aliases] = aliasToolParameters(
          params as Record<string, unknown>,
        );
        sanitizedFn.parameters = aliased;
        const toolName = func.name;
        if (aliases.size > 0 && typeof toolName === "string" && toolName) {
          const map: Record<string, string> = {};
          for (const [alias, original] of aliases) {
            map[alias] = original;
          }
          toolArgumentAliases[toolName] = map;
        }
      }
      sanitizedTool.function = sanitizedFn;
    }
    sanitizedTools.push(sanitizedTool);
  }

  body.tools = sanitizedTools;
  if (Object.keys(toolArgumentAliases).length > 0) {
    body[NIM_TOOL_ARGUMENT_ALIASES_KEY] = toolArgumentAliases;
  } else {
    delete body[NIM_TOOL_ARGUMENT_ALIASES_KEY];
  }
  return body;
}

export function stripAliasesFromBody(
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (!(NIM_TOOL_ARGUMENT_ALIASES_KEY in body)) return body;
  const cleaned = { ...body };
  delete cleaned[NIM_TOOL_ARGUMENT_ALIASES_KEY];
  return cleaned;
}

export function aliasesFromBody(body: Record<string, unknown>): ToolAliasMap {
  const raw = body[NIM_TOOL_ARGUMENT_ALIASES_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as ToolAliasMap;
}
