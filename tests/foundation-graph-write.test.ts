import { describe, expect, it } from 'vitest';
import {
  FoundationGraphWriteError,
  normalizeFoundationGraphWrite,
  validateFoundationGraphWrite
} from '../src/foundation-graph-write.js';

const projectCode = 'project-1';
const owner = 'person-owner';
const writer = 'person-writer';
const scope = {
  subjectIds: [projectCode],
  validFrom: '2026-01-01T00:00:00.000Z'
};

function acl(overrides: Record<string, unknown> = {}) {
  return {
    ownerId: owner,
    visibility: 'project',
    readerIds: [],
    writerIds: [],
    ...overrides
  };
}

function draftDefinition(
  type: 'objective' | 'variable' | 'model' | 'constraint' = 'variable',
  id = 'foundation-1',
  revision = '1',
  overrides: Record<string, unknown> = {}
) {
  const base: Record<string, unknown> = {
    id,
    type,
    revision,
    meaning: `${type} draft`,
    adoptionState: 'draft',
    authorizedUses: ['draft'],
    storage: 'candidate',
    provenance: [{ sourceId: 'source-1', sourceKind: 'candidate', evidenceIds: [] }],
    scope,
    acl: acl(),
    ...overrides
  };
  if (type === 'model') {
    return {
      ...base,
      epistemicState: 'hypothesis',
      ...overrides
    };
  }
  return base;
}

function input(
  definition: Record<string, unknown>,
  context: Record<string, unknown> = { principal: owner, projectCode },
  extras: Record<string, unknown> = {}
) {
  return {
    context,
    row: {
      id: definition.id,
      type: definition.type,
      revision: definition.revision,
      projectCode,
      payload: { foundation: definition }
    },
    expectedNextRevision: definition.revision,
    ...extras
  };
}

function issueCodes(result: ReturnType<typeof validateFoundationGraphWrite>) {
  return result.issues.map((issue) => issue.code);
}

describe('foundation graph draft write contract', () => {
  it('normalizes a new draft without requiring a Graph aggregate version', () => {
    const candidate = draftDefinition();
    const result = validateFoundationGraphWrite(input(candidate));

    expect(result).toMatchObject({ valid: true, status: 'valid', operation: 'create' });
    expect(result.normalized).toMatchObject({
      projectCode,
      row: { id: 'foundation-1', type: 'variable', revision: '1', projectCode }
    });
    expect(result.normalized).not.toHaveProperty('graphVersion');
    expect(normalizeFoundationGraphWrite(input(candidate)).definition).toMatchObject({
      adoptionState: 'draft',
      storage: 'candidate',
      authorizedUses: ['draft']
    });
  });

  it('accepts incomplete Objective and Model definitions at the draft boundary', () => {
    const objective = validateFoundationGraphWrite(input(draftDefinition('objective', 'objective-1')));
    const model = validateFoundationGraphWrite(input(draftDefinition('model', 'model-1')));

    expect(objective.valid).toBe(true);
    expect(model.valid).toBe(true);
  });

  it('accepts all four registered Foundation types as drafts', () => {
    for (const type of ['objective', 'variable', 'model', 'constraint'] as const) {
      const result = validateFoundationGraphWrite(input(draftDefinition(type, `${type}-1`)));
      expect(result.valid, type).toBe(true);
    }
  });

  it('rejects non-draft adoption, storage, and authorization combinations', () => {
    const result = validateFoundationGraphWrite(input(draftDefinition('variable', 'invalid-1', '1', {
      adoptionState: 'approved',
      storage: 'ontology',
      authorizedUses: ['judgment']
    })));

    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('rejects row identity, project, scope, and revision spoofing', () => {
    const definition = draftDefinition();
    const mismatched = input(definition, { principal: owner, projectCode: 'project-2' });
    mismatched.row.id = 'spoofed-id';
    mismatched.row.projectCode = projectCode;
    mismatched.expectedNextRevision = '2';

    const result = validateFoundationGraphWrite(mismatched);

    expect(result.valid).toBe(false);
    expect(issueCodes(result)).toContain('PROJECT_MISMATCH');
    mismatched.context.projectCode = projectCode;
    expect(issueCodes(validateFoundationGraphWrite(mismatched))).toEqual(expect.arrayContaining([
      'ROW_DEFINITION_MISMATCH',
      'REVISION_CONFLICT'
    ]));
    const outsideScope = input(draftDefinition('variable', 'scope-1', '1', { scope: { ...scope, subjectIds: ['other'] } }));
    expect(issueCodes(validateFoundationGraphWrite(outsideScope))).toContain('SCOPE_VIOLATION');
  });

  it.each([null, {}, { ownerId: owner }, { ownerId: owner, writerIds: null }])('rejects malformed ACL without throwing', (invalidAcl) => {
    const result = validateFoundationGraphWrite(input(draftDefinition('variable', 'bad-acl', '1', { acl: invalidAcl })));
    expect(result.valid).toBe(false);
  });

  it('requires the new draft owner to be the trusted principal', () => {
    const result = validateFoundationGraphWrite(input(draftDefinition('variable', 'owned-by-other', '1', {
      acl: acl({ ownerId: 'person-other' })
    })));

    expect(result.valid).toBe(false);
    expect(issueCodes(result)).toContain('OWNER_MISMATCH');
  });

  it('allows an owner update at the next row revision without an aggregate version assertion', () => {
    const current = draftDefinition('variable', 'foundation-1', '1');
    const candidate = draftDefinition('variable', 'foundation-1', '2', { meaning: 'updated draft' });
    const result = validateFoundationGraphWrite(input(candidate, { principal: owner, projectCode }, {
      currentDefinition: current
    }));

    expect(result).toMatchObject({ valid: true, status: 'valid', operation: 'update' });
  });

  it('allows a current ACL writer to update content while rejecting a revoked writer', () => {
    const current = draftDefinition('variable', 'foundation-1', '1', {
      acl: acl({ writerIds: [writer] })
    });
    const candidate = draftDefinition('variable', 'foundation-1', '2', {
      acl: acl({ writerIds: [writer] }),
      meaning: 'writer update'
    });

    const allowed = validateFoundationGraphWrite(input(candidate, { principal: writer, projectCode }, {
      currentDefinition: current
    }));
    const revoked = validateFoundationGraphWrite(input(
      { ...candidate, acl: acl() },
      { principal: writer, projectCode },
      { currentDefinition: { ...current, acl: acl() } }
    ));

    expect(allowed.valid).toBe(true);
    expect(revoked.valid).toBe(false);
    expect(issueCodes(revoked)).toContain('WRITER_NOT_AUTHORIZED');
  });

  it('rejects non-owner ACL changes and ownership transfer', () => {
    const current = draftDefinition('variable', 'foundation-1', '1', {
      acl: acl({ writerIds: [writer] })
    });
    const candidate = draftDefinition('variable', 'foundation-1', '2', {
      acl: acl({ ownerId: owner, writerIds: ['person-new-writer'] })
    });
    const aclChanged = validateFoundationGraphWrite(input(candidate, { principal: writer, projectCode }, {
      currentDefinition: current
    }));
    const transferred = validateFoundationGraphWrite(input(
      { ...candidate, acl: acl({ ownerId: 'person-new-owner' }) },
      { principal: owner, projectCode },
      { currentDefinition: current }
    ));

    expect(aclChanged.valid).toBe(false);
    expect(issueCodes(aclChanged)).toContain('ACL_CHANGE_FORBIDDEN');
    expect(transferred.valid).toBe(false);
    expect(issueCodes(transferred)).toContain('OWNER_MISMATCH');
  });

  it('throws the complete issue set through the throwing normalizer', () => {
    expect(() => normalizeFoundationGraphWrite(input(draftDefinition('variable', 'invalid-throw', '1', {
      adoptionState: 'approved'
    })))).toThrow(FoundationGraphWriteError);
  });
});
