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
      '指定したノードへ質問を送信する。成功は送信受付のみを示し、相手の受信・回答・回答保存は未確認。',
    inputSchema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: '宛先ノードID',
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

export interface MeshToolDependencies {
  getToken: () => Promise<string>;
}

async function getBearerHeaders(dependencies: MeshToolDependencies): Promise<{ Authorization: string }> {
  const token = await dependencies.getToken();
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('Mesh authentication token is required');
  }
  return { Authorization: `Bearer ${token.trim()}` };
}

export async function handleMeshToolCall(
  name: string,
  args: Record<string, unknown>,
  brainbaseUrl: string,
  dependencies: MeshToolDependencies,
): Promise<string | null> {
  switch (name) {
    case 'mesh_query': {
      const rawTo = args.to;
      if (typeof rawTo !== 'string' || !rawTo.trim() || rawTo.trim().toLowerCase() === 'all') {
        throw new Error('Mesh query requires a specific destination node ID');
      }
      const to = rawTo.trim();
      const rawQuestion = args.question;
      if (typeof rawQuestion !== 'string' || !rawQuestion.trim()) {
        throw new Error('Mesh query requires a non-empty question');
      }
      const question = rawQuestion;
      const rawScope = args.scope;
      const scope = rawScope === undefined ? 'general' : rawScope;
      if (typeof scope !== 'string' || !['status', 'code', 'project', 'general'].includes(scope)) {
        throw new Error('Mesh query scope is invalid');
      }

      const authorization = await getBearerHeaders(dependencies);

      const response = await fetch(`${brainbaseUrl}/api/mesh/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authorization },
        body: JSON.stringify({ to, question, scope }),
      });

      if (!response.ok) {
        throw new Error(`Mesh query failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as Record<string, unknown>;
      if (!data || typeof data !== 'object' || Array.isArray(data)
        || typeof data.queryId !== 'string' || !data.queryId.trim() || data.status !== 'sent') {
        throw new Error('Mesh query returned an invalid response');
      }
      if ((data.receipt_kind !== undefined && data.receipt_kind !== 'send_ack')
        || (data.answer_status !== undefined && data.answer_status !== 'unknown')) {
        throw new Error('Mesh query returned an invalid response');
      }
      return JSON.stringify({
        queryId: data.queryId,
        status: data.status,
        receipt_kind: 'send_ack',
        answer_status: 'unknown',
        message: '送信受付を確認しました。相手の受信・回答・回答保存は未確認です。',
      }, null, 2);
    }

    case 'mesh_peers': {
      const authorization = await getBearerHeaders(dependencies);
      const response = await fetch(`${brainbaseUrl}/api/mesh/peers`, {
        headers: authorization,
      });

      if (!response.ok) {
        throw new Error(`Mesh peers request failed: ${response.status} ${response.statusText}`);
      }

      const payload = await response.json() as unknown;
      const data = Array.isArray(payload)
        ? payload
        : payload && typeof payload === 'object' && !Array.isArray(payload)
          && Object.prototype.hasOwnProperty.call(payload, 'peers')
          && Array.isArray((payload as { peers?: unknown }).peers)
          ? (payload as { peers: unknown[] }).peers
          : null;

      if (data === null) {
        throw new Error('Mesh peers returned an invalid response');
      }
      if (data.length === 0) {
        return '接続中のピアはありません。';
      }

      const lines: string[] = [`# メッシュピア一覧 (${data.length})\n`];
      for (const peer of data) {
        if (!peer || typeof peer !== 'object' || Array.isArray(peer)) {
          throw new Error('Mesh peers returned an invalid response');
        }
        const candidate = peer as Record<string, unknown>;
        const id = typeof candidate.id === 'string' && candidate.id.trim()
          ? candidate.id
          : typeof candidate.nodeId === 'string' && candidate.nodeId.trim()
            ? candidate.nodeId
            : null;
        if (!id) {
          throw new Error('Mesh peers returned an invalid response');
        }
        const name = typeof candidate.name === 'string'
          ? candidate.name
          : typeof candidate.label === 'string' ? candidate.label : '';
        const status = typeof candidate.status === 'string' ? candidate.status : '';
        lines.push(`- **${id}**${name ? ` (${name})` : ''}${status ? ` [${status}]` : ''}`);
      }

      return lines.join('\n');
    }

    default:
      return null;
  }
}
