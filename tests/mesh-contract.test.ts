import { describe, expect, it } from 'vitest';
import {
  createMeshEnvelope,
  createMeshSendReceipt,
  normalizeMeshEnvelope,
  normalizeMeshNodeProfile,
  normalizeMeshQueryRequest,
  parseMeshEnvelope
} from '../src/mesh.js';
import {
  meshEnvelopeFixture,
  meshNodeProfileFixture,
  meshQueryRequestFixture,
  meshSendReceiptFixture
} from './fixtures/mesh.js';

const baseInput = {
  from: 'node-a',
  to: 'node-b',
  type: 'query' as const,
  payload: { question: 'status' }
};

describe('mesh runtime contract boundaries', () => {
  it('rejects values that JSON cannot carry, including non-finite and cyclic payloads', () => {
    expect(() => createMeshEnvelope({ ...baseInput, payload: Number.NaN })).toThrow(/payload/);
    expect(() => normalizeMeshEnvelope({
      ...createMeshEnvelope(baseInput, { now: 1_760_000_000_000 }),
      payload: Number.POSITIVE_INFINITY
    })).toThrow(/payload/);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => createMeshEnvelope({ ...baseInput, payload: cyclic as never })).toThrow(/payload/);
  });

  it('keeps created envelopes normalizable and rejects invalid timestamps or factories', () => {
    expect(() => createMeshEnvelope(baseInput, { now: 0 })).toThrow(/ts/);
    expect(() => createMeshEnvelope(baseInput, { now: -1 })).toThrow(/ts/);
    expect(() => createMeshEnvelope(baseInput, { idFactory: () => ' ' })).toThrow(/id/);
    expect(() => createMeshEnvelope(baseInput, { nonceFactory: () => '' })).toThrow(/nonce/);

    const envelope = createMeshEnvelope(baseInput, {
      now: 1_760_000_000_000,
      idFactory: () => 'query-1',
      nonceFactory: () => 'nonce-1'
    });
    expect(normalizeMeshEnvelope(envelope)).toEqual(envelope);
  });

  it('parses the host-compatible JSON input shape through the strict contract', () => {
    expect(parseMeshEnvelope(JSON.stringify(meshEnvelopeFixture))).toEqual(meshEnvelopeFixture);
    expect(parseMeshEnvelope(meshEnvelopeFixture)).toEqual(meshEnvelopeFixture);
    expect(parseMeshEnvelope(JSON.stringify({ ...meshEnvelopeFixture, payload: undefined }))).toMatchObject({
      payload: null
    });
    expect(() => parseMeshEnvelope('{"type":')).toThrow(/JSON/);
    expect(() => parseMeshEnvelope(JSON.stringify({ ...meshEnvelopeFixture, ts: 0 }))).toThrow(/ts/);
  });

  it('keeps query, profile, and send-receipt fixtures within their public contracts', () => {
    expect(normalizeMeshNodeProfile(meshNodeProfileFixture)).toEqual(meshNodeProfileFixture);
    expect(normalizeMeshQueryRequest(meshQueryRequestFixture)).toEqual(meshQueryRequestFixture);
    expect(createMeshSendReceipt(meshQueryRequestFixture.queryId)).toEqual(meshSendReceiptFixture);
  });

  it('rejects non-finite profile ports at the host boundary', () => {
    expect(() => normalizeMeshNodeProfile({
      nodeId: 'node-a',
      principalRef: 'principal-a',
      projects: [{ projectId: 'project-a', ports: { api: Number.POSITIVE_INFINITY } }]
    })).toThrow(/ports/);
    expect(normalizeMeshNodeProfile({
      nodeId: 'node-a',
      principalRef: 'principal-a',
      projects: [{ projectId: 'project-a', ports: { api: 8787 } }]
    })).toMatchObject({ projects: [{ ports: { api: 8787 } }] });
  });
});
