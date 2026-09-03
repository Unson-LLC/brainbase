import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ServerResponse } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { handleHealthVersionRequest } from '../src/server.js';
import type { RuntimeVersionReadback } from '../src/runtime-version.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function reservePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function withRunningMcpHttpServer(
  runtimeEnv: Record<string, string | undefined>,
  inspect: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const port = await reservePort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: packageRoot,
    env: {
      ...process.env,
      MCP_HTTP_HOST: '127.0.0.1',
      MCP_HTTP_PORT: String(port),
      MCP_HTTP_BEARER_TOKEN: 'server-http-contract-token',
      ...runtimeEnv,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });

  try {
    const deadline = Date.now() + 60_000;
    while (!stderr.includes(`Server started on http://127.0.0.1:${port}/mcp`)) {
      if (child.exitCode !== null) throw new Error(`MCP server exited early (${child.exitCode}): ${stderr}`);
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for MCP HTTP server: ${stderr}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await inspect(`http://127.0.0.1:${port}`);
  } finally {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', () => resolve());
      setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 2_000).unref();
    });
  }
}

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
  it('production HTTP serverのGET /health/versionをsocket越しに200/503で読み戻す', async () => {
    const sha = 'b'.repeat(40);
    const startedAt = '2026-09-02T00:00:00.000Z';
    await withRunningMcpHttpServer({
      BRAINBASE_RUNTIME_GIT_SHA: sha,
      BRAINBASE_RUNTIME_GIT_DIRTY: 'false',
      BRAINBASE_RUNTIME_STARTED_AT: startedAt,
    }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health/version`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') || '', /^application\/json/);
      const body = await response.json() as RuntimeVersionReadback['body'];
      assert.equal(body.ready, true);
      assert.equal(body.runtime?.git.sha, sha);
      assert.equal(body.runtime?.git.dirty, false);
      assert.equal(body.runtime?.started_at, startedAt);
      assert.equal(typeof body.runtime?.pid, 'number');
    });

    await withRunningMcpHttpServer({
      BRAINBASE_RUNTIME_GIT_SHA: '',
      BRAINBASE_RUNTIME_STARTED_AT: '',
    }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health/version`);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { ready: false, reason: 'runtime_version_unavailable' });
    });
  });

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
