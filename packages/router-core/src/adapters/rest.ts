import type { RoutedEvent } from "@appbazaar/core";
import type { AdapterContext, ProtocolAdapter } from "../types.js";
import { parseSseStream, readAllText } from "./stream.js";

/**
 * REST adapter. Convention-over-configuration so no custom glue code is
 * needed: a capability named `foo` maps to `POST {baseUrl}/foo` with the
 * invocation input as the JSON body.
 *
 * - `application/json` responses yield a single `result` event.
 * - `text/event-stream` responses are streamed through as `chunk` events
 *   followed by a terminal `result`.
 */
export class RestAdapter implements ProtocolAdapter {
  readonly protocol = "rest" as const;

  async *invoke(ctx: AdapterContext): AsyncIterable<RoutedEvent> {
    const { manifest, invocation, transport, signal } = ctx;
    const body = JSON.stringify(invocation.input ?? {});
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };

    const res = await transport.request(manifest.connection, {
      method: "POST",
      path: `/${invocation.capability}`,
      headers,
      body,
      signal,
    });

    const contentType = res.headers["content-type"] ?? "";

    if (res.status >= 400) {
      const text = await readAllText(res.body);
      yield {
        type: "error",
        requestId: invocation.requestId,
        code: "upstream_error",
        message: `connector returned ${res.status}: ${text.slice(0, 512)}`,
      };
      return;
    }

    if (contentType.includes("text/event-stream") && res.body) {
      let last: unknown = null;
      for await (const frame of parseSseStream(res.body)) {
        const data = safeJson(frame.data);
        last = data;
        yield { type: "chunk", requestId: invocation.requestId, data };
      }
      yield { type: "result", requestId: invocation.requestId, data: last };
      return;
    }

    const text = await readAllText(res.body);
    yield { type: "result", requestId: invocation.requestId, data: safeJson(text) };
  }
}

function safeJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
