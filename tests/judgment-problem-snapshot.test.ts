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
  type JudgmentProblemReferenceProvider,
  type JudgmentProblemSnapshot,
  type JudgmentProblemSnapshotAccessProvider
} from '../src/judgment-problem-snapshot.js';

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
  calls: Array<{ phase: 'save' | 'read'; reference: JudgmentProblemReference }>,
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

describe('JudgmentProblem snapshot contract', () => {
  it('captures required references, preserves optional omission, and reloads immutably', async () => {
    const root = await temporaryRoot();
    const calls: Array<{ phase: 'save' | 'read'; reference: JudgmentProblemReference }> = [];
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

    const refCalls: Array<{ phase: 'save' | 'read'; reference: JudgmentProblemReference }> = [];
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
