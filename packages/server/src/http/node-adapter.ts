import type { IncomingMessage, ServerResponse } from "node:http";
import { APP_SECURITY_HEADERS } from "../auth/security-headers";

/** Caddy already stops request bodies at 64 KiB; this is the same bound for a server reached some other way. */
const MAX_BODY_BYTES = 64 * 1024;

class BodyTooLargeError extends Error {}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw new BodyTooLargeError();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/** Builds a standard `Request`. The signal aborts when the client goes away, which ends a progress stream. */
async function toRequest(req: IncomingMessage, res: ServerResponse, localMode: boolean): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  // Local mode has no proxy in front of the server; give the handlers the socket address they would otherwise lack.
  if (localMode && !headers.has("x-forwarded-for") && !headers.has("x-real-ip") && req.socket.remoteAddress) {
    headers.set("x-real-ip", req.socket.remoteAddress);
  }
  const controller = new AbortController();
  res.on("close", () => controller.abort());

  const method = req.method ?? "GET";
  const host = req.headers.host ?? "localhost";
  const url = `http://${host}${req.url ?? "/"}`;
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? await readBody(req) : undefined;
  return new Request(url, { method, headers, body, signal: controller.signal });
}

/** Writes a standard `Response` to the socket, streaming the body so server-sent events are not buffered. */
async function writeResponse(response: Response, res: ServerResponse): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") headers[name] = value;
  });
  for (const { key, value } of APP_SECURITY_HEADERS) {
    headers[key.toLowerCase()] ??= value;
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) headers["set-cookie"] = cookies;
  res.writeHead(response.status, headers);
  if (response.body === null) {
    res.end();
    return;
  }
  res.flushHeaders();
  const reader = response.body.getReader();
  res.on("close", () => void reader.cancel().catch(() => undefined));
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) {
        await new Promise<void>((resolve) => res.once("drain", resolve));
      }
    }
  } catch {
    // The client closed mid-stream.
  }
  res.end();
}

export function createNodeListener(
  handle: (request: Request) => Promise<Response>,
  options: { readonly localMode: boolean },
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    void (async () => {
      try {
        const request = await toRequest(req, res, options.localMode);
        await writeResponse(await handle(request), res);
      } catch (error) {
        if (res.headersSent) {
          res.end();
          return;
        }
        const tooLarge = error instanceof BodyTooLargeError;
        const body = tooLarge
          ? { code: "TOO_LARGE", message: "Request body too large." }
          : { code: "INTERNAL", message: "Something went wrong." };
        res.writeHead(tooLarge ? 413 : 500, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(body));
      }
    })();
  };
}
