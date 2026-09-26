import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Protections shared by every local single-owner Web host (the value-proof
 * review host and the general local Web host).  They have no login, so the
 * loopback Host check, the per-launch token and the same-origin check are the
 * whole boundary against another site in the owner's browser.
 */

export const LOCAL_WEB_CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export class LocalWebHttpError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
    this.name = 'LocalWebHttpError';
  }
}

export function requestUrl(request: IncomingMessage): URL {
  return new URL(request.url ?? '/', 'http://localhost');
}

export function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  if (response.headersSent) return;
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(JSON.stringify(body));
}

export function writeHttpError(response: ServerResponse, error: LocalWebHttpError): void {
  writeJson(response, error.statusCode, { error: { code: error.code, message: error.message } });
}

export function tokenMatches(expected: string, received: string | string[] | undefined): boolean {
  if (typeof received !== 'string') return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** A browser always sends Origin on a cross-site write; it must name this Host. */
export function assertSameOrigin(request: IncomingMessage): void {
  const origin = request.headers.origin;
  if (origin === undefined) return;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    throw new LocalWebHttpError(403, 'cross_origin_rejected', 'Origin is not allowed');
  }
  if (host !== request.headers.host) throw new LocalWebHttpError(403, 'cross_origin_rejected', 'Origin is not allowed');
}

/** Reads the whole body but stops as soon as it exceeds the limit. */
export async function readBoundedBody(request: IncomingMessage, limitBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limitBytes) throw new LocalWebHttpError(413, 'payload_too_large', 'Request body is too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function readJsonObjectBody(request: IncomingMessage, limitBytes: number): Promise<Record<string, unknown>> {
  const contentType = String(request.headers['content-type'] ?? '');
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new LocalWebHttpError(415, 'unsupported_media_type', 'Content-Type must be application/json');
  }
  const body = await readBoundedBody(request, limitBytes);
  let value: unknown;
  try {
    value = JSON.parse(body.toString('utf8'));
  } catch {
    throw new LocalWebHttpError(400, 'invalid_json', 'Request body must be JSON');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new LocalWebHttpError(400, 'invalid_json', 'Request body must be a JSON object');
  }
  return value as Record<string, unknown>;
}

export const LOOPBACK_HOSTNAMES = ['127.0.0.1', 'localhost', '[::1]'] as const;

/** Rejects rebound DNS names: the Host must be a loopback name for the port this connection arrived on. */
export function isLoopbackHost(request: IncomingMessage): boolean {
  const host = request.headers.host?.toLowerCase();
  const port = request.socket.localPort;
  if (host === undefined || port === undefined) return false;
  return LOOPBACK_HOSTNAMES.some((name) => host === `${name}:${port}` || (port === 80 && host === name));
}
