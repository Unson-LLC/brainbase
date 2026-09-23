import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  JUDGMENT_PROBLEM_SNAPSHOT_VERSION,
  createJudgmentProblemFoundationReferenceProvider,
  loadJudgmentProblemSnapshot,
  saveJudgmentProblemSnapshot,
  type JudgmentProblemReference,
  type JudgmentProblemReferenceResolutionPhase,
  type JudgmentProblemReferenceProvider,
  type JudgmentProblemSnapshot,
  type JudgmentProblemSnapshotAccessProvider
} from '../src/judgment-problem-snapshot.js';
import { createFoundationRevisionStore } from '../src/foundation-store.js';
import { initializePersonalOs } from '../src/ssot.js';
import type { FoundationScope, ModelDefinition, VariableDefinition } from '../src/ontology-foundation.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')}`;
}

function reference(kind: JudgmentProblemReference['kind'], index: number): JudgmentProblemReference {
  return {
    kind,
    id: `${kind}-1`,
    revision: '1',
    digest: `sha256:${index.toString(16).padStart(2, '0').repeat(32)}`,
    scope: { type: 'project', id: 'hotel-alpha' },
    valid_from: '2026-01-01T00:00:00.000Z'
  };
}

function snapshot(question = 'Which rollout should we validate?'): JudgmentProblemSnapshot {
  const kinds: readonly JudgmentProblemReference['kind'][] = [
    'objective',
    'criterion',
    'observation',
    'model',
    'constraint',
    'authority',
    'resource',
    'deadline'
  ];
  return {
    snapshot_version: JUDGMENT_PROBLEM_SNAPSHOT_VERSION,
    problem_id: 'hotel-ai-rollout',
    revision: '1',
    question,
    owner_scope: { type: 'project', id: 'hotel-alpha' },
    references: kinds.map((kind, index) => reference(kind, index)),
    read_policy: {
      ownerId: 'alice',
      visibility: 'private',
      readerIds: ['bob'],
      writerIds: ['alice']
    },
    execution_permission: 'none',
    created_at: '2026-01-01T00:00:00.000Z'
  };
}

function provider(
  calls: Array<{ phase: JudgmentProblemReferenceResolutionPhase; reference: JudgmentProblemReference }>,
  statusFor: Partial<Record<JudgmentProblemReference['kind'], 'missing' | 'not_applicable' | 'unresolved'>> = {}
): JudgmentProblemReferenceProvider {
  return {
    resolve({ reference: item, phase }) {
      calls.push({ phase, reference: item });
      const status = statusFor[item.kind];
      return status === undefined
        ? { status: 'resolved', digest: item.digest }
        : { status, message: `${item.kind} intentionally unresolved` };
    }
  };
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'brainbase-jp-snapshot-'));
  roots.push(root);
  return root;
}

const foundationScope: FoundationScope = {
  subjectIds: ['hotel-alpha'],
  validFrom: '2026-01-01T00:00:00.000Z',
  validUntil: '2026-12-31T00:00:00.000Z'
};

function foundationAcl() {
  return {
    ownerId: 'alice',
    visibility: 'private' as const,
    readerIds: ['bob'],
    writerIds: ['alice']
  };
}

function foundationProvenance() {
  return [{ sourceId: 'story-company-os-problem-snapshot-v1', sourceKind: 'document' as const, evidenceIds: [] }];
}

function foundationVariable(id = 'front-desk-total-minutes'): VariableDefinition {
  return {
    id,
    type: 'variable',
    revision: '1',
    meaning: 'Total front desk handling time including handoff and correction work.',
    adoptionState: 'approved',
    authorizedUses: ['draft', 'judgment', 'evaluation'],
    acl: foundationAcl(),
    storage: 'ontology',
    provenance: foundationProvenance(),
    scope: foundationScope,
    subject: 'front-desk',
    valueKind: 'number',
    unit: 'minute',
    aggregation: 'sum',
    granularity: 'week',
    measurementMethod: 'weekly event aggregation'
  };
}

function foundationModel(variableId: string): ModelDefinition {
  return {
    id: 'ai-handoff-load-model',
    type: 'model',
    revision: '1',
    meaning: 'Estimate total handling load from automated completion and handoff correction work.',
    epistemicState: 'hypothesis',
    adoptionState: 'approved',
    authorizedUses: ['draft', 'judgment'],
    acl: foundationAcl(),
    storage: 'ontology',
    provenance: foundationProvenance(),
    scope: foundationScope,
    inputVariableRefs: [{ id: variableId, type: 'variable', revision: '1' }],
    outputVariableRefs: [{ id: variableId, type: 'variable', revision: '1' }],
    applicability: foundationScope,
    relationship: 'Automation may reduce direct handling while handoff correction may add work.',
    uncertainty: 'Handoff and correction load is not yet measured across all facilities.',
    validationState: 'in_progress'
  };
}

describe('JudgmentProblem snapshot contract', () => {
  it('captures required references, preserves optional omission, and reloads immutably', async () => {
    const root = await temporaryRoot();
    const calls: Array<{ phase: JudgmentProblemReferenceResolutionPhase; reference: JudgmentProblemReference }> = [];
    const original = snapshot();

    const receipt = await saveJudgmentProblemSnapshot({
      root,
      snapshot: original,
      access: { principal: 'alice' },
      referenceProvider: provider(calls)
    });
    const loaded = await loadJudgmentProblemSnapshot({
      root,
      snapshot_id: receipt.snapshot_id,
      access: { principal: 'bob' },
      referenceProvider: provider(calls)
    });

    expect(receipt.status).toBe('created');
    expect(receipt.snapshot_id).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(loaded).toEqual(original);
    expect(loaded.execution_permission).toBe('none');
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(loaded.references)).toBe(true);
    expect(calls).toHaveLength(16);
    expect(calls.slice(0, 8).every((call) => call.phase === 'save')).toBe(true);
    expect(calls.slice(8).every((call) => call.phase === 'read')).toBe(true);
  });

  it('separates historical snapshot replay from current reference ACL resolution', async () => {
    const root = await temporaryRoot();
    const original = snapshot();
    const receipt = await saveJudgmentProblemSnapshot({
      root,
      snapshot: original,
      access: { principal: 'alice' },
      referenceProvider: provider([], {})
    });

    const historicalCalls: Array<{ phase: JudgmentProblemReferenceResolutionPhase; reference: JudgmentProblemReference }> = [];
    await expect(loadJudgmentProblemSnapshot({
      root,
      snapshot_id: receipt.snapshot_id,
      access: { principal: 'bob' },
      reference_resolution: 'historical',
      referenceProvider: provider(historicalCalls)
    })).resolves.toEqual(original);
    expect(historicalCalls).toHaveLength(8);
    expect(historicalCalls.every((call) => call.phase === 'historical_read')).toBe(true);

    await expect(loadJudgmentProblemSnapshot({
      root,
      snapshot_id: receipt.snapshot_id,
      access: { principal: 'bob' },
      reference_resolution: 'historical'
    })).rejects.toMatchObject({ code: 'invalid_request' });

    await expect(loadJudgmentProblemSnapshot({
      root,
      snapshot_id: receipt.snapshot_id,
      access: { principal: 'bob' },
      referenceProvider: provider([], { objective: 'unresolved' })
    })).rejects.toMatchObject({ code: 'unresolved_constraint' });
  });

  it('keeps embedded evidence content addressable and checks current ACL on read', async () => {
    const root = await temporaryRoot();
    const calls: Array<{ action: 'read' | 'write'; principal: string; owner: string }> = [];
    const accessProvider: JudgmentProblemSnapshotAccessProvider = {
      authorize({ action, context, acl }) {
        calls.push({ action, principal: context.principal, owner: acl.ownerId });
        return acl.ownerId === context.principal || acl.readerIds.includes(context.principal);
      }
    };
    const content = { answer: 'handoff', cost: 2 };
    const withEvidence: JudgmentProblemSnapshot = {
      ...snapshot(),
      references: snapshot().references.map((item, index) => index === 0
        ? {
            ...item,
            evidence: {
              mode: 'embedded_content',
              digest: digest({ answer: 'handoff', cost: 2 }),
              content,
              access: {
                ownerId: 'alice',
                visibility: 'private',
                readerIds: ['bob'],
                writerIds: ['alice']
              }
            }
          }
        : item)
    };

    const refCalls: Array<{ phase: JudgmentProblemReferenceResolutionPhase; reference: JudgmentProblemReference }> = [];
    const receipt = await saveJudgmentProblemSnapshot({
      root,
      snapshot: withEvidence,
      access: { principal: 'alice' },
      accessProvider,
      referenceProvider: provider(refCalls)
    });
    const loaded = await loadJudgmentProblemSnapshot({
      root,
      snapshot_id: receipt.snapshot_id,
      access: { principal: 'bob' },
      accessProvider,
      referenceProvider: provider(refCalls)
    });

    expect(loaded.references[0]?.evidence).toMatchObject({
      mode: 'embedded_content',
      content,
      digest: digest(content)
    });
    expect(calls.map((call) => `${call.action}:${call.principal}`)).toEqual([
      'write:alice',
      'read:alice',
      'read:bob',
      'read:bob'
    ]);

    await expect(loadJudgmentProblemSnapshot({
      root,
      snapshot_id: receipt.snapshot_id,
      access: { principal: 'mallory' },
      accessProvider,
      referenceProvider: provider([])
    })).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('fails closed for missing, non-applicable, and unresolved references', async () => {
    for (const [kind, expected] of [
      ['model', 'missing_reference'],
      ['constraint', 'not_applicable'],
      ['objective', 'unresolved_constraint']
    ] as const) {
      const root = await temporaryRoot();
      await expect(saveJudgmentProblemSnapshot({
        root,
        snapshot: snapshot(),
        access: { principal: 'alice' },
        referenceProvider: provider([], { [kind]: expected === 'missing_reference' ? 'missing' : expected === 'not_applicable' ? 'not_applicable' : 'unresolved' })
      })).rejects.toMatchObject({ code: expected });
      await expect(readdir(path.join(root, 'judgment-problem-snapshots'))).rejects.toThrow();
    }
  });

  it('requires an immutable evidence reference to resolve through the provider', async () => {
    const root = await temporaryRoot();
    const immutableEvidence: JudgmentProblemSnapshot = {
      ...snapshot(),
      references: snapshot().references.map((item, index) => index === 0
        ? {
            ...item,
            evidence: {
              mode: 'immutable_reference',
              digest: `sha256:${'e'.repeat(64)}`,
              reference_id: 'observation-log-1',
              reference_revision: '1',
              access: {
                ownerId: 'alice',
                visibility: 'private',
                readerIds: ['bob'],
                writerIds: ['alice']
              }
            }
          }
        : item)
    };

    await expect(saveJudgmentProblemSnapshot({
      root,
      snapshot: immutableEvidence,
      access: { principal: 'alice' },
      referenceProvider: provider([], { evidence: 'missing' })
    })).rejects.toMatchObject({ code: 'missing_reference' });
  });

  it('keeps problem revision immutable and serializes same-revision publication', async () => {
    const root = await temporaryRoot();
    const current = snapshot();
    const results = await Promise.all(Array.from({ length: 4 }, () => saveJudgmentProblemSnapshot({
      root,
      snapshot: current,
      access: { principal: 'alice' },
      referenceProvider: provider([], {})
    })));

    expect(results.filter((result) => result.status === 'created')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'existing')).toHaveLength(3);

    const changed = snapshot('A different question with the same problem revision');
    await expect(saveJudgmentProblemSnapshot({
      root,
      snapshot: changed,
      access: { principal: 'alice' },
      referenceProvider: provider([], {})
    })).rejects.toMatchObject({ code: 'conflict' });

    const loaded = await loadJudgmentProblemSnapshot({
      root,
      problem_id: current.problem_id,
      revision: current.revision,
      access: { principal: 'alice' },
      referenceProvider: provider([], {})
    });
    expect(loaded.question).toBe(current.question);
  });

  it('adapts the generic foundation store without duplicating model or constraint validation', async () => {
    const requested: Array<{ id: string; type: string; revision: string; principal: string }> = [];
    const provider = createJudgmentProblemFoundationReferenceProvider({
      store: {
        async read(reference, context) {
          requested.push({ ...reference, principal: context.principal });
          return { digest: 'sha256:' + 'a'.repeat(64) };
        }
      }
    });
    const item = reference('model', 10);
    const result = await provider.resolve({
      reference: item,
      phase: 'save',
      context: { principal: 'alice' }
    });

    expect(result).toEqual({ status: 'unresolved', message: 'Foundation digest changed' });
    expect(requested).toEqual([{
      id: item.id,
      type: item.kind,
      revision: item.revision,
      principal: 'alice'
    }]);
  });

  it('requires a provider to prove the exact revision digest', async () => {
    const root = await temporaryRoot();
    await expect(saveJudgmentProblemSnapshot({
      root,
      snapshot: snapshot(),
      access: { principal: 'alice' },
      referenceProvider: {
        resolve: () => ({ status: 'resolved' })
      }
    })).rejects.toMatchObject({ code: 'integrity_mismatch' });
  });

  it('uses the real foundation store before optional validation and keeps source historical reads under current ACL', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'brainbase-jp-foundation-'));
    roots.push(dataDir);
    await initializePersonalOs(dataDir);
    const store = createFoundationRevisionStore({ dataDir });
    const variable = foundationVariable();
    const variableRef = await store.create(variable, { principal: 'alice' });
    const modelRef = await store.create(foundationModel(variable.id), { principal: 'alice' });
    const validationCalls: string[] = [];
    const foundationProvider = createJudgmentProblemFoundationReferenceProvider({
      store,
      validate: ({ reference: item, record }) => {
        validationCalls.push(`${item.kind}/${record.definition.id}@${record.definition.revision}`);
        return { status: 'resolved', digest: record.digest as `sha256:${string}` };
      }
    });
    const variableReference = {
      ...reference('variable', 1),
      id: variableRef.id,
      revision: variableRef.revision,
      digest: variableRef.digest as `sha256:${string}`,
      valid_to: '2026-12-31T00:00:00.000Z'
    };
    const modelReference = {
      ...reference('model', 2),
      id: modelRef.id,
      revision: modelRef.revision,
      digest: modelRef.digest as `sha256:${string}`,
      valid_to: '2026-12-31T00:00:00.000Z'
    };

    await expect(foundationProvider.resolve({
      reference: variableReference,
      phase: 'save',
      context: { principal: 'bob' }
    })).resolves.toEqual({ status: 'resolved', digest: variableRef.digest });
    await expect(foundationProvider.resolve({
      reference: modelReference,
      phase: 'save',
      context: { principal: 'bob' }
    })).resolves.toEqual({ status: 'resolved', digest: modelRef.digest });

    const defaultFoundationProvider = createJudgmentProblemFoundationReferenceProvider({ store });
    const expiredReference = {
      ...variableReference,
      valid_to: '2027-12-31T00:00:00.000Z'
    };
    await expect(defaultFoundationProvider.resolve({
      reference: expiredReference,
      phase: 'read',
      context: { principal: 'bob' }
    })).resolves.toMatchObject({ status: 'not_applicable' });
    await expect(defaultFoundationProvider.resolve({
      reference: expiredReference,
      phase: 'historical_read',
      context: { principal: 'bob' }
    })).resolves.toEqual({ status: 'resolved', digest: variableRef.digest });

    const openEndedRef = await store.create({
      ...foundationVariable('open-ended-variable'),
      scope: { subjectIds: ['hotel-alpha'], validFrom: foundationScope.validFrom }
    }, { principal: 'alice' });
    await expect(defaultFoundationProvider.resolve({
      reference: {
        ...variableReference,
        id: openEndedRef.id,
        digest: openEndedRef.digest as `sha256:${string}`,
        valid_to: undefined
      },
      phase: 'save',
      context: { principal: 'bob' }
    })).resolves.toEqual({ status: 'resolved', digest: openEndedRef.digest });

    expect(validationCalls).toEqual([
      'variable/front-desk-total-minutes@1',
      'model/ai-handoff-load-model@1'
    ]);

    const draft = await store.create({
      ...foundationVariable('draft-variable'),
      adoptionState: 'draft',
      authorizedUses: ['draft']
    }, { principal: 'alice' });
    await expect(defaultFoundationProvider.resolve({
      reference: {
        ...variableReference,
        id: draft.id,
        digest: draft.digest as `sha256:${string}`
      },
      phase: 'save',
      context: { principal: 'alice' }
    })).resolves.toMatchObject({ status: 'not_applicable' });
    await expect(foundationProvider.resolve({
      reference: {
        ...variableReference,
        id: draft.id,
        digest: draft.digest as `sha256:${string}`
      },
      phase: 'save',
      context: { principal: 'alice' }
    })).resolves.toMatchObject({ status: 'not_applicable' });
    await expect(defaultFoundationProvider.resolve({
      reference: {
        ...variableReference,
        id: draft.id,
        digest: draft.digest as `sha256:${string}`
      },
      phase: 'historical_read',
      context: { principal: 'alice' }
    })).resolves.toEqual({ status: 'resolved', digest: draft.digest });

    await expect(foundationProvider.resolve({
      reference: { ...modelReference, scope: { type: 'project', id: 'other-hotel' } },
      phase: 'save',
      context: { principal: 'bob' }
    })).resolves.toMatchObject({ status: 'not_applicable' });
    await expect(foundationProvider.resolve({
      reference: { ...modelReference, scope: { type: 'project', id: 'other-hotel' } },
      phase: 'historical_read',
      context: { principal: 'bob' }
    })).resolves.toEqual({ status: 'resolved', digest: modelRef.digest });

    await store.update({
      reference: variableRef,
      next: { ...variable, acl: { ...variable.acl, readerIds: [] } }
    }, { principal: 'alice' });
    await expect(store.read(variableRef, { principal: 'bob' }))
      .rejects.toMatchObject({ code: 'authorization_denied' });
    await expect(foundationProvider.resolve({
      reference: variableReference,
      phase: 'read',
      context: { principal: 'bob' }
    })).rejects.toMatchObject({ code: 'authorization_denied' });
    await expect(foundationProvider.resolve({
      reference: variableReference,
      phase: 'historical_read',
      context: { principal: 'bob' }
    })).rejects.toMatchObject({ code: 'authorization_denied' });
  });

  it('does not let a revoked canonical ACL be bypassed by historical embedded evidence', async () => {
    const root = await temporaryRoot();
    const dataDir = await mkdtemp(path.join(tmpdir(), 'brainbase-jp-embedded-foundation-'));
    roots.push(dataDir);
    await initializePersonalOs(dataDir);
    const store = createFoundationRevisionStore({ dataDir });
    const variable = foundationVariable('embedded-copy-source');
    const variableRef = await store.create(variable, { principal: 'alice' });
    const content = { source: 'canonical-variable', value: 42 };
    const variableReference: JudgmentProblemReference = {
      ...reference('variable', 10),
      id: variableRef.id,
      revision: variableRef.revision,
      digest: variableRef.digest as `sha256:${string}`,
      evidence: {
        mode: 'embedded_content',
        digest: digest(content),
        content,
        access: {
          ownerId: 'alice',
          visibility: 'private',
          readerIds: ['bob'],
          writerIds: ['alice']
        }
      }
    };
    const withEvidence: JudgmentProblemSnapshot = {
      ...snapshot(),
      references: [...snapshot().references, variableReference]
    };
    const receipt = await saveJudgmentProblemSnapshot({
      root,
      snapshot: withEvidence,
      access: { principal: 'alice' },
      referenceProvider: provider([])
    });
    const foundationProvider = createJudgmentProblemFoundationReferenceProvider({ store });
    const referenceProvider: JudgmentProblemReferenceProvider = {
      resolve(input) {
        if (input.reference.kind === 'variable') return foundationProvider.resolve(input);
        return { status: 'resolved', digest: input.reference.digest };
      }
    };

    await expect(loadJudgmentProblemSnapshot({
      root,
      snapshot_id: receipt.snapshot_id,
      access: { principal: 'bob' },
      reference_resolution: 'historical',
      referenceProvider
    })).resolves.toMatchObject({
      references: expect.arrayContaining([expect.objectContaining({
        id: variableRef.id,
        evidence: expect.objectContaining({ content })
      })])
    });

    await store.update({
      reference: variableRef,
      next: { ...variable, acl: { ...variable.acl, readerIds: [] } }
    }, { principal: 'alice' });

    await expect(loadJudgmentProblemSnapshot({
      root,
      snapshot_id: receipt.snapshot_id,
      access: { principal: 'bob' },
      reference_resolution: 'historical',
      referenceProvider
    })).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('does not accept a tampered canonical envelope', async () => {
    const root = await temporaryRoot();
    const receipt = await saveJudgmentProblemSnapshot({
      root,
      snapshot: snapshot(),
      access: { principal: 'alice' },
      referenceProvider: provider([], {})
    });
    const directory = path.join(root, 'judgment-problem-snapshots', 'revisions');
    const files = await readdir(directory);
    expect(files).toHaveLength(1);
    const file = path.join(directory, files[0]!);
    const bytes = await readFile(file, 'utf8');
    await import('node:fs/promises').then(({ writeFile }) => writeFile(file, bytes.replace('Which rollout', 'Tampered rollout')));

    await expect(loadJudgmentProblemSnapshot({
      root,
      snapshot_id: receipt.snapshot_id,
      access: { principal: 'alice' },
      referenceProvider: provider([], {})
    })).rejects.toMatchObject({ code: 'integrity_mismatch' });
  });
});
