/**
 * Mesh tools for querying and discovering peers on the brainbase mesh network.
 *
 * Because the MCP server runs as a separate stdio process it cannot call
 * MeshService directly.  Instead these tools hit the Brainbase Express REST
 * API which in turn delegates to MeshService.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const meshTools: Tool[] = [
  {
    name: 'mesh_query',
    description:
      'メッシュ上の他ノードのAIに質問する。各ノードのローカル文脈（タスク状態、コード変更、ブランチ状態）に基づいた回答が返る。',
    inputSchema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: "宛先ノードID。'all'で全ノードに一斉問い合わせ",
        },
        question: {
          type: 'string',
          description: '質問内容',
        },
        scope: {
          type: 'string',
          enum: ['status', 'code', 'project', 'general'],
          description: '質問の種類（デフォルト: general）',
        },
      },
      required: ['to', 'question'],
    },
  },
  {
    name: 'mesh_peers',
    description: 'メッシュに接続中のピア（チームメンバー）の一覧を表示する',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

export async function handleMeshToolCall(
  name: string,
  args: Record<string, unknown>,
  brainbaseUrl: string,
): Promise<string | null> {
  switch (name) {
    case 'mesh_query': {
      const to = args.to as string;
      const question = args.question as string;
      const scope = (args.scope as string) || 'general';

      const response = await fetch(`${brainbaseUrl}/api/mesh/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, question, scope }),
      });

      if (!response.ok) {
        throw new Error(`Mesh query failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return JSON.stringify(data, null, 2);
    }

    case 'mesh_peers': {
      const response = await fetch(`${brainbaseUrl}/api/mesh/peers`);

      if (!response.ok) {
        throw new Error(`Mesh peers request failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as Array<Record<string, unknown>>;

      if (!Array.isArray(data) || data.length === 0) {
        return '接続中のピアはありません。';
      }

      const lines: string[] = [`# メッシュピア一覧 (${data.length})\n`];
      for (const peer of data) {
        const id = peer.id || peer.nodeId || 'unknown';
        const name = peer.name || peer.label || '';
        const status = peer.status || '';
        lines.push(`- **${id}**${name ? ` (${name})` : ''}${status ? ` [${status}]` : ''}`);
      }

      return lines.join('\n');
    }

    default:
      return null;
  }
}
