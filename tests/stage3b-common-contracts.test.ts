import { describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_EVENT_CONTRACT_VERSION,
  knowledgeEventFingerprint,
  normalizeKnowledgeEvent,
  sameKnowledgeEventIdentity
} from '../src/knowledge-event.js';
import {
  createMeshEnvelope,
  createMeshSendReceipt,
  normalizeMeshEnvelope,
  normalizeMeshNodeProfile
} from '../src/mesh.js';
import {
  createHonchoRequest,
  honchoRequestUrl,
  normalizeHonchoConfig
} from '../src/honcho.js';
import {
  FIRST_VALUE_PRESENTATION_CONTRACT,
  normalizeFirstValueRecord,
  normalizeOnboardingPermissionSnapshot,
  normalizeOnboardingSourceReceipt
} from '../src/onboarding-runtime.js';
import {
  createMcpToolReceipt,
  normalizeLocalMcpRuntimeDescriptor,
  normalizeMcpToolCall
} from '../src/mcp-runtime.js';

function event(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: KNOWLEDGE_EVENT_CONTRACT_VERSION,
    event_id: 'kev_stage3b',
    occurred_at: '2026-10-18T00:00:00.000Z',
    captured_at: '2026-10-18T00:00:01.000Z',
    source: { type: 'test' },
    subject: { type: 'observation', id: 'subject-1' },
    decision_authority: { authorized: false },
    applicability_scope: { scope: 'personal' },
    permission_snapshot: { visibility: 'owner' },
    source_pointer: { uri: 'repo://brainbase@0000000000000000000000000000000000000000#fixture' },
    body_hash: 'a'.repeat(64),
    parent_episode_id: 'episode-1',
    ...overrides
  };
}

describe('stage3b common exports', () => {
  it('normalizes knowledge events and provides stable conflict identity', () => {
    const first = normalizeKnowledgeEvent(event({ extra: { b: 2, a: 1 } }));
    const reordered = normalizeKnowledgeEvent(event({ extra: { a: 1, b: 2 } }));
    expect(first.event_id).toBe('kev_stage3b');
    expect(knowledgeEventFingerprint(first)).toBe(knowledgeEventFingerprint(reordered));
    expect(sameKnowledgeEventIdentity(first, reordered)).toBe(true);
    expect(() => normalizeKnowledgeEvent(event({ body_hash: 'bad' }))).toThrow(/body_hash/);
    expect(() => normalizeKnowledgeEvent(event({ schema_version: 'wrong' }))).toThrow(/schema_version/);
    expect(() => normalizeKnowledgeEvent(event({ occurred_at: 'tomorrow' }))).toThrow(/occurred_at/);
  });

  it('keeps mesh receipts honest and rejects invalid envelope input', () => {
    const envelope = createMeshEnvelope(
      { from: 'node-a', to: 'node-b', type: 'query', payload: { question: 'status' } },
      { now: 1_760_000_000_000, idFactory: () => 'query-1', nonceFactory: () => 'nonce-1' }
    );
    expect(normalizeMeshEnvelope(envelope)).toEqual(envelope);
    expect(createMeshSendReceipt('query-1')).toEqual({
      queryId: 'query-1', status: 'sent', receipt_kind: 'send_ack', answer_status: 'unknown'
    });
    expect(normalizeMeshNodeProfile({ nodeId: 'node-a', principalRef: 'injected:principal', projects: [] })).toMatchObject({ nodeId: 'node-a' });
    expect(() => normalizeMeshEnvelope({ ...envelope, type: 'unknown' })).toThrow(/type/);
  });

  it('keeps Honcho config and request construction free of credentials', () => {
    const config = normalizeHonchoConfig({ apiUrl: 'http://127.0.0.1:8000/', workspaceId: 'brainbase' });
    const request = createHonchoRequest({ method: 'POST', path: '/v3/workspaces/brainbase/peers', body: { name: 'owner' } });
    expect(honchoRequestUrl(config, request)).toBe('http://127.0.0.1:8000/v3/workspaces/brainbase/peers');
    expect(() => normalizeHonchoConfig({ apiUrl: 'https://user:pass@example.test' })).toThrow(/credentials/);
    expect(() => createHonchoRequest({ method: 'GET', path: 'https://example.test' })).toThrow(/path/);
  });

  it('normalizes onboarding receipts without accepting secret/raw fields', () => {
    expect(normalizeOnboardingPermissionSnapshot({ visibility: 'owner', scopes: ['read'] })).toEqual({ visibility: 'owner', scopes: ['read'] });
    expect(normalizeOnboardingSourceReceipt({
      sourceId: 'source-1', evidencePointer: 'local://fixture', contentHash: `sha256:${'b'.repeat(64)}`,
      permissionSnapshot: { visibility: 'owner' }, collectionStatus: 'collected'
    }).sourceId).toBe('source-1');
    expect(normalizeFirstValueRecord({ answerHash: `sha256:${'c'.repeat(64)}`, usedCanonicalIds: ['person-1'] })).toMatchObject({ missingContext: [] });
    expect(FIRST_VALUE_PRESENTATION_CONTRACT.sections).toEqual(['覚えていたこと', 'つながったこと', '次にできること']);
    expect(() => normalizeOnboardingPermissionSnapshot({ password: 'secret' })).toThrow(/forbidden|not allowed|secret/i);
    expect(() => normalizeOnboardingPermissionSnapshot({ visibility: true })).toThrow(/invalid|bounded string/i);
    expect(() => normalizeOnboardingPermissionSnapshot({ clearance: 'internal' })).toThrow(/bounded string/i);
    expect(() => normalizeOnboardingPermissionSnapshot({ scopes: ['read', ...Array.from({ length: 50 }, () => 'read')] })).toThrow(/bounded string|items/i);
    expect(() => normalizeFirstValueRecord({ answerHash: `sha256:${'c'.repeat(64)}`, usedCanonicalIds: Array.from({ length: 51 }, () => 'id') })).toThrow(/at most 50/i);
    expect(() => normalizeFirstValueRecord({ answerHash: `sha256:${'c'.repeat(64)}`, usedCanonicalIds: ['x'.repeat(201)] })).toThrow(/at most 50|bounded/i);
    expect(() => normalizeFirstValueRecord({ answerHash: `sha256:${'c'.repeat(64)}`, usedCanonicalIds: ['id'], missingContext: Array.from({ length: 51 }, () => 'context') })).toThrow(/at most 50/i);
  });

  it('describes local MCP and separates tool completion from verification', () => {
    expect(normalizeLocalMcpRuntimeDescriptor({ packageName: '@unson/brainbase-mcp', command: 'brainbase-mcp', transport: 'stdio', storage: 'local', hostedDependency: false })).toMatchObject({ storage: 'local' });
    expect(normalizeMcpToolCall({ name: 'search', arguments: { query: 'status' } })).toEqual({ name: 'search', arguments: { query: 'status' } });
    expect(createMcpToolReceipt({ tool: 'mesh_query', status: 'accepted', receiptKind: 'send_ack', verified: false })).toEqual({ tool: 'mesh_query', status: 'accepted', receiptKind: 'send_ack', verified: false });
  });
});
