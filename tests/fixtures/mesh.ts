import type {
  MeshEnvelope,
  MeshQueryRequest,
  MeshNodeProfile
} from '../../src/mesh.js';

/** Stable values for contract and host-adapter parity tests. */
export const meshEnvelopeFixture: MeshEnvelope = {
  id: 'mesh-envelope-fixture-1',
  from: 'node-fixture-a',
  to: 'node-fixture-b',
  type: 'query',
  payload: {
    question: 'status',
    scope: 'project-fixture'
  },
  ts: 1_760_000_000_000,
  nonce: 'mesh-nonce-fixture-1'
};

export const meshQueryRequestFixture: MeshQueryRequest = {
  queryId: 'mesh-query-fixture-1',
  from: 'node-fixture-a',
  to: 'node-fixture-b',
  question: 'status',
  scope: 'project-fixture'
};

export const meshNodeProfileFixture: MeshNodeProfile = {
  nodeId: 'node-fixture-a',
  principalRef: 'principal-fixture-a',
  roleRank: 1,
  agentRuntime: 'fixture-runtime',
  projects: [
    {
      projectId: 'project-fixture',
      localPath: '/tmp/project-fixture',
      globInclude: ['src/**'],
      ports: { api: 8787 }
    }
  ]
};

export const meshSendReceiptFixture = {
  queryId: meshQueryRequestFixture.queryId,
  status: 'sent' as const,
  receipt_kind: 'send_ack' as const,
  answer_status: 'unknown' as const
};
