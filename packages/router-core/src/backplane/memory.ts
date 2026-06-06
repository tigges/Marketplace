import type { Backplane, Unsubscribe } from "../types.js";

/**
 * Process-local backplane. Fine for a single instance, local dev, and tests.
 * In production swap in {@link UpstashBackplane} for cross-instance delivery.
 */
export class InMemoryBackplane implements Backplane {
  private channels = new Map<string, Set<(m: string) => void>>();

  async publish(channel: string, message: string): Promise<void> {
    const subs = this.channels.get(channel);
    if (!subs) return;
    for (const handler of [...subs]) {
      // Deliver asynchronously so publishers never block on subscribers.
      queueMicrotask(() => handler(message));
    }
  }

  async subscribe(channel: string, handler: (message: string) => void): Promise<Unsubscribe> {
    let set = this.channels.get(channel);
    if (!set) {
      set = new Set();
      this.channels.set(channel, set);
    }
    set.add(handler);
    return async () => {
      const current = this.channels.get(channel);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) this.channels.delete(channel);
    };
  }
}
