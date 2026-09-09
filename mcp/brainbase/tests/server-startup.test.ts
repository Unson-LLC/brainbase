import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

test('published search traverses Graph and reports API failure through real stdio', {timeout: 15000}, async () => {
  let failing = false;
  const token = `fixture.${Buffer.from(JSON.stringify({projectCodes: ['fixture']})).toString('base64url')}.signature`;
  const nodes = [
    {id: 'project-fixture', entity_type: 'project', project_code: 'fixture', payload: {name: 'Fixture'}},
    {id: 'decision-fixture', entity_type: 'decision', project_code: 'fixture', payload: {statement: 'Use the verified source.'}},
  ];
  const api = createServer((req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    assert.equal(req.headers['x-brainbase-projects'], 'fixture');
    res.setHeader('content-type', 'application/json');
    if (failing) { res.writeHead(503); res.end(JSON.stringify({error: 'fixture outage'})); return; }
    const url = new URL(req.url!, 'http://localhost');
    if (url.pathname.endsWith('/search')) {
      res.end(JSON.stringify({records: [{...nodes[1], score: 0.9}], coverage: 'complete', partial_reasons: [], index: {model: 'fixture', ready: 1, pending: 0}})); return;
    }
    const records = url.pathname.endsWith('/edges')
      ? [{id: 'edge-fixture', from_id: 'decision-fixture', to_id: 'project-fixture', rel_type: 'belongs_to_project'}]
      : nodes.filter(node => (!url.searchParams.has('type') || node.entity_type === url.searchParams.get('type'))
        && (!url.searchParams.has('ids') || url.searchParams.get('ids')!.split(',').includes(node.id)));
    res.end(JSON.stringify({records}));
  });
  await new Promise<void>(resolve => api.listen(0, '127.0.0.1', resolve));
  const address = api.address();
  assert.ok(address && typeof address !== 'string');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', fileURLToPath(new URL('../src/index.ts', import.meta.url))],
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {...getDefaultEnvironment(), BRAINBASE_AUTH_MODE: 'service',
      BRAINBASE_GRAPH_API_TOKEN: token, BRAINBASE_GRAPH_API_URL: `http://127.0.0.1:${address.port}`},
    stderr: 'pipe',
  });
  transport.stderr?.resume();
  const client = new Client({name: 'retrieval-stdio-test', version: '1'});
  try {
    await client.connect(transport, {timeout: 10000});
    const catalog = await client.listTools();
    assert.ok(!catalog.tools.some(tool => ['get_context', 'search_wiki'].includes(tool.name)));
    assert.deepEqual((catalog.tools.find(tool => tool.name === 'search')!.inputSchema.properties!.mode as {enum: string[]}).enum, ['semantic']);
    for (const name of ['get_entity', 'resolve_entity', 'list_entities', 'search_personal_kg']) assert.ok(catalog.tools.some(tool => tool.name === name));
    for (const [name, args] of [['get_context', {topic: 'q'}], ['search_wiki', {query: 'q'}], ['search', {query: 'q', mode: 'lexical'}]] as const) {
      const rejected = await client.callTool({name, arguments: args});
      assert.equal(rejected.isError, true); assert.match(JSON.stringify(rejected), /removed|disabled/);
    }
    const semantic = await client.callTool({name: 'search', arguments: {query: '根拠のある判断', project: 'fixture', types: ['decision'], includePhilosophy: false}});
    assert.notEqual(semantic.isError, true);
    assert.match(JSON.stringify(semantic), /decision-fixture/);
    const args = {query: '関連する決定', project: 'fixture', types: ['project', 'decision'], includePhilosophy: false,
      plan: {seed_ids: ['project-fixture'], steps: [{relation: 'belongs_to_project', direction: 'incoming', target_type: 'decision'}]}};
    const result = await client.callTool({name: 'search', arguments: args});
    assert.notEqual(result.isError, true, JSON.stringify(result));
    const content = result.content as {type: string; text: string}[];
    const parsed = JSON.parse(content[0].text);
    assert.deepEqual(parsed.data.candidates.map((candidate: {id: string}) => candidate.id), ['decision-fixture']);
    assert.equal(parsed.data.candidates[0].evidence.statement, 'Use the verified source.');
    assert.equal(parsed.data.candidates[0].paths[0].edges[0].id, 'edge-fixture');
    failing = true;
    const failed = await client.callTool({name: 'search', arguments: args});
    assert.equal(failed.isError, true);
    assert.doesNotMatch(JSON.stringify(failed), /結果を取得/);
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) => api.close(error => error ? reject(error) : resolve()));
  }
});

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
    const failed = await client.callTool({name: 'get_entity', arguments: {type: 'project', id: 'fixture'}});
    assert.equal(failed.isError, true);
    assert.ok(requests > 0, 'Graph is loaded when actually needed');
    assert.doesNotMatch(JSON.stringify(failed), /No context found/);
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) => api.close(error => error ? reject(error) : resolve()));
  }
});
