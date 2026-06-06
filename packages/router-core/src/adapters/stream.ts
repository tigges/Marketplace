/** Streaming helpers shared by protocol adapters. */

const decoder = new TextDecoder();

/** Read an entire stream into a string. Used for unary (non-SSE) responses. */
export async function readAllText(body: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

export interface SseFrame {
  event: string;
  data: string;
}

/** Parse a `text/event-stream` body into frames, yielding as they arrive. */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    // Frames are separated by a blank line.
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      yield parseFrame(raw);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) yield parseFrame(buffer);
}

function parseFrame(raw: string): SseFrame {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  return { event, data: dataLines.join("\n") };
}

export function byteLength(value: unknown): number {
  if (value === undefined || value === null) return 0;
  const str = typeof value === "string" ? value : JSON.stringify(value);
  return new TextEncoder().encode(str).length;
}
