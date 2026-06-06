import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A reference REST data connector. It is an ordinary public HTTP API — it
 * knows nothing about appbazaar. The platform's REST adapter maps a declared
 * capability `foo` to `POST /foo`, so no custom integration code is required
 * on either side.
 *
 * Capabilities:
 *   POST /echo     { message }       -> { echoed: message, at }
 *   POST /reverse  { text }          -> { reversed }
 *   POST /stream   { count }         -> text/event-stream of `count` chunks
 */
export function createEchoConnector(): http.Server {
  return http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = parse(Buffer.concat(chunks).toString("utf8"));
      const path = (req.url ?? "/").split("?")[0];

      if (req.method === "POST" && path === "/echo") {
        return json(res, 200, { echoed: body.message ?? null, at: new Date().toISOString() });
      }
      if (req.method === "POST" && path === "/reverse") {
        const text = String(body.text ?? "");
        return json(res, 200, { reversed: [...text].reverse().join("") });
      }
      if (req.method === "POST" && path === "/stream") {
        return stream(res, Number(body.count ?? 3));
      }
      json(res, 404, { error: "unknown capability" });
    });
  });
}

function parse(text: string): Record<string, unknown> {
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function stream(res: http.ServerResponse, count: number): void {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  let i = 0;
  const timer = setInterval(() => {
    if (i >= count) {
      clearInterval(timer);
      res.end();
      return;
    }
    res.write(`data: ${JSON.stringify({ index: i })}\n\n`);
    i++;
  }, 5);
}

/** Start the connector and resolve with its base URL + a closer. */
export async function startEchoConnector(port = 0): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createEchoConnector();
  await new Promise<void>((resolve) => server.listen(port, resolve));
  const { port: actual } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${actual}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = Number(process.env.PORT ?? 8787);
  createEchoConnector().listen(port, () => console.log(`echo connector on http://localhost:${port}`));
}
