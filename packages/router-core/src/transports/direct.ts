import { AppError } from "@appbazaar/core";
import type { Connection } from "@appbazaar/core";
import type { ConnectorTransport, TransportRequest, TransportResponse } from "../types.js";

/**
 * Direct transport: the connector exposes a publicly reachable HTTPS API.
 * Uses the platform `fetch` (Node 20+, Vercel, Cloudflare Workers). The
 * response body is streamed straight through — never buffered to disk.
 */
export class DirectTransport implements ConnectorTransport {
  readonly mode = "direct" as const;

  async request(connection: Connection, req: TransportRequest): Promise<TransportResponse> {
    if (connection.mode !== "direct") {
      throw new AppError("internal", "DirectTransport received a non-direct connection");
    }
    const base = connection.baseUrl.replace(/\/+$/, "");
    const path = req.path ? (req.path.startsWith("/") ? req.path : `/${req.path}`) : "";
    const url = `${base}${path}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        signal: req.signal,
      });
    } catch (cause) {
      throw new AppError("connector_unavailable", `connector unreachable: ${String(cause)}`);
    }

    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
    return { status: res.status, headers, body: res.body };
  }
}
