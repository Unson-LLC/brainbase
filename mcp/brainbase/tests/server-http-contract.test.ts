import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import { describe, it } from 'node:test';

import { handleHealthVersionRequest } from '../src/server.js';
import type { RuntimeVersionReadback } from '../src/runtime-version.js';

type ResponseCall =
  | { kind: 'writeHead'; status: number; headers: Record<string, string> }
  | { kind: 'end'; body: string };

function responseCapture() {
  const calls: ResponseCall[] = [];
  const response = {
    writeHead(status: number, headers: Record<string, string>) {
      calls.push({ kind: 'writeHead', status, headers });
    },
    end(body: string) {
      calls.push({ kind: 'end', body });
    },
  } as unknown as Pick<ServerResponse, 'writeHead' | 'end'>;
  return { calls, response };
}

describe('MCP HTTP health version contract', () => {
  it('GET /health/versionはreadbackのstatus、JSON content type、bodyをそのまま返す', () => {
    const readbacks: RuntimeVersionReadback[] = [
      {
        status: 200,
        body: {
          ready: true,
          runtime: {
            git: { sha: 'a'.repeat(40), dirty: false },
            pid: 1234,
            started_at: '2026-09-02T00:00:00.000Z',
          },
        },
      },
      {
        status: 503,
        body: { ready: false, reason: 'runtime_version_unavailable' },
      },
    ];

    for (const readback of readbacks) {
      const { calls, response } = responseCapture();
      assert.equal(
        handleHealthVersionRequest({ method: 'GET', url: '/health/version' }, response, readback),
        true,
      );
      assert.deepEqual(calls, [
        { kind: 'writeHead', status: readback.status, headers: { 'Content-Type': 'application/json' } },
        { kind: 'end', body: JSON.stringify(readback.body) },
      ]);
    }
  });

  it('health version以外のmethod/pathはこのhandlerが処理しない', () => {
    for (const request of [
      { method: 'POST', url: '/health/version' },
      { method: 'GET', url: '/health' },
      { method: 'GET', url: '/health/version?verbose=1' },
    ]) {
      const { calls, response } = responseCapture();
      assert.equal(handleHealthVersionRequest(request, response), false);
      assert.deepEqual(calls, []);
    }
  });
});
