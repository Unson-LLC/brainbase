import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { callBrainbaseTool } from '../../src/server.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('connected-world onboarding acceptance', () => {
  it('[AC-1][AC-2][AC-3][AC-4][AC-5][AC-6][AC-7][AC-8][AC-9][AC-10][AC-11][AC-12][AC-13] completes the bounded reviewed first-value journey', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'brainbase-connected-e2e-'));
    dirs.push(dataDir);
    const started = await callBrainbaseTool('brainbase_onboarding_start', {
      dataDir,
      valueTarget: 'いま動いている案件を知る',
      sources: [
        { id: 'gmail-waiting', mode: 'gmail', status: 'waiting_for_authorization' },
        { id: 'drive-alpha', mode: 'drive', status: 'ready', evidencePointer: 'drive://folder/alpha', permissionScope: ['folder:alpha'] }
      ]
    }) as { id: string; selectedSourceIds: string[] };
    expect(started.selectedSourceIds).toEqual(['drive-alpha']);

    const ingested = await callBrainbaseTool('brainbase_onboarding_ingest', {
      dataDir,
      runId: started.id,
      source: {
        sourceId: 'drive-alpha', evidencePointer: 'drive://folder/alpha', contentHash: `sha256:${'a'.repeat(64)}`,
        permissionSnapshot: { scopes: ['folder:alpha'] }, collectionStatus: 'collected'
      },
      candidates: [{ kind: 'project', payload: { name: 'Alpha Launch' }, observationClass: 'observed', evidenceId: 'drive-item-1' }]
    }) as { candidates: Array<{ id: string }> };
    const reviewed = await callBrainbaseTool('brainbase_onboarding_review', {
      dataDir,
      runId: started.id,
      actions: [{ candidateId: ingested.candidates[0].id, decision: 'approve', reason: 'source metadataで確認済み' }]
    }) as { promotedCanonicalIds: string[] };
    expect(reviewed.promotedCanonicalIds).toContainEqual(expect.stringMatching(/^project-/));

    await callBrainbaseTool('brainbase_onboarding_first_value', {
      dataDir, runId: started.id, action: 'record', answerHash: `sha256:${'b'.repeat(64)}`, usedCanonicalIds: [reviewed.promotedCanonicalIds[0]]
    });
    const completed = await callBrainbaseTool('brainbase_onboarding_first_value', {
      dataDir, runId: started.id, action: 'review', verdict: 'useful', missingContext: []
    }) as { state: string; firstValueReview: { verdict: string } };
    expect(completed).toMatchObject({ state: 'first_value_answer_reviewed', firstValueReview: { verdict: 'useful' } });

    const search = await callBrainbaseTool('search', { dataDir, query: 'Alpha Launch' });
    expect(JSON.stringify(search)).toContain('Alpha Launch');
  });
});
