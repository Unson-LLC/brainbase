import { describe, expect, it } from 'vitest';
import { digestFoundationDefinition } from '../src/foundation-catalog.js';
import {
  FOUNDATION_GRAPH_ADOPTION_CONTRACT_VERSION,
  FoundationGraphWriteError,
  normalizeFoundationGraphAdoption,
  validateFoundationGraphAdoption
} from '../src/foundation-graph-write.js';
import { validateFoundationDefinition, type FoundationDefinition } from '../src/ontology-foundation.js';

const projectCode = 'project-1';
const owner = 'person-owner';
const adopter = 'person-gm';
const adoptedAt = '2026-10-03T00:00:00.000Z';

function constraintDraft(overrides: Record<string, unknown> = {}): FoundationDefinition {
  return {
    id: 'no-overnight-runs',
    type: 'constraint',
    revision: '3',
    meaning: 'Do not run GPU jobs overnight.',
    adoptionState: 'draft',
    authorizedUses: ['draft'],
    storage: 'candidate',
    provenance: [{ sourceId: 'source-1', sourceKind: 'candidate', evidenceIds: [] }],
    scope: { subjectIds: [projectCode], validFrom: '2026-01-01T00:00:00.000Z' },
    acl: { ownerId: owner, visibility: 'project', readerIds: [], writerIds: [] },
    epistemicState: 'supported',
    condition: 'Runs end before 22:00 JST.',
    appliesTo: ['gpu-runs'],
    exceptions: [],
    adoptionBasis: [{ id: 'decision-gpu-overnight', type: 'decision', revision: '1' }],
    ...overrides
  } as FoundationDefinition;
}

function input(current: FoundationDefinition, overrides: Record<string, unknown> = {}) {
  return {
    context: { principal: adopter, projectCode },
    row: { id: current.id, type: current.type, revision: current.revision, projectCode, payload: { foundation: current } },
    expected: { revision: current.revision, digest: digestFoundationDefinition(current) },
    adoption: { authorityRef: 'grant:g-gm:2026-09-30T00:00:00.000Z', adoptedAt },
    ...overrides
  };
}

const codes = (result: ReturnType<typeof validateFoundationGraphAdoption>) => result.issues.map((issue) => issue.code);

describe('foundation graph adoption contract (ADR-015)', () => {
  it('adopts the current draft unchanged as the next revision for judgment and evaluation', () => {
    const current = constraintDraft();
    const result = validateFoundationGraphAdoption(input(current));
    expect(result.issues).toEqual([]);
    const adopted = result.normalized!.definition as unknown as Record<string, unknown>;

    expect(result.normalized).toMatchObject({
      contractVersion: FOUNDATION_GRAPH_ADOPTION_CONTRACT_VERSION,
      operation: 'adopt',
      projectCode,
      row: { id: current.id, type: 'constraint', revision: '4', projectCode }
    });
    expect(adopted).toMatchObject({ revision: '4', adoptionState: 'approved', storage: 'ontology', authorizedUses: ['draft', 'judgment', 'evaluation'] });
    expect(validateFoundationDefinition(adopted, { use: 'judgment' }).valid).toBe(true);
    expect(validateFoundationDefinition(adopted, { use: 'execution' }).valid).toBe(false);

    // Only the state, the uses, the storage class and the adoption record change.
    const { revision, adoptionState, storage, authorizedUses, provenance, ...content } = adopted;
    const { revision: _r, adoptionState: _a, storage: _s, authorizedUses: _u, provenance: draftProvenance, ...draftContent } = current as unknown as Record<string, unknown>;
    expect(content).toEqual(draftContent);
    expect(provenance).toEqual([
      ...(draftProvenance as unknown[]),
      { sourceId: 'foundation-adoption:no-overnight-runs@3', sourceKind: 'decision', evidenceIds: ['grant:g-gm:2026-09-30T00:00:00.000Z'] }
    ]);
    expect(result.normalized!.row.payload.adoption).toEqual({
      adoptedBy: adopter,
      authorityRef: 'grant:g-gm:2026-09-30T00:00:00.000Z',
      adoptedRevision: '3',
      adoptedDigest: digestFoundationDefinition(current),
      adoptedAt
    });
    expect(result.normalized!.row.payload.foundation).toBe(result.normalized!.definition);
  });

  it('does not let the owner of the draft adopt it', () => {
    const current = constraintDraft();
    expect(codes(validateFoundationGraphAdoption(input(current, { context: { principal: owner, projectCode } })))).toContain('ADOPTER_IS_OWNER');
  });

  it('refuses when the adopter saw another revision or other content', () => {
    const current = constraintDraft();
    expect(codes(validateFoundationGraphAdoption(input(current, { expected: { revision: '2', digest: digestFoundationDefinition(current) } }))))
      .toContain('ADOPTION_TARGET_CHANGED');
    const seen = constraintDraft({ condition: 'Runs end before 23:00 JST.' });
    expect(codes(validateFoundationGraphAdoption(input(current, { expected: { revision: '3', digest: digestFoundationDefinition(seen) } }))))
      .toContain('ADOPTION_TARGET_CHANGED');
  });

  it('adopts only a draft that is ready for judgment', () => {
    const approved = constraintDraft({ adoptionState: 'approved', storage: 'ontology', authorizedUses: ['draft', 'judgment', 'evaluation'] });
    expect(codes(validateFoundationGraphAdoption(input(approved)))).toContain('ALREADY_ADOPTED');
    const notReady = constraintDraft({ adoptionBasis: [] });
    const refused = validateFoundationGraphAdoption(input(notReady));
    expect(codes(refused)).toContain('DEFINITION_NOT_READY');
    expect(refused.issues.some((issue) => issue.path.includes('adoptionBasis'))).toBe(true);
  });

  it('keeps the draft inside the selected project and requires the authority evidence', () => {
    const outside = constraintDraft({ scope: { subjectIds: ['project-2'], validFrom: '2026-01-01T00:00:00.000Z' } });
    expect(codes(validateFoundationGraphAdoption(input(outside)))).toContain('SCOPE_VIOLATION');
    const current = constraintDraft();
    expect(codes(validateFoundationGraphAdoption(input(current, { adoption: { authorityRef: '', adoptedAt } })))).toContain('AUTHORITY_REQUIRED');
    expect(codes(validateFoundationGraphAdoption(input(current, { adoption: { authorityRef: 'grant:g', adoptedAt: 'yesterday' } })))).toContain('INVALID_INPUT');
    expect(codes(validateFoundationGraphAdoption(input(current, { row: { ...input(current).row, projectCode: 'project-2' } })))).toContain('PROJECT_MISMATCH');
  });

  it('throws every issue from the normalizer', () => {
    const current = constraintDraft();
    expect(() => normalizeFoundationGraphAdoption(input(current, { context: { principal: owner, projectCode } })))
      .toThrow(FoundationGraphWriteError);
    expect(normalizeFoundationGraphAdoption(input(current)).row.revision).toBe('4');
  });
});
