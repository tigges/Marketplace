import type { Backplane, Unsubscribe } from "../types.js";

/**
 * Minimal Upstash Redis client surface we depend on. Kept structural so this
 * file has no hard dependency and bundles cleanly for Cloudflare Workers.
 */
export interface UpstashLike {
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string): {
    on(event: "message", cb: (payload: { message: string }) => void): void;
    unsubscribe(): Promise<void>;
  };
}

/**
 * Production backplane backed by Upstash Redis pub/sub. Because the router is
 * stateless, the instance holding an SSE stream subscribes to
 * `session:{id}`, and any instance handling a POST publishes to it.
 */
export class UpstashBackplane implements Backplane {
  constructor(private readonly redis: UpstashLike) {}

  async publish(channel: string, message: string): Promise<void> {
    await this.redis.publish(channel, message);
  }

  async subscribe(channel: string, handler: (message: string) => void): Promise<Unsubscribe> {
    const sub = this.redis.subscribe(channel);
    sub.on("message", (payload) => handler(payload.message));
    return async () => {
      await sub.unsubscribe();
    };
  }
}
