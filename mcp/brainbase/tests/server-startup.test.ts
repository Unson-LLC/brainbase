import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

test('facade stdio stays discoverable when its backend process cannot start', {timeout: 15000}, async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', fileURLToPath(new URL('../src/stdio-facade.ts', import.meta.url)),
      '-e', 'process.exit(78)'],
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {...getDefaultEnvironment(), BRAINBASE_MCP_BACKEND_LAUNCHER: process.execPath},
    stderr: 'pipe',
  });
  transport.stderr?.resume();
  const client = new Client({name: 'facade-process-test', version: '1'});
  try {
    await client.connect(transport, {timeout: 10000});
    const catalog = await client.listTools();
    assert.ok(catalog.tools.some(tool => tool.name === 'brainbase_resolve_turn'));
    const failed = await client.callTool({name: 'list_extension_types', arguments: {}});
    assert.equal(failed.isError, true);
    assert.equal(failed._meta?.['brainbase.retryable'], true);
    assert.deepEqual(await client.listTools(), catalog);
  } finally {
    await client.close();
  }
});

test('stdio discovery does not wait for or request the Graph projection', {timeout: 15000}, async () => {
  let requests = 0;
  const api = createServer((_req, res) => { requests++; res.writeHead(503); res.end(); });
  await new Promise<void>(resolve => api.listen(0, '127.0.0.1', resolve));
  const address = api.address();
  assert.ok(address && typeof address !== 'string');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', fileURLToPath(new URL('../src/index.ts', import.meta.url))],
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {...getDefaultEnvironment(), BRAINBASE_AUTH_MODE: 'service',
      BRAINBASE_GRAPH_API_TOKEN: 'fixture-token', BRAINBASE_GRAPH_API_URL: `http://127.0.0.1:${address.port}`},
    stderr: 'pipe',
  });
  transport.stderr?.resume();
  const client = new Client({name: 'startup-test', version: '1'});
  try {
    await client.connect(transport, {timeout: 10000});
    const catalog = await client.listTools();
    assert.ok(catalog.tools.some(tool => tool.name === 'brainbase_resolve_turn'));
    assert.equal(requests, 0, 'metadata discovery must not fetch Graph');
    const failed = await client.callTool({name: 'get_context', arguments: {topic: 'fixture'}});
    assert.equal(failed.isError, true);
    assert.ok(requests > 0, 'Graph is loaded when actually needed');
    assert.doesNotMatch(JSON.stringify(failed), /No context found/);
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) => api.close(error => error ? reject(error) : resolve()));
  }
});
