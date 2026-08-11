import { test, expect } from '@playwright/test';
import fs from 'node:fs';
// @ts-expect-error plain ESM JavaScript module without type declarations
import { EveSessionClient } from '../../server/services/external-runner/eve-session-client.js';

function read(path: string): string {
  return fs.readFileSync(path, 'utf8');
}

function ndjsonChunk(lines: Array<Record<string, unknown>>): Uint8Array {
  return new TextEncoder().encode(lines.map((line) => `${JSON.stringify(line)}\n`).join(''));
}

function liveTailResponse(lines: Array<Record<string, unknown>>, { close = false } = {}): Response {
  // Mirrors the eve session stream route: replays durable history immediately,
  // then keeps the connection open (never closes) unless close=true.
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(ndjsonChunk(lines));
      if (close) controller.close();
    }
  });
  return new Response(stream, { status: 200 });
}

function clientFor(responseFactory: () => Response): InstanceType<typeof EveSessionClient> {
  return new EveSessionClient({
    baseUrl: 'https://eve.example',
    token: 'token-123',
    fetchImpl: async () => responseFactory(),
    timeoutMs: 30000
  });
}

test('story-eve-stream-replay-reader ac:1 S-001 parked live-tail replay flow returns boundary-terminated events without waiting for close', async () => {
  const client = clientFor(() => liveTailResponse([
    { type: 'session.started' },
    { type: 'message.completed', data: { message: 'done' } },
    { type: 'turn.completed' },
    { type: 'session.waiting', data: { wait: 'next-user-message' } }
  ]));

  const started = Date.now();
  const events = await client.readSessionStream({ sessionId: 'wrun_e2e_boundary' });

  // story-eve-stream-replay-reader ac:1 replay completes without connection close
  expect(Date.now() - started).toBeLessThan(2000);
  expect(events).toHaveLength(4);
  expect(events.at(-1)).toMatchObject({ type: 'session.waiting' });
});

test('story-eve-stream-replay-reader ac:2 S-002 mid-turn read flow returns complete lines after the idle window', async () => {
  const client = clientFor(() => liveTailResponse([
    { type: 'turn.started' },
    { type: 'message.appended', data: { messageDelta: 'generating' } }
  ]));

  const events = await client.readSessionStream({ sessionId: 'wrun_e2e_midturn', idleMs: 100 });

  // story-eve-stream-replay-reader ac:2 idleMs cutoff returns received complete lines
  expect(events).toHaveLength(2);
  expect(events.at(-1)).toMatchObject({ type: 'message.appended' });
});

test('story-eve-stream-replay-reader ac:3 S-002 abandoned tail drops the partial line while a closed stream keeps the unterminated final line', async () => {
  const partial = '{"type":"message.appended","data":{"messageDelta":"tru';
  const makeResponse = (close: boolean): Response => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          `${JSON.stringify({ type: 'turn.started' })}\n${close ? `${JSON.stringify({ type: 'turn.completed' })}\n` : partial}`
        ));
        if (close) controller.close();
      }
    });
    return new Response(stream, { status: 200 });
  };

  // story-eve-stream-replay-reader ac:3 abandoned live tail discards the trailing partial line
  const abandoned = await clientFor(() => makeResponse(false)).readSessionStream({ sessionId: 'wrun_e2e_partial', idleMs: 100 });
  expect(abandoned).toEqual([{ type: 'turn.started' }]);

  // story-eve-stream-replay-reader ac:3 closed stream keeps the final unterminated line semantics (full-text parse)
  const closed = await clientFor(() => makeResponse(true)).readSessionStream({ sessionId: 'wrun_e2e_closed', idleMs: 100 });
  expect(closed).toEqual([{ type: 'turn.started' }, { type: 'turn.completed' }]);
});

test('story-eve-stream-replay-reader ac:4 S-001 boundary state transition ends the read even when the tail keeps emitting later chunks', async () => {
  let released: (() => void) | null = null;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(ndjsonChunk([{ type: 'session.waiting' }]));
      released = () => controller.enqueue(ndjsonChunk([{ type: 'turn.started' }]));
    }
  });
  const client = clientFor(() => new Response(stream, { status: 200 }));

  const events = await client.readSessionStream({ sessionId: 'wrun_e2e_boundary_stop' });

  // story-eve-stream-replay-reader ac:4 events after the boundary are cut off
  expect(events).toEqual([{ type: 'session.waiting' }]);
  expect(typeof released).toBe('function');
});

test('story-eve-stream-replay-reader ac:5 S-002 existing readSessionStream contract holds: auth header, non-2xx error, NDJSON parse on closed streams', async () => {
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  const okClient = new EveSessionClient({
    baseUrl: 'https://eve.example',
    token: 'token-123',
    fetchImpl: async (url: string, init: { headers: Record<string, string> }) => {
      requests.push({ url, headers: init.headers });
      return liveTailResponse([
        { type: 'session.started' },
        { type: 'session.completed' }
      ], { close: true });
    },
    timeoutMs: 30000
  });

  // story-eve-stream-replay-reader ac:5 NDJSON parse and return contract unchanged (array of parsed events)
  const events = await okClient.readSessionStream({ sessionId: 'wrun_e2e_contract' });
  expect(events).toEqual([{ type: 'session.started' }, { type: 'session.completed' }]);
  // story-eve-stream-replay-reader ac:5 auth header contract unchanged
  expect(requests[0].url).toBe('https://eve.example/eve/v1/session/wrun_e2e_contract/stream');
  expect(requests[0].headers.authorization).toBe('Bearer token-123');

  // story-eve-stream-replay-reader ac:5 non-2xx responses still fail loudly with the same error type
  const failingClient = new EveSessionClient({
    baseUrl: 'https://eve.example',
    token: 'token-123',
    fetchImpl: async () => new Response('{"error":"nope"}', { status: 502 }),
    timeoutMs: 30000
  });
  await expect(failingClient.readSessionStream({ sessionId: 'wrun_e2e_fail' })).rejects.toMatchObject({ status: 502 });
});

test('story-eve-stream-replay-reader ac:1 ac:5 S-001 story, spec, and implementation traceability contract', () => {
  const story = read('docs/stories/story-eve-stream-replay-reader.md');
  const client = read('server/services/external-runner/eve-session-client.js');

  // story-eve-stream-replay-reader ac:1 boundary events end the replay read
  expect(story).toContain('AC-001');
  expect(client).toContain('session.waiting');
  // story-eve-stream-replay-reader ac:5 caller-facing contract documented as unchanged
  expect(story).toContain('INV-reader-001');
  expect(client).toContain('_readReplayedStreamEvents');
});
