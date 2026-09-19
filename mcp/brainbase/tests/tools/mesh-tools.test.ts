import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { handleMeshToolCall, meshTools } from '../../src/tools/mesh-tools.js';

const originalFetch = globalThis.fetch;
const apiUrl = 'https://brainbase.test';
const testDependencies = { getToken: async () => 'mesh-test-token' };

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('Mesh MCP tools', () => {
  it('query説明は送信受付と回答の未確認を区別し、一斉送信を約束しない', () => {
    const queryTool = meshTools.find((tool) => tool.name === 'mesh_query');

    assert.ok(queryTool);
    assert.match(queryTool.description, /送信受付/);
    assert.match(queryTool.description, /回答.*未確認/);
    assert.doesNotMatch(queryTool.description, /回答が返る|一斉問い合わせ/);
    assert.doesNotMatch(JSON.stringify(queryTool.inputSchema), /'all'|"all"/);
  });

  it('query受付を認証付きで送り、応答本文がないことを明示する', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let tokenReads = 0;
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({
        queryId: 'query-1', status: 'sent', transport_debug: 'ignored',
      }));
    };

    const result = await handleMeshToolCall(
      'mesh_query',
      { to: 'node-1', question: 'status?', scope: 'status' },
      apiUrl,
      { getToken: async () => { tokenReads += 1; return ' mesh-test-token '; } },
    );

    assert.equal(tokenReads, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${apiUrl}/api/mesh/query`);
    assert.equal(calls[0].init?.method, 'POST');
    assert.deepEqual(calls[0].init?.headers, {
      'Content-Type': 'application/json',
      Authorization: 'Bearer mesh-test-token',
    });
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      to: 'node-1', question: 'status?', scope: 'status',
    });

    const payload = JSON.parse(result || '{}');
    assert.equal(payload.queryId, 'query-1');
    assert.equal(payload.status, 'sent');
    assert.equal(payload.receipt_kind, 'send_ack');
    assert.equal(payload.answer_status, 'unknown');
    assert.match(payload.message, /受信.*回答.*保存.*未確認/);
    assert.deepEqual(Object.keys(payload), [
      'queryId', 'status', 'receipt_kind', 'answer_status', 'message',
    ]);
  });

  it('空tokenではAPIを呼び出さない', async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return new Response('{}');
    };

    await assert.rejects(
      () => handleMeshToolCall('mesh_peers', {}, apiUrl, { getToken: async () => '  ' }),
      /token/i,
    );
    assert.equal(fetchCalls, 0);
  });

  it('unknown toolはtoken取得もfetchもせずnullを返す', async () => {
    let tokenReads = 0;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return new Response('{}');
    };

    const result = await handleMeshToolCall('another_tool', {}, apiUrl, {
      getToken: async () => { tokenReads += 1; return 'mesh-test-token'; },
    });

    assert.equal(result, null);
    assert.equal(tokenReads, 0);
    assert.equal(fetchCalls, 0);
  });

  it('一斉送信、空入力、不正scopeをtoken取得前に拒否する', async () => {
    let tokenReads = 0;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return new Response('{}');
    };
    const dependencies = {
      getToken: async () => { tokenReads += 1; return 'mesh-test-token'; },
    };
    const invalidInputs: Array<Record<string, unknown>> = [
      { to: 'all', question: 'status?' },
      { to: '  ', question: 'status?' },
      { to: 'node-1', question: ' \n ' },
      { to: 'node-1', question: 'status?', scope: 'other' },
      { to: 'node-1', question: 'status?', scope: null },
    ];

    for (const input of invalidInputs) {
      await assert.rejects(
        () => handleMeshToolCall('mesh_query', input, apiUrl, dependencies),
        /query/i,
      );
    }
    assert.equal(tokenReads, 0);
    assert.equal(fetchCalls, 0);
  });

  it('APIのpeers envelopeを認証付きで接続中ピアとして表示する', async () => {
    let authorization: string | null = null;
    globalThis.fetch = async (_input, init) => {
      authorization = new Headers(init?.headers).get('Authorization');
      return new Response(JSON.stringify({ peers: [{ id: 'node-1', status: 'online' }] }));
    };
    const result = await handleMeshToolCall('mesh_peers', {}, apiUrl, testDependencies);
    assert.equal(authorization, 'Bearer mesh-test-token');
    assert.match(result || '', /node-1/);
    assert.doesNotMatch(result || '', /ありません/);
  });

  it('壊れたpeers envelopeを空結果へ丸めない', async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ unexpected: 'shape' }));
    await assert.rejects(
      () => handleMeshToolCall('mesh_peers', {}, apiUrl, testDependencies),
      /invalid/i,
    );
  });

  it('識別子のないpeerをunknownとして表示しない', async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ peers: [{ status: 'online' }] }));
    await assert.rejects(
      () => handleMeshToolCall('mesh_peers', {}, apiUrl, testDependencies),
      /invalid/i,
    );
  });

  it('query応答がqueryIdとsentを持たない場合は失敗する', async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ status: 'sent' }));
    await assert.rejects(
      () => handleMeshToolCall('mesh_query', { to: 'node-1', question: 'status?' }, apiUrl, testDependencies),
      /invalid/i,
    );
  });
});
