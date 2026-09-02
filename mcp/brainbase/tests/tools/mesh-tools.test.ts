import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { handleMeshToolCall } from '../../src/tools/mesh-tools.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('Mesh MCP tools', () => {
  it('APIのpeers envelopeを接続中ピアとして表示する', async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ peers: [{ id: 'node-1', status: 'online' }] }));
    const result = await handleMeshToolCall('mesh_peers', {}, 'https://brainbase.test');
    assert.match(result || '', /node-1/);
    assert.doesNotMatch(result || '', /ありません/);
  });

  it('query応答がqueryIdとsentを持たない場合は失敗する', async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ status: 'sent' }));
    await assert.rejects(() => handleMeshToolCall('mesh_query', { to: 'all', question: 'status?' }, 'https://brainbase.test'), /invalid/i);
  });
});
