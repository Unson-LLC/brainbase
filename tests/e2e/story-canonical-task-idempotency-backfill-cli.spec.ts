import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';

const execFileAsync = promisify(execFile);

type NocoRow = Record<string, unknown> & { Id: number };

function createStubNocoDB(rows: NocoRow[]) {
  let patchCount = 0;
  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ list: rows, pageInfo: { totalRows: rows.length, isLastPage: true } }));
      return;
    }
    if (req.method === 'PATCH') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        patchCount += 1;
        const parsed = JSON.parse(body);
        const target = rows.find(row => String(row.Id) === String(parsed.Id));
        Object.assign(target as object, parsed);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(target));
      });
      return;
    }
    res.statusCode = 405;
    res.end();
  });
  return {
    server,
    getPatchCount: () => patchCount
  };
}

test('canonical-task idempotency backfill ac:1 ac:2 ac:4 S-002 dry-run and apply CLI contract', async () => {
  const rows: NocoRow[] = [
    { Id: 1, 'タイトル': 't1', '冪等キー': 'existing-key' },
    { Id: 2, 'タイトル': 't2' },
    { Id: 3, 'タイトル': 't3' }
  ];
  const stub = createStubNocoDB(rows);
  await new Promise<void>(resolve => stub.server.listen(0, '127.0.0.1', () => resolve()));
  const baseUrl = `http://127.0.0.1:${(stub.server.address() as AddressInfo).port}`;
  const env = { ...process.env, NOCODB_URL: baseUrl, NOCODB_TOKEN: 'e2e-test-token' };

  try {
    const dryRun = await execFileAsync('node', [
      'scripts/backfill-canonical-task-idempotency-keys.js',
      '--dry-run'
    ], { cwd: process.cwd(), env });
    const dryResult = JSON.parse(dryRun.stdout.trim());
    expect(dryResult).toMatchObject({ mode: 'dry-run', total: 3, existing: 1, missing: 2, planned: 2, updated: 0, conflict_count: 0 });
    expect(stub.getPatchCount()).toBe(0);
    expect(rows.filter(row => !row['冪等キー'])).toHaveLength(2);

    const apply = await execFileAsync('node', [
      'scripts/backfill-canonical-task-idempotency-keys.js',
      '--apply'
    ], { cwd: process.cwd(), env });
    const applyResult = JSON.parse(apply.stdout.trim());
    expect(applyResult).toMatchObject({ mode: 'apply', total: 3, existing: 1, missing: 2, planned: 2, updated: 2, conflict_count: 0 });
    expect(stub.getPatchCount()).toBe(2);
    expect(rows.find(row => row.Id === 2)?.['冪等キー']).toBe('legacy:nocodb:2');
    expect(rows.find(row => row.Id === 3)?.['冪等キー']).toBe('legacy:nocodb:3');
    expect(rows.find(row => row.Id === 1)?.['冪等キー']).toBe('existing-key');
    expect(rows.filter(row => !row['冪等キー'])).toHaveLength(0);
  } finally {
    stub.server.closeAllConnections?.();
    await new Promise<void>(resolve => stub.server.close(() => resolve()));
  }
});

test('canonical-task idempotency backfill ac:3 S-001 conflict stops apply before any write', async () => {
  const rows: NocoRow[] = [
    { Id: 1, 'タイトル': 't1', '冪等キー': 'legacy:nocodb:2' },
    { Id: 2, 'タイトル': 't2' }
  ];
  const stub = createStubNocoDB(rows);
  await new Promise<void>(resolve => stub.server.listen(0, '127.0.0.1', () => resolve()));
  const baseUrl = `http://127.0.0.1:${(stub.server.address() as AddressInfo).port}`;
  const env = { ...process.env, NOCODB_URL: baseUrl, NOCODB_TOKEN: 'e2e-test-token' };

  try {
    const apply = await execFileAsync('node', [
      'scripts/backfill-canonical-task-idempotency-keys.js',
      '--apply'
    ], { cwd: process.cwd(), env }).catch(error => error);
    expect(apply.code).toBe(1);
    expect(String(apply.stderr)).toContain('idempotency key conflicts: 1');
    expect(stub.getPatchCount()).toBe(0);
    expect(rows.find(row => row.Id === 2)?.['冪等キー']).toBeUndefined();
  } finally {
    stub.server.closeAllConnections?.();
    await new Promise<void>(resolve => stub.server.close(() => resolve()));
  }
});
