import type { RoutedEvent } from "@appbazaar/core";
import type { AdapterContext, ProtocolAdapter } from "../types.js";
import { parseSseStream, readAllText } from "./stream.js";

/**
 * MCP adapter (Streamable HTTP transport). Translates a normalized invocation
 * into a JSON-RPC `tools/call` request and normalizes the response back.
 *
 * MCP is simply the *first* protocol — this adapter implements the same
 * {@link ProtocolAdapter} interface as REST, so the engine treats them
 * identically. The connector's MCP endpoint is `connection.baseUrl`.
 */
export class McpAdapter implements ProtocolAdapter {
  readonly protocol = "mcp" as const;

  async *invoke(ctx: AdapterContext): AsyncIterable<RoutedEvent> {
    const { manifest, invocation, transport, signal } = ctx;
    const rpcId = invocation.requestId;
    const payload = {
      jsonrpc: "2.0",
      id: rpcId,
      method: "tools/call",
      params: { name: invocation.capability, arguments: invocation.input ?? {} },
    };

    const res = await transport.request(manifest.connection, {
      method: "POST",
      path: "",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(payload),
      signal,
    });

    if (res.status >= 400) {
      const text = await readAllText(res.body);
      yield {
        type: "error",
        requestId: rpcId,
        code: "upstream_error",
        message: `MCP server returned ${res.status}: ${text.slice(0, 512)}`,
      };
      return;
    }

    const contentType = res.headers["content-type"] ?? "";

    if (contentType.includes("text/event-stream") && res.body) {
      for await (const frame of parseSseStream(res.body)) {
        const msg = safeJson(frame.data);
        const event = interpret(msg, rpcId);
        if (event) {
          yield event;
          if (event.type === "result" || event.type === "error") return;
        }
      }
      yield { type: "error", requestId: rpcId, code: "upstream_error", message: "MCP stream ended without a result" };
      return;
    }

    const text = await readAllText(res.body);
    const event = interpret(safeJson(text), rpcId);
    yield event ?? { type: "error", requestId: rpcId, code: "upstream_error", message: "empty MCP response" };
  }
}

interface JsonRpcMessage {
  id?: string | number;
  result?: { content?: unknown; isError?: boolean } & Record<string, unknown>;
  error?: { code?: number; message?: string };
  method?: string;
  params?: unknown;
}

/** Map a JSON-RPC message to a normalized RoutedEvent (or null to skip). */
function interpret(msg: unknown, rpcId: string): RoutedEvent | null {
  if (!msg || typeof msg !== "object") return null;
  const m = msg as JsonRpcMessage;

  // Progress / log notifications stream through as chunks.
  if (m.method && m.id === undefined) {
    return { type: "chunk", requestId: rpcId, data: { method: m.method, params: m.params } };
  }
  if (m.id !== undefined && String(m.id) !== rpcId) return null;

  if (m.error) {
    return { type: "error", requestId: rpcId, code: "upstream_error", message: m.error.message ?? "MCP error" };
  }
  if (m.result) {
    if (m.result.isError) {
      return { type: "error", requestId: rpcId, code: "upstream_error", message: stringifyContent(m.result.content) };
    }
    return { type: "result", requestId: rpcId, data: m.result.content ?? m.result };
  }
  return null;
}

function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content);
  } catch {
    return "MCP error";
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
