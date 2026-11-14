import { describe, expect, it } from 'vitest';

import { normalizeObjectiveReadback } from '../../ui/objective-readback-contract.js';

const DIGEST = `sha256:${'a'.repeat(64)}`;

function definition(overrides = {}) {
  return {
    id: 'objective-1',
    type: 'objective',
    revision: '1',
    meaning: '対応負荷を減らす',
    adoptionState: 'draft',
    authorizedUses: ['draft'],
    acl: { ownerId: 'owner-1', visibility: 'private', readerIds: [], writerIds: [] },
    storage: 'ontology',
    provenance: [],
    scope: { subjectIds: ['project-1'], validFrom: '2026-01-01T00:00:00.000Z' },
    ...overrides,
  };
}

function readback(record, sourceOverrides = {}) {
  return {
    contract_version: 'brainbase.objective-readback.v1',
    status: 'ready',
    checked_at: '2026-10-12T01:02:03.000Z',
    source: {
      source_type: 'foundation_revision_store',
      source_id: record.definition.id,
      source_version: record.definition.revision,
      digest: record.digest,
      provenance: record.definition.provenance,
      ...sourceOverrides,
    },
    record,
    objective: record,
    reason: null,
  };
}

describe('Objective readback browser contract', () => {
  it('accepts a complete draft shape and checks the requested identity', () => {
    const record = { definition: definition(), digest: DIGEST };
    const payload = readback(record);
    expect(normalizeObjectiveReadback(payload, { id: 'objective-1', revision: '1' })).toBe(payload);
  });

  it('rejects incomplete meaning and malformed digests without recomputing the canonical hash', () => {
    const missingMeaning = { definition: definition({ meaning: undefined }), digest: DIGEST };
    expect(normalizeObjectiveReadback(readback(missingMeaning))).toBeNull();

    const malformedDigest = { definition: definition(), digest: 'sha256:short' };
    expect(normalizeObjectiveReadback(readback(malformedDigest))).toBeNull();
  });

  it('rejects a ready record whose id or revision differs from the requested target', () => {
    const record = { definition: definition(), digest: DIGEST };
    expect(normalizeObjectiveReadback(readback(record), { id: 'objective-other', revision: '1' })).toBeNull();
    expect(normalizeObjectiveReadback(readback(record), { id: 'objective-1', revision: '2' })).toBeNull();
  });
});
