import { AppError } from "@appbazaar/core";
import type { Connection } from "@appbazaar/core";
import type { ConnectorTransport, TransportRequest, TransportResponse } from "../types.js";

/**
 * Tunnel transport (wave 2). Connectors behind a firewall run a tunnel client
 * that maintains a persistent connection to the router; calls are dialed over
 * that link instead of a public URL.
 *
 * The MVP intentionally ships this as a wired-but-inactive seam: the registry
 * already accepts and stores tunnel manifests, the engine already selects this
 * transport by `connection.mode`, and turning it on later means implementing
 * `request` against a tunnel registry — no engine, adapter, or schema rebuild.
 */
export interface TunnelRegistry {
  /** Resolve a live tunnel link for a registered tunnelId, or null. */
  dial(tunnelId: string): Promise<{
    request(req: TransportRequest): Promise<TransportResponse>;
  } | null>;
}

export class TunnelTransport implements ConnectorTransport {
  readonly mode = "tunnel" as const;

  constructor(private readonly registry?: TunnelRegistry) {}

  async request(connection: Connection, req: TransportRequest): Promise<TransportResponse> {
    if (connection.mode !== "tunnel") {
      throw new AppError("internal", "TunnelTransport received a non-tunnel connection");
    }
    if (!this.registry) {
      throw new AppError(
        "tunnel_not_implemented",
        "tunnel connectors are reserved for wave 2 and not yet routable",
        { tunnelId: connection.tunnelId },
      );
    }
    const link = await this.registry.dial(connection.tunnelId);
    if (!link) {
      throw new AppError("connector_unavailable", "tunnel offline", { tunnelId: connection.tunnelId });
    }
    return link.request(req);
  }
}
