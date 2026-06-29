// Mock chalk for Jest — returns text as-is without ANSI codes
function passthrough(s: string): string {
  return s;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const chalkProxy: any = new Proxy(passthrough, {
  get: (_target, prop) => {
    if (prop === "hex") return (_color: string) => passthrough;
    if (prop === "bold") return passthrough;
    if (prop === "dim") return passthrough;
    if (typeof prop === "function") return passthrough;
    if (typeof prop === "string") return chalkProxy;
    return passthrough;
  },
  apply: (_target, _thisArg, args) => args[0] ?? "",
});

export default chalkProxy;
