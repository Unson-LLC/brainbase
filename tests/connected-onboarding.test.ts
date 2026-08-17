import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ConnectedOnboardingRuntime,
  type SourceInventoryInput
} from '../src/connected-onboarding.js';
import { initializePersonalOs, loadPersonalOs } from '../src/ssot.js';

const dirs: string[] = [];

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-connected-onboarding-'));
  dirs.push(dir);
  await initializePersonalOs(dir);
  return dir;
}

function readyDrive(): SourceInventoryInput {
  return {
    id: 'drive-project-a',
    mode: 'drive',
    status: 'ready',
    evidencePointer: 'drive://folder/project-a',
    permissionScope: ['folder:project-a']
  };
}

function clock(...timestamps: string[]): () => Date {
  let index = 0;
  return () => new Date(timestamps[Math.min(index++, timestamps.length - 1)]);
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('ConnectedOnboardingRuntime', () => {
  it('does not convert unavailable sources to ready', async () => {
    const dataDir = await fixture();
    const runtime = new ConnectedOnboardingRuntime(dataDir);
    const run = await runtime.start({
      valueTarget: '今動いている案件を知る',
      sources: [
        { id: 'gmail-main', mode: 'gmail', status: 'waiting_for_authorization' },
        { id: 'drive-main', mode: 'drive', status: 'error', detail: 'connector timeout' }
      ]
    });

    expect(run.path).toBe('blocked');
    expect(run.sources.map((source) => source.status)).toEqual(['waiting_for_authorization', 'error']);
    await expect(runtime.ingest(run.id, {
      source: {
        sourceId: 'drive-main',
        evidencePointer: 'drive://folder/a',
        contentHash: `sha256:${'a'.repeat(64)}`,
        permissionSnapshot: { scopes: ['folder:a'] },
        collectionStatus: 'collected'
      },
      candidates: []
    })).rejects.toThrow(/not ready/);
  });

  it('uses an explicit single document as fallback', async () => {
    const dataDir = await fixture();
    const runtime = new ConnectedOnboardingRuntime(dataDir);
    const run = await runtime.start({
      valueTarget: '優先案件を知る',
      sources: [
        { id: 'gmail-main', mode: 'gmail', status: 'unavailable' },
        { id: 'doc-one', mode: 'single_document', status: 'ready', evidencePointer: 'file:///tmp/project.md', permissionScope: ['document:project.md'] }
      ]
    });

    expect(run.path).toBe('fallback');
    expect(run.selectedSourceIds).toEqual(['doc-one']);
  });

  it('rejects secret and body fields before writing the ledger', async () => {
    const dataDir = await fixture();
    const runtime = new ConnectedOnboardingRuntime(dataDir);
    const run = await runtime.start({ valueTarget: '案件を知る', sources: [readyDrive()] });

    await expect(runtime.ingest(run.id, {
      source: {
        sourceId: 'drive-project-a',
        evidencePointer: 'drive://folder/project-a',
        contentHash: `sha256:${'b'.repeat(64)}`,
        permissionSnapshot: { scopes: ['folder:project-a'], api_key: 'secret-value' },
        collectionStatus: 'collected'
      },
      candidates: []
    })).rejects.toThrow(/forbidden field/);

    await expect(runtime.ingest(run.id, {
      source: {
        sourceId: 'drive-project-a',
        evidencePointer: 'drive://folder/project-a',
        contentHash: `sha256:${'b'.repeat(64)}`,
        permissionSnapshot: { scopes: ['folder:project-a'] },
        collectionStatus: 'collected'
      },
      candidates: [{ kind: 'project', payload: { name: 'Alpha', body: 'raw document' }, observationClass: 'observed', evidenceId: 'e-1' }]
    })).rejects.toThrow(/forbidden field/);
  });

  it('rejects inferred approval and keeps canonical SSOT unchanged when a review batch is invalid', async () => {
    const dataDir = await fixture();
    const runtime = new ConnectedOnboardingRuntime(dataDir);
    const run = await runtime.start({ valueTarget: '案件を知る', sources: [readyDrive()] });
    const ingested = await runtime.ingest(run.id, {
      source: {
        sourceId: 'drive-project-a',
        evidencePointer: 'drive://folder/project-a',
        contentHash: `sha256:${'c'.repeat(64)}`,
        permissionSnapshot: { scopes: ['folder:project-a'] },
        collectionStatus: 'collected'
      },
      candidates: [
        { kind: 'project', payload: { name: 'Observed Alpha' }, observationClass: 'observed', evidenceId: 'e-1' },
        { kind: 'project', payload: { name: 'Inferred Beta' }, observationClass: 'inferred', evidenceId: 'e-2' }
      ]
    });
    const before = await loadPersonalOs(dataDir);

    await expect(runtime.review(run.id, [
      { candidateId: ingested.candidates[0].id, decision: 'approve', reason: 'sourceで確認した' },
      { candidateId: ingested.candidates[1].id, decision: 'approve', reason: '推測だが承認' }
    ])).rejects.toThrow(/inferred candidates cannot be approved/);

    expect(await loadPersonalOs(dataDir)).toEqual(before);
  });

  it('keeps ingest and review retries idempotent and rejects unpromoted first-value ids', async () => {
    const dataDir = await fixture();
    const runtime = new ConnectedOnboardingRuntime(dataDir, {
      now: clock(
        '2026-08-04T00:00:00.000Z',
        '2026-08-04T00:00:10.000Z',
        '2026-08-04T00:00:20.000Z',
        '2026-08-04T00:00:30.000Z',
        '2026-08-04T00:05:00.000Z'
      )
    });
    const run = await runtime.start({ valueTarget: '案件と担当者を知る', sources: [readyDrive()] });
    const input = {
      source: {
        sourceId: 'drive-project-a',
        evidencePointer: 'drive://folder/project-a',
        contentHash: `sha256:${'d'.repeat(64)}`,
        permissionSnapshot: { scopes: ['folder:project-a'] },
        collectionStatus: 'collected' as const
      },
      candidates: [
        { kind: 'project', payload: { name: 'Alpha' }, observationClass: 'observed' as const, evidenceId: 'e-1' },
        { kind: 'person', payload: { name: 'Aki', context: 'Alpha owner', projectId: 'project-11pyri' }, observationClass: 'observed' as const, evidenceId: 'e-2' }
      ]
    };
    const first = await runtime.ingest(run.id, input);
    const retry = await runtime.ingest(run.id, input);
    expect(retry.candidates.map((candidate) => candidate.id)).toEqual(first.candidates.map((candidate) => candidate.id));

    const actions = first.candidates.map((candidate) => ({ candidateId: candidate.id, decision: 'approve' as const, reason: '確認済み' }));
    const reviewed = await runtime.review(run.id, actions);
    const reviewedRetry = await runtime.review(run.id, actions);
    expect(reviewedRetry.promotedCanonicalIds).toEqual(reviewed.promotedCanonicalIds);
    const os = await loadPersonalOs(dataDir);
    expect(os.graph.entities.filter((entity) => entity.name === 'Alpha')).toHaveLength(1);
    expect(os.graph.entities.filter((entity) => entity.name === 'Aki')).toHaveLength(1);
    expect(os.graph.version).toBe(2);
    if (os.graph.version === 2) {
      const edge = os.graph.edges.find((item) => item.relation === 'participates_in' && item.toId === 'project-11pyri');
      expect(edge).toBeDefined();
      expect(reviewed.promotedCanonicalIds).toContain(edge!.id);
      expect(edge?.provenance?.sourceKind).toBe('onboarding');
    }

    await expect(runtime.firstValue(run.id, {
      action: 'record',
      answerHash: `sha256:${'e'.repeat(64)}`,
      usedCanonicalIds: ['project-not-promoted']
    })).rejects.toThrow(/not promoted/);

    const recorded = await runtime.firstValue(run.id, {
      action: 'record',
      answerHash: `sha256:${'e'.repeat(64)}`,
      usedCanonicalIds: reviewed.promotedCanonicalIds.slice(0, 1),
      missingContext: ['期限']
    });
    expect(recorded.firstValueReceipt).not.toHaveProperty('answer');
    const completed = await runtime.firstValue(run.id, { action: 'review', verdict: 'useful', missingContext: [] });
    expect(completed.firstValueReview).toMatchObject({ verdict: 'useful', withinTargetSeconds: true });
    expect(await runtime.firstValue(run.id, { action: 'review', verdict: 'useful', missingContext: [] })).toEqual(completed);
    await expect(runtime.firstValue(run.id, { action: 'review', verdict: 'not_useful', missingContext: [] }))
      .rejects.toMatchObject({ code: 'first_value_terminal' });
    await expect(runtime.firstValue(run.id, {
      action: 'record', answerHash: `sha256:${'f'.repeat(64)}`, usedCanonicalIds: reviewed.promotedCanonicalIds.slice(0, 1)
    })).rejects.toMatchObject({ code: 'first_value_terminal' });

    const ledger = await readFile(join(dataDir, 'runs', 'connected-onboarding.json'), 'utf8');
    expect(ledger).not.toContain('raw document');
    expect(ledger).not.toContain('secret-value');
  });

  it.each([
    ['forward', ['Aa', 'BB']],
    ['reverse', ['BB', 'Aa']]
  ])('blocks candidate stable-id collisions without changing canonical files or the ledger (%s)', async (_label, names) => {
    const dataDir = await fixture();
    const runtime = new ConnectedOnboardingRuntime(dataDir);
    const run = await runtime.start({ valueTarget: '案件を知る', sources: [readyDrive()] });
    const ingested = await runtime.ingest(run.id, {
      source: {
        sourceId: 'drive-project-a', evidencePointer: 'drive://folder/project-a', contentHash: `sha256:${'4'.repeat(64)}`,
        permissionSnapshot: { scopes: ['folder:project-a'] }, collectionStatus: 'collected'
      },
      candidates: names.map((name) => ({ kind: 'project', payload: { name }, observationClass: 'observed' as const, evidenceId: `collision-${name}` }))
    });
    const paths = ['graph.json', 'personal-kg.jsonl', 'relationships.json', 'decisions.jsonl', 'runs/connected-onboarding.json'];
    const before = await Promise.all(paths.map((path) => readFile(join(dataDir, path), 'utf8')));

    await expect(runtime.review(run.id, ingested.candidates.map((candidate) => ({
      candidateId: candidate.id, decision: 'approve' as const, reason: '確認済み'
    })))).rejects.toThrow(/canonical_id_collision: project-1mo.*Aa.*BB/);

    expect(await Promise.all(paths.map((path) => readFile(join(dataDir, path), 'utf8')))).toEqual(before);
  });

  it('blocks an existing Graph collision without changing canonical files or the ledger', async () => {
    const dataDir = await fixture();
    const runtime = new ConnectedOnboardingRuntime(dataDir);
    const firstRun = await runtime.start({ valueTarget: '案件を知る', sources: [readyDrive()] });
    const first = await runtime.ingest(firstRun.id, {
      source: {
        sourceId: 'drive-project-a', evidencePointer: 'drive://folder/project-a', contentHash: `sha256:${'5'.repeat(64)}`,
        permissionSnapshot: { scopes: ['folder:project-a'] }, collectionStatus: 'collected'
      },
      candidates: [{ kind: 'project', payload: { name: 'Aa' }, observationClass: 'observed', evidenceId: 'collision-existing-Aa' }]
    });
    await runtime.review(firstRun.id, [{ candidateId: first.candidates[0].id, decision: 'approve', reason: '確認済み' }]);
    const secondRun = await runtime.start({ valueTarget: '別案件を知る', sources: [readyDrive()] });
    const second = await runtime.ingest(secondRun.id, {
      source: {
        sourceId: 'drive-project-a', evidencePointer: 'drive://folder/project-a', contentHash: `sha256:${'6'.repeat(64)}`,
        permissionSnapshot: { scopes: ['folder:project-a'] }, collectionStatus: 'collected'
      },
      candidates: [{ kind: 'project', payload: { name: 'BB' }, observationClass: 'observed', evidenceId: 'collision-existing-BB' }]
    });
    const paths = ['graph.json', 'personal-kg.jsonl', 'relationships.json', 'decisions.jsonl', 'runs/connected-onboarding.json'];
    const before = await Promise.all(paths.map((path) => readFile(join(dataDir, path), 'utf8')));

    await expect(runtime.review(secondRun.id, [{ candidateId: second.candidates[0].id, decision: 'approve', reason: '確認済み' }]))
      .rejects.toThrow(/canonical_id_collision: project-1mo.*Aa.*BB/);

    expect(await Promise.all(paths.map((path) => readFile(join(dataDir, path), 'utf8')))).toEqual(before);
  });

  it('keeps an unscoped person unresolved instead of inventing a project edge', async () => {
    const dataDir = await fixture();
    const runtime = new ConnectedOnboardingRuntime(dataDir);
    const run = await runtime.start({ valueTarget: '担当者を知る', sources: [readyDrive()] });
    const ingested = await runtime.ingest(run.id, {
      source: {
        sourceId: 'drive-project-a',
        evidencePointer: 'drive://folder/project-a',
        contentHash: `sha256:${'a'.repeat(64)}`,
        permissionSnapshot: { scopes: ['folder:project-a'] },
        collectionStatus: 'collected'
      },
      candidates: [{ kind: 'person', payload: { name: 'Unscoped person' }, observationClass: 'observed', evidenceId: 'e-unscoped' }]
    });
    const before = await loadPersonalOs(dataDir);

    await expect(runtime.review(run.id, [{
      candidateId: ingested.candidates[0].id,
      decision: 'approve',
      reason: '人物名だけ確認済み'
    }])).rejects.toMatchObject({
      code: 'candidate_not_promotable',
      message: 'unresolved_project_reference: explicit payload.projectId is required'
    });
    expect(await loadPersonalOs(dataDir)).toEqual(before);
  });

  it('rejects permission authority not explicitly included in the selected source scope', async () => {
    const dataDir = await fixture();
    const runtime = new ConnectedOnboardingRuntime(dataDir);
    const run = await runtime.start({
      valueTarget: '案件を知る',
      sources: [{ id: 'drive-empty', mode: 'drive', status: 'ready', permissionScope: [] }]
    });

    await expect(runtime.ingest(run.id, {
      source: {
        sourceId: 'drive-empty', evidencePointer: 'drive://folder/outside', contentHash: `sha256:${'f'.repeat(64)}`,
        permissionSnapshot: { scopes: ['folder:outside'] }, collectionStatus: 'collected'
      },
      candidates: []
    })).rejects.toMatchObject({ code: 'permission_scope_denied' });

    await expect(runtime.ingest(run.id, {
      source: {
        sourceId: 'drive-empty', evidencePointer: 'drive://folder/outside', contentHash: `sha256:${'f'.repeat(64)}`,
        permissionSnapshot: { provider: 'x'.repeat(9000) }, collectionStatus: 'collected'
      },
      candidates: []
    })).rejects.toMatchObject({ code: 'permission_snapshot_invalid' });

    await expect(runtime.ingest(run.id, {
      source: {
        sourceId: 'drive-empty', evidencePointer: 'drive://folder/outside', contentHash: `sha256:${'f'.repeat(64)}`,
        permissionSnapshot: { scope: 42, clearance: true }, collectionStatus: 'collected'
      },
      candidates: []
    })).rejects.toMatchObject({ code: 'permission_snapshot_invalid' });
  });

  it('binds candidate identity to evidence, kind, and payload and rejects changed retries', async () => {
    const dataDir = await fixture();
    const runtime = new ConnectedOnboardingRuntime(dataDir);
    const run = await runtime.start({ valueTarget: '案件を知る', sources: [readyDrive()] });
    const source = {
      sourceId: 'drive-project-a', evidencePointer: 'drive://folder/project-a', contentHash: `sha256:${'1'.repeat(64)}`,
      permissionSnapshot: { scopes: ['folder:project-a'] }, collectionStatus: 'collected' as const
    };
    const first = await runtime.ingest(run.id, { source, candidates: [{ kind: 'project', payload: { name: 'Alpha' }, observationClass: 'observed', evidenceId: 'same-evidence' }] });

    await expect(runtime.ingest(run.id, { source, candidates: [{ kind: 'project', payload: { name: 'Changed' }, observationClass: 'observed', evidenceId: 'same-evidence' }] }))
      .rejects.toMatchObject({ code: 'candidate_retry_conflict' });
    expect((await runtime.get(run.id)).candidates).toEqual(first.candidates);
  });

  it('rejects changed payloads when retrying a terminal edit decision', async () => {
    const dataDir = await fixture();
    const runtime = new ConnectedOnboardingRuntime(dataDir);
    const run = await runtime.start({ valueTarget: '案件を知る', sources: [readyDrive()] });
    const ingested = await runtime.ingest(run.id, {
      source: {
        sourceId: 'drive-project-a', evidencePointer: 'drive://folder/project-a', contentHash: `sha256:${'7'.repeat(64)}`,
        permissionSnapshot: { scopes: ['folder:project-a'] }, collectionStatus: 'collected'
      },
      candidates: [{ kind: 'project', payload: { name: 'Before' }, observationClass: 'inferred', evidenceId: 'edit-retry' }]
    });
    const action = { candidateId: ingested.candidates[0].id, decision: 'edit' as const, reason: '人が確認', payload: { name: 'After' } };
    const reviewed = await runtime.review(run.id, [action]);
    expect(await runtime.review(run.id, [action])).toEqual(reviewed);
    await expect(runtime.review(run.id, [{ ...action, payload: { name: 'Changed again' } }]))
      .rejects.toMatchObject({ code: 'candidate_terminal' });
  });

  it('supports edit reject and same-kind observed merge but rejects inferred merge atomically', async () => {
    const dataDir = await fixture();
    const runtime = new ConnectedOnboardingRuntime(dataDir);
    const run = await runtime.start({ valueTarget: '案件を知る', sources: [readyDrive()] });
    const ingested = await runtime.ingest(run.id, {
      source: {
        sourceId: 'drive-project-a', evidencePointer: 'drive://folder/project-a', contentHash: `sha256:${'2'.repeat(64)}`,
        permissionSnapshot: { scopes: ['folder:project-a'] }, collectionStatus: 'collected'
      },
      candidates: [
        { kind: 'project', payload: { name: 'Alpha', summary: 'source' }, observationClass: 'observed', evidenceId: 'merge-source' },
        { kind: 'project', payload: { name: 'Alpha canonical' }, observationClass: 'observed', evidenceId: 'merge-target' },
        { kind: 'project', payload: { name: 'Reject me' }, observationClass: 'observed', evidenceId: 'reject' },
        { kind: 'project', payload: { name: 'Inferred' }, observationClass: 'inferred', evidenceId: 'inferred' }
      ]
    });
    const [source, target, rejected, inferred] = ingested.candidates;
    const before = await loadPersonalOs(dataDir);
    await expect(runtime.review(run.id, [{ candidateId: inferred.id, decision: 'merge', mergeIntoCandidateId: target.id, reason: '推測を統合' }]))
      .rejects.toMatchObject({ code: 'inferred_not_promotable' });
    expect(await loadPersonalOs(dataDir)).toEqual(before);

    const reviewed = await runtime.review(run.id, [
      { candidateId: source.id, decision: 'merge', mergeIntoCandidateId: target.id, reason: '同一案件と確認' },
      { candidateId: rejected.id, decision: 'reject', reason: '対象外' }
    ]);
    expect(reviewed.candidates.find((item) => item.id === source.id)?.reviewStatus).toBe('merged');
    expect(reviewed.candidates.find((item) => item.id === target.id)?.reviewStatus).toBe('approved');
    expect(reviewed.candidates.find((item) => item.id === rejected.id)?.reviewStatus).toBe('rejected');
  });

  it('rejects merge target alias conflicts before changing canonical or ledger state', async () => {
    const dataDir = await fixture();
    const runtime = new ConnectedOnboardingRuntime(dataDir);
    const run = await runtime.start({ valueTarget: '案件を知る', sources: [readyDrive()] });
    const ingested = await runtime.ingest(run.id, {
      source: {
        sourceId: 'drive-project-a', evidencePointer: 'drive://folder/project-a', contentHash: `sha256:${'8'.repeat(64)}`,
        permissionSnapshot: { scopes: ['folder:project-a'] }, collectionStatus: 'collected'
      },
      candidates: [
        { kind: 'project', payload: { name: 'Source A' }, observationClass: 'observed', evidenceId: 'alias-source-a' },
        { kind: 'project', payload: { name: 'Source B' }, observationClass: 'observed', evidenceId: 'alias-source-b' },
        { kind: 'project', payload: { name: 'Target' }, observationClass: 'observed', evidenceId: 'alias-target' }
      ]
    });
    const [sourceA, sourceB, target] = ingested.candidates;
    const beforeOs = await loadPersonalOs(dataDir);
    const beforeRun = await runtime.get(run.id);

    await expect(runtime.review(run.id, [
      { candidateId: sourceA.id, decision: 'merge', mergeIntoCandidateId: target.id, reason: '統合' },
      { candidateId: target.id, decision: 'reject', reason: '却下' }
    ])).rejects.toMatchObject({ code: 'review_batch_conflict' });
    await expect(runtime.review(run.id, [
      { candidateId: sourceA.id, decision: 'merge', mergeIntoCandidateId: target.id, reason: '統合A' },
      { candidateId: sourceB.id, decision: 'merge', mergeIntoCandidateId: target.id, reason: '統合B' }
    ])).rejects.toMatchObject({ code: 'review_batch_conflict' });
    expect(await loadPersonalOs(dataDir)).toEqual(beforeOs);
    expect(await runtime.get(run.id)).toEqual(beforeRun);
  });

  it('rejects a later merge into an already approved target without changing state', async () => {
    const dataDir = await fixture();
    const runtime = new ConnectedOnboardingRuntime(dataDir);
    const run = await runtime.start({ valueTarget: '案件を知る', sources: [readyDrive()] });
    const ingested = await runtime.ingest(run.id, {
      source: {
        sourceId: 'drive-project-a', evidencePointer: 'drive://folder/project-a', contentHash: `sha256:${'a'.repeat(64)}`,
        permissionSnapshot: { scopes: ['folder:project-a'] }, collectionStatus: 'collected'
      },
      candidates: [
        { kind: 'project', payload: { name: 'Source', summary: 'must not disappear' }, observationClass: 'observed', evidenceId: 'late-source' },
        { kind: 'project', payload: { name: 'Target' }, observationClass: 'observed', evidenceId: 'approved-target' }
      ]
    });
    const [source, target] = ingested.candidates;
    await runtime.review(run.id, [{ candidateId: target.id, decision: 'approve', reason: '先に承認' }]);
    const beforeOs = await loadPersonalOs(dataDir);
    const beforeRun = await runtime.get(run.id);

    await expect(runtime.review(run.id, [{ candidateId: source.id, decision: 'merge', mergeIntoCandidateId: target.id, reason: '後続統合' }]))
      .rejects.toMatchObject({ code: 'merge_target_invalid' });
    expect(await loadPersonalOs(dataDir)).toEqual(beforeOs);
    expect(await runtime.get(run.id)).toEqual(beforeRun);
  });

  it('rejects plural and camel-case credential fields before persistence', async () => {
    const dataDir = await fixture();
    const runtime = new ConnectedOnboardingRuntime(dataDir);
    const run = await runtime.start({ valueTarget: '案件を知る', sources: [readyDrive()] });
    for (const payload of [{ name: 'Alpha', credentials: 'opaque' }, { name: 'Alpha', clientSecrets: 'opaque' }, { name: 'Alpha', apiKeys: ['opaque'] }]) {
      await expect(runtime.ingest(run.id, {
        source: {
          sourceId: 'drive-project-a', evidencePointer: 'drive://folder/project-a', contentHash: `sha256:${'b'.repeat(64)}`,
          permissionSnapshot: { scopes: ['folder:project-a'] }, collectionStatus: 'collected'
        },
        candidates: [{ kind: 'project', payload, observationClass: 'observed', evidenceId: `secret-${Object.keys(payload)[1]}` }]
      })).rejects.toMatchObject({ code: 'secret_or_raw_content_rejected' });
    }
    expect((await runtime.get(run.id)).receipts).toEqual([]);
  });

  it('requires decision-specific review shapes for initial and terminal retries', async () => {
    const dataDir = await fixture();
    const runtime = new ConnectedOnboardingRuntime(dataDir);
    const run = await runtime.start({ valueTarget: '案件を知る', sources: [readyDrive()] });
    const ingested = await runtime.ingest(run.id, {
      source: {
        sourceId: 'drive-project-a', evidencePointer: 'drive://folder/project-a', contentHash: `sha256:${'9'.repeat(64)}`,
        permissionSnapshot: { scopes: ['folder:project-a'] }, collectionStatus: 'collected'
      },
      candidates: [
        { kind: 'project', payload: { name: 'Merge source' }, observationClass: 'observed', evidenceId: 'shape-source' },
        { kind: 'project', payload: { name: 'Merge target' }, observationClass: 'observed', evidenceId: 'shape-target' }
      ]
    });
    const [source, target] = ingested.candidates;
    const action = { candidateId: source.id, decision: 'merge' as const, reason: '同じ案件', mergeIntoCandidateId: target.id };
    const reviewed = await runtime.review(run.id, [action]);
    expect(await runtime.review(run.id, [action])).toEqual(reviewed);
    await expect(runtime.review(run.id, [{ ...action, payload: { name: 'ignored mutation' } }]))
      .rejects.toMatchObject({ code: 'input_invalid' });
    const extraFieldRetry = { ...action, unexpected: true };
    await expect(runtime.review(run.id, [extraFieldRetry]))
      .rejects.toMatchObject({ code: 'input_invalid' });
    await expect(runtime.review(run.id, [{ candidateId: target.id, decision: 'approve', reason: '確認', payload: { name: 'forbidden' } }]))
      .rejects.toMatchObject({ code: 'input_invalid' });
  });

  it('keeps canonical SSOT and ledger together on size and injected publish failures', async () => {
    const dataDir = await fixture();
    const runtime = new ConnectedOnboardingRuntime(dataDir);
    const run = await runtime.start({ valueTarget: '案件を知る', sources: [readyDrive()] });
    const ingested = await runtime.ingest(run.id, {
      source: {
        sourceId: 'drive-project-a', evidencePointer: 'drive://folder/project-a', contentHash: `sha256:${'3'.repeat(64)}`,
        permissionSnapshot: { scopes: ['folder:project-a'] }, collectionStatus: 'collected'
      },
      candidates: [{ kind: 'project', payload: { name: 'Atomic' }, observationClass: 'observed', evidenceId: 'atomic' }]
    });
    const beforeOs = await loadPersonalOs(dataDir);
    const beforeLedger = await readFile(join(dataDir, 'runs', 'connected-onboarding.json'), 'utf8');

    await expect(runtime.review(run.id, [{ candidateId: ingested.candidates[0].id, decision: 'edit', reason: 'oversize', payload: { name: 'x'.repeat(1_100_000) } }]))
      .rejects.toMatchObject({ code: 'ledger_too_large' });
    expect(await loadPersonalOs(dataDir)).toEqual(beforeOs);
    expect(await readFile(join(dataDir, 'runs', 'connected-onboarding.json'), 'utf8')).toBe(beforeLedger);

    process.env.BRAINBASE_SSOT_FAIL_AFTER_PUBLISH = '5';
    try {
      await expect(runtime.review(run.id, [{ candidateId: ingested.candidates[0].id, decision: 'approve', reason: '確認済み' }]))
        .rejects.toThrow(/Injected SSOT publish failure/);
    } finally {
      delete process.env.BRAINBASE_SSOT_FAIL_AFTER_PUBLISH;
    }
    expect(await loadPersonalOs(dataDir)).toEqual(beforeOs);
    expect(await readFile(join(dataDir, 'runs', 'connected-onboarding.json'), 'utf8')).toBe(beforeLedger);
  });

  it('fails loudly on an unsupported ledger schema', async () => {
    const dataDir = await fixture();
    await mkdir(join(dataDir, 'runs'), { recursive: true });
    await writeFile(join(dataDir, 'runs', 'connected-onboarding.json'), JSON.stringify({ schemaVersion: 'connected_onboarding.v999', runs: [] }));
    await expect(new ConnectedOnboardingRuntime(dataDir).get('missing')).rejects.toMatchObject({ code: 'ledger_schema_unsupported' });
  });

  it('fails loudly on malformed runs in the current ledger schema', async () => {
    const dataDir = await fixture();
    await mkdir(join(dataDir, 'runs'), { recursive: true });
    await writeFile(join(dataDir, 'runs', 'connected-onboarding.json'), JSON.stringify({ schemaVersion: 'connected_onboarding.v1', runs: [{}] }));
    await expect(new ConnectedOnboardingRuntime(dataDir).get('missing')).rejects.toMatchObject({ code: 'ledger_schema_unsupported' });
  });

  it('fails loudly on malformed nested data in the current ledger schema', async () => {
    const dataDir = await fixture();
    await mkdir(join(dataDir, 'runs'), { recursive: true });
    await writeFile(join(dataDir, 'runs', 'connected-onboarding.json'), JSON.stringify({
      schemaVersion: 'connected_onboarding.v1',
      runs: [{
        id: 'run-nested', valueTarget: '案件', path: 'warm', state: 'source_ready',
        startedAt: '2026-08-04T00:00:00.000Z', updatedAt: '2026-08-04T00:00:00.000Z',
        sources: [{}], selectedSourceIds: [], receipts: [{}], candidates: [{}], promotedCanonicalIds: []
      }]
    }));
    await expect(new ConnectedOnboardingRuntime(dataDir).get('run-nested')).rejects.toMatchObject({ code: 'ledger_schema_unsupported' });
  });

  it('fails loudly when persisted permission or source receipt backlinks are corrupted', async () => {
    const dataDir = await fixture();
    const runtime = new ConnectedOnboardingRuntime(dataDir);
    const run = await runtime.start({ valueTarget: '案件を知る', sources: [readyDrive()] });
    await runtime.ingest(run.id, {
      source: {
        sourceId: 'drive-project-a', evidencePointer: 'drive://folder/project-a', contentHash: `sha256:${'c'.repeat(64)}`,
        permissionSnapshot: { scopes: ['folder:project-a'] }, collectionStatus: 'collected'
      },
      candidates: [{ kind: 'project', payload: { name: 'Alpha' }, observationClass: 'observed', evidenceId: 'ledger-integrity' }]
    });
    const path = join(dataDir, 'runs', 'connected-onboarding.json');
    const valid = JSON.parse(await readFile(path, 'utf8'));

    const invalidPermission = structuredClone(valid);
    invalidPermission.runs[0].receipts[0].permissionSnapshot = { scope: 42 };
    await writeFile(path, JSON.stringify(invalidPermission));
    await expect(runtime.get(run.id)).rejects.toMatchObject({ code: 'ledger_schema_unsupported' });

    const invalidMode = structuredClone(valid);
    invalidMode.runs[0].receipts[0].mode = 'gmail';
    await writeFile(path, JSON.stringify(invalidMode));
    await expect(runtime.get(run.id)).rejects.toMatchObject({ code: 'ledger_schema_unsupported' });

    const invalidBacklink = structuredClone(valid);
    invalidBacklink.runs[0].receipts[0].candidateIds = [];
    await writeFile(path, JSON.stringify(invalidBacklink));
    await expect(runtime.get(run.id)).rejects.toMatchObject({ code: 'ledger_schema_unsupported' });
  });

  it('fails loudly when persisted review state claims impossible canonical promotion', async () => {
    const dataDir = await fixture();
    const runtime = new ConnectedOnboardingRuntime(dataDir);
    const run = await runtime.start({ valueTarget: '案件を知る', sources: [readyDrive()] });
    const ingested = await runtime.ingest(run.id, {
      source: {
        sourceId: 'drive-project-a', evidencePointer: 'drive://folder/project-a', contentHash: `sha256:${'d'.repeat(64)}`,
        permissionSnapshot: { scopes: ['folder:project-a'] }, collectionStatus: 'collected'
      },
      candidates: [{ kind: 'project', payload: { name: 'Alpha' }, observationClass: 'observed', evidenceId: 'promotion-integrity' }]
    });
    await runtime.review(run.id, [{ candidateId: ingested.candidates[0].id, decision: 'reject', reason: '対象外' }]);
    const path = join(dataDir, 'runs', 'connected-onboarding.json');
    const corrupted = JSON.parse(await readFile(path, 'utf8'));
    corrupted.runs[0].candidates[0].promotedCanonicalIds = ['canonical-does-not-exist'];
    corrupted.runs[0].promotedCanonicalIds = ['canonical-does-not-exist'];
    await writeFile(path, JSON.stringify(corrupted));

    await expect(runtime.get(run.id)).rejects.toMatchObject({ code: 'ledger_schema_unsupported' });
    await expect(runtime.firstValue(run.id, {
      action: 'record', answerHash: `sha256:${'e'.repeat(64)}`, usedCanonicalIds: ['canonical-does-not-exist']
    })).rejects.toMatchObject({ code: 'ledger_schema_unsupported' });
  });

  it('fails loudly when a merged source points to a non-promoted target', async () => {
    const dataDir = await fixture();
    const runtime = new ConnectedOnboardingRuntime(dataDir);
    const run = await runtime.start({ valueTarget: '案件を知る', sources: [readyDrive()] });
    const ingested = await runtime.ingest(run.id, {
      source: {
        sourceId: 'drive-project-a', evidencePointer: 'drive://folder/project-a', contentHash: `sha256:${'1'.repeat(64)}`,
        permissionSnapshot: { scopes: ['folder:project-a'] }, collectionStatus: 'collected'
      },
      candidates: [
        { kind: 'project', payload: { name: 'Merge source' }, observationClass: 'observed', evidenceId: 'corrupt-source' },
        { kind: 'project', payload: { name: 'Merge target' }, observationClass: 'observed', evidenceId: 'corrupt-target' }
      ]
    });
    await runtime.review(run.id, [{
      candidateId: ingested.candidates[0].id,
      decision: 'merge',
      mergeIntoCandidateId: ingested.candidates[1].id,
      reason: '同一案件'
    }]);
    const path = join(dataDir, 'runs', 'connected-onboarding.json');
    const corrupted = JSON.parse(await readFile(path, 'utf8'));
    const target = corrupted.runs[0].candidates[1];
    target.reviewStatus = 'pending';
    delete target.reviewDecision;
    delete target.reviewReason;
    target.promotedCanonicalIds = [];
    corrupted.runs[0].promotedCanonicalIds = [];
    await writeFile(path, JSON.stringify(corrupted));

    await expect(runtime.get(run.id)).rejects.toMatchObject({ code: 'ledger_schema_unsupported' });
  });

  it('fails loudly when a persisted merge source is inferred or differs in kind', async () => {
    const dataDir = await fixture();
    const runtime = new ConnectedOnboardingRuntime(dataDir);
    const run = await runtime.start({ valueTarget: '案件を知る', sources: [readyDrive()] });
    const ingested = await runtime.ingest(run.id, {
      source: {
        sourceId: 'drive-project-a', evidencePointer: 'drive://folder/project-a', contentHash: `sha256:${'2'.repeat(64)}`,
        permissionSnapshot: { scopes: ['folder:project-a'] }, collectionStatus: 'collected'
      },
      candidates: [
        { kind: 'project', payload: { name: 'Merge source' }, observationClass: 'observed', evidenceId: 'source-integrity' },
        { kind: 'project', payload: { name: 'Merge target' }, observationClass: 'observed', evidenceId: 'target-integrity' }
      ]
    });
    await runtime.review(run.id, [{
      candidateId: ingested.candidates[0].id, decision: 'merge', mergeIntoCandidateId: ingested.candidates[1].id, reason: '同一案件'
    }]);
    const path = join(dataDir, 'runs', 'connected-onboarding.json');
    const valid = JSON.parse(await readFile(path, 'utf8'));

    const inferred = structuredClone(valid);
    inferred.runs[0].candidates[0].observationClass = 'inferred';
    await writeFile(path, JSON.stringify(inferred));
    await expect(runtime.get(run.id)).rejects.toMatchObject({ code: 'ledger_schema_unsupported' });

    const differentKind = structuredClone(valid);
    const source = differentKind.runs[0].candidates[0];
    const oldId = source.id;
    source.kind = 'person';
    const digest = createHash('sha256').update([
      run.id, source.sourceId, source.evidenceId, source.kind, source.ingestedPayloadHash
    ].join('\0')).digest('hex');
    source.id = `onb_cand_${digest.slice(0, 32)}`;
    differentKind.runs[0].receipts[0].candidateIds = differentKind.runs[0].receipts[0].candidateIds
      .map((id: string) => id === oldId ? source.id : id);
    await writeFile(path, JSON.stringify(differentKind));
    await expect(runtime.get(run.id)).rejects.toMatchObject({ code: 'ledger_schema_unsupported' });
  });

  it('cross-checks a valid-looking substituted ledger against canonical SSOT', async () => {
    const alphaDir = await fixture();
    const betaDir = await fixture();
    const alphaRuntime = new ConnectedOnboardingRuntime(alphaDir);
    const betaRuntime = new ConnectedOnboardingRuntime(betaDir);
    const promote = async (runtime: ConnectedOnboardingRuntime, name: string) => {
      const run = await runtime.start({ valueTarget: '案件を知る', sources: [readyDrive()] });
      const ingested = await runtime.ingest(run.id, {
        source: {
          sourceId: 'drive-project-a', evidencePointer: 'drive://folder/project-a', contentHash: `sha256:${(name === 'Alpha' ? 'a' : 'b').repeat(64)}`,
          permissionSnapshot: { scopes: ['folder:project-a'] }, collectionStatus: 'collected'
        },
        candidates: [{ kind: 'project', payload: { name }, observationClass: 'observed', evidenceId: `evidence-${name}` }]
      });
      return runtime.review(run.id, [{ candidateId: ingested.candidates[0].id, decision: 'approve', reason: '確認済み' }]);
    };
    await promote(alphaRuntime, 'Alpha');
    const beta = await promote(betaRuntime, 'Beta');
    const betaLedger = await readFile(join(betaDir, 'runs', 'connected-onboarding.json'), 'utf8');
    await writeFile(join(alphaDir, 'runs', 'connected-onboarding.json'), betaLedger);

    await expect(alphaRuntime.get(beta.id)).rejects.toMatchObject({ code: 'ledger_schema_unsupported' });
    await expect(alphaRuntime.firstValue(beta.id, {
      action: 'record', answerHash: `sha256:${'f'.repeat(64)}`, usedCanonicalIds: beta.promotedCanonicalIds
    })).rejects.toMatchObject({ code: 'ledger_schema_unsupported' });
    const betaCandidate = beta.candidates[0];
    await expect(alphaRuntime.ingest(beta.id, {
      source: {
        sourceId: 'drive-project-a', evidencePointer: 'drive://folder/project-a', contentHash: `sha256:${'b'.repeat(64)}`,
        permissionSnapshot: { scopes: ['folder:project-a'] }, collectionStatus: 'collected'
      },
      candidates: [{
        kind: betaCandidate.kind,
        payload: betaCandidate.payload,
        observationClass: betaCandidate.observationClass,
        evidenceId: betaCandidate.evidenceId
      }]
    })).rejects.toMatchObject({ code: 'ledger_schema_unsupported' });
    await expect(alphaRuntime.review(beta.id, [{
      candidateId: betaCandidate.id, decision: 'approve', reason: '確認済み'
    }])).rejects.toMatchObject({ code: 'ledger_schema_unsupported' });
  });

  it('cross-checks every ledger run before get or review of another run', async () => {
    const dataDir = await fixture();
    const runtime = new ConnectedOnboardingRuntime(dataDir);
    const first = await runtime.start({ valueTarget: '最初の案件を知る', sources: [readyDrive()] });
    const firstIngested = await runtime.ingest(first.id, {
      source: {
        sourceId: 'drive-project-a', evidencePointer: 'drive://folder/project-a', contentHash: `sha256:${'4'.repeat(64)}`,
        permissionSnapshot: { scopes: ['folder:project-a'] }, collectionStatus: 'collected'
      },
      candidates: [{ kind: 'project', payload: { name: 'First project' }, observationClass: 'observed', evidenceId: 'first-project' }]
    });
    const firstReviewed = await runtime.review(first.id, [{
      candidateId: firstIngested.candidates[0].id, decision: 'approve', reason: '確認済み'
    }]);
    const second = await runtime.start({ valueTarget: '次の案件を知る', sources: [readyDrive()] });
    const secondIngested = await runtime.ingest(second.id, {
      source: {
        sourceId: 'drive-project-a', evidencePointer: 'drive://folder/project-a', contentHash: `sha256:${'5'.repeat(64)}`,
        permissionSnapshot: { scopes: ['folder:project-a'] }, collectionStatus: 'collected'
      },
      candidates: [{ kind: 'project', payload: { name: 'Second project' }, observationClass: 'observed', evidenceId: 'second-project' }]
    });

    const graphPath = join(dataDir, 'graph.json');
    const graph = JSON.parse(await readFile(graphPath, 'utf8'));
    graph.entities = graph.entities.filter((entity: { id: string }) => !firstReviewed.promotedCanonicalIds.includes(entity.id));
    await writeFile(graphPath, `${JSON.stringify(graph, null, 2)}\n`);

    await expect(runtime.get(second.id)).rejects.toMatchObject({ code: 'ledger_schema_unsupported' });
    await expect(runtime.review(second.id, [{
      candidateId: secondIngested.candidates[0].id, decision: 'approve', reason: '確認済み'
    }])).rejects.toMatchObject({ code: 'ledger_schema_unsupported' });
  });
});
