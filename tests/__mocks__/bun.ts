import * as http from "node:http";

const mockServe = {
  stop: () => {},
  reload: () => {},
  ref: () => {},
  unref: () => {},
  pendingRequests: 0,
  port: 3456,
  hostname: "127.0.0.1",
  development: false,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).Bun = {
  serve: (opts: Record<string, unknown>) => {
    if (typeof opts?.fetch === "function" && opts?.port) {
      const nodeServer = http.createServer(async (nodeReq, nodeRes) => {
        try {
          const url = `http://${nodeReq.headers.host || "localhost"}${nodeReq.url}`;
          const method = nodeReq.method || "GET";
          let body: string | Buffer | undefined;
          if (method !== "GET" && method !== "HEAD") {
            const chunks: Buffer[] = [];
            for await (const chunk of nodeReq) {
              chunks.push(chunk);
            }
            body = Buffer.concat(chunks);
          }
          const headers = new Headers();
          for (const [key, value] of Object.entries(nodeReq.headers)) {
            if (value)
              headers.set(key, Array.isArray(value) ? value.join(", ") : value);
          }
          const request = new Request(url, { method, headers, body });
          const response = await (
            opts.fetch as (req: Request) => Response | Promise<Response>
          )(request);
          nodeRes.writeHead(
            response.status,
            Object.fromEntries(response.headers.entries()),
          );
          if (response.body) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              nodeRes.write(
                typeof value === "string" ? value : decoder.decode(value),
              );
            }
          }
          nodeRes.end();
        } catch {
          nodeRes.writeHead(500);
          nodeRes.end("Internal Server Error");
        }
      });
      nodeServer.listen(
        opts.port as number,
        (opts.hostname as string) ?? "127.0.0.1",
      );
      const addr = nodeServer.address() as { port: number } | null;
      return {
        stop: () => nodeServer.close(),
        reload: () => {},
        ref: () => {},
        unref: () => {},
        pendingRequests: 0,
        port: addr?.port ?? (opts.port as number),
        hostname: (opts.hostname as string) ?? "127.0.0.1",
        development: false,
      };
    }
    return { ...mockServe };
  },
  file: () => ({
    text: async () => "",
    json: async () => ({}),
    exists: async () => false,
    size: 0,
    name: "",
    lastModified: 0,
    slice: () => new Blob(),
    stream: () => new ReadableStream(),
    writer: () => ({
      write: async () => {},
      end: async () => {},
    }),
  }),
  write: async (_path: string, _data: string | Uint8Array) => {
    return typeof _data === "string" ? _data.length : _data.byteLength;
  },
  spawn: () => ({
    exited: Promise.resolve(0),
    pid: 0,
    kill: () => {},
    stdout: new ReadableStream(),
    stderr: new ReadableStream(),
    stdin: new WritableStream(),
  }),
  which: () => null,
  readableStreamToText: async () => "",
  readableStreamToJSON: async () => ({}),
  readableStreamToBytes: async () => new Uint8Array(),
  readableStreamToBlob: async () => new Blob(),
  ArrayBufferConverter: class {},
  crypto: {
    Digest: class {},
  },
  unsafe: {
    gc: () => {},
    tail: () => {},
  },
  inspect: () => "",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;
