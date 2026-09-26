import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBoundedBody } from './local-web-security.js';

/**
 * Minimal bridge between a Node `http` request and a Fetch-style handler such
 * as `createFoundationHttpRouter().handle`.  Only the headers those handlers
 * read are forwarded; the Host, Origin and token were already checked on the
 * Node request, which stays the security boundary.
 */
const FORWARDED_HEADERS = ['accept', 'content-type', 'if-match'] as const;

export async function nodeRequestToFetch(
  request: IncomingMessage,
  options: { readonly limitBytes: number }
): Promise<Request> {
  const method = (request.method ?? 'GET').toUpperCase();
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers[name];
    if (typeof value === 'string') headers.set(name, value);
  }
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (method === 'GET' || method === 'HEAD') return new Request(url, { method, headers });
  // The body is read here with the host's limit so an oversized request is
  // rejected before the whole stream is buffered by the Fetch handler.
  const body = await readBoundedBody(request, options.limitBytes);
  return new Request(url, { method, headers, body: new Uint8Array(body) });
}

export async function writeFetchResponse(response: ServerResponse, fetchResponse: Response): Promise<void> {
  if (response.headersSent) return;
  response.statusCode = fetchResponse.status;
  for (const name of ['content-type', 'allow']) {
    const value = fetchResponse.headers.get(name);
    if (value !== null) response.setHeader(name, value);
  }
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(Buffer.from(await fetchResponse.arrayBuffer()));
}
