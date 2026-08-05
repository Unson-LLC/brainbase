import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { callBrainbaseTool } from '../src/server.js';
import { loadPersonalOs } from '../src/ssot.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('beginner persona onboarding contract', () => {
  it('keeps source state, review safety, decision meaning, and first-value completion clear for 32 profiles', async () => {
    for (let index = 1; index <= 32; index += 1) {
      const dataDir = await mkdtemp(join(tmpdir(), `brainbase-persona-${index}-`));
      dirs.push(dataDir);

      const legacyRun = await callBrainbaseTool('brainbase_onboarding_start', {
        dataDir,
        valueTarget: '既存の判断を登録する',
        sources: [{ id: 'doc-legacy', mode: 'single_document', status: 'ready' }]
      }) as { runId: string };
      const legacyIngested = await callBrainbaseTool('brainbase_onboarding_ingest', {
        dataDir,
        runId: legacyRun.runId,
        source: {
          sourceId: 'doc-legacy', evidencePointer: 'file://legacy.md', contentHash: `sha256:${'a'.repeat(64)}`,
          permissionSnapshot: { scopes: [] }, collectionStatus: 'collected'
        },
        candidates: [{
          kind: 'decision',
          payload: { decision: `Persona ${index} legacy policy`, topic: 'ontology-runtime' },
          observationClass: 'observed',
          evidenceId: 'legacy-decision'
        }]
      }) as { candidates: Array<{ id: string }> };
      const legacyReviewed = await callBrainbaseTool('brainbase_onboarding_review', {
        dataDir,
        runId: legacyRun.runId,
        actions: [{ candidateId: legacyIngested.candidates[0].id, decision: 'approve', reason: '文書で確認済み' }]
      }) as { promotedCanonicalIds: string[] };
      const legacyDecisionId = legacyReviewed.promotedCanonicalIds.find((id) => id.startsWith('decision-'))!;

      const started = await callBrainbaseTool('brainbase_onboarding_start', {
        dataDir,
        valueTarget: '現在有効なOntology判断を知る',
        sources: [
          { id: 'gmail-main', mode: 'gmail', status: 'waiting_for_authorization' },
          { id: 'drive-current', mode: 'drive', status: 'ready', permissionScope: ['folder:current'] }
        ]
      }) as { id: string; runId: string; selectedSourceIds: string[]; sources: Array<{ id: string; status: string }>; nextAction: { tool: string } };
      expect(started.runId).toBe(started.id);
      expect(started.nextAction.tool).toBe('brainbase_onboarding_ingest');
      expect(started.selectedSourceIds).toEqual(['drive-current']);
      expect(started.sources.find((source) => source.id === 'gmail-main')?.status).toBe('waiting_for_authorization');

      const currentPayload = {
        decision: `Persona ${index} uses Ontology 1.0.0`,
        topic: 'ontology-runtime',
        supersedes: [legacyDecisionId],
        effectiveAt: '2026-08-05T00:00:00.000Z',
        rationale: 'The current reviewed rule replaces the legacy rule.',
        tags: ['ontology', 'reviewed']
      };
      const ingested = await callBrainbaseTool('brainbase_onboarding_ingest', {
        dataDir,
        runId: started.runId,
        source: {
          sourceId: 'drive-current', evidencePointer: 'drive://folder/current', contentHash: `sha256:${'b'.repeat(64)}`,
          permissionSnapshot: { scopes: ['folder:current'] }, collectionStatus: 'collected'
        },
        candidates: [{ kind: 'decision', payload: currentPayload, observationClass: 'inferred', evidenceId: 'current-decision' }]
      }) as { runId: string; candidates: Array<{ id: string }>; nextAction: { tool: string; requiredIds: string[] } };
      const candidateId = ingested.candidates[0].id;
      expect(ingested.runId).toBe(started.runId);
      expect(ingested.nextAction).toMatchObject({ tool: 'brainbase_onboarding_review', requiredIds: [candidateId] });

      await expect(callBrainbaseTool('brainbase_onboarding_review', {
        dataDir,
        runId: started.runId,
        actions: [{ candidateId, decision: 'approve', reason: '推測のまま承認' }]
      })).rejects.toThrow(/use decision "edit" with a human-confirmed payload, or use "reject"/);

      const reviewed = await callBrainbaseTool('brainbase_onboarding_review', {
        dataDir,
        runId: started.runId,
        actions: [{ candidateId, decision: 'edit', reason: '人が内容を確認した', payload: currentPayload }]
      }) as { promotedCanonicalIds: string[]; nextAction: { tool: string; instruction: string } };
      expect(reviewed.nextAction).toMatchObject({ tool: 'brainbase_onboarding_first_value' });
      expect(reviewed.nextAction.instruction).toContain('action=record');
      const currentDecisionId = reviewed.promotedCanonicalIds.find((id) => id.startsWith('decision-'))!;
      const os = await loadPersonalOs(dataDir);
      expect(os.decisions.find((decision) => decision.id === currentDecisionId)).toMatchObject(currentPayload);

      const inference = await callBrainbaseTool('infer_decisions', {
        dataDir, asOf: '2026-08-05T01:00:00.000Z'
      }) as { status: string; activeDecisionIds: string[]; supersededDecisionIds: string[] };
      expect(inference).toMatchObject({
        status: 'resolved',
        activeDecisionIds: [currentDecisionId],
        supersededDecisionIds: [legacyDecisionId]
      });

      await callBrainbaseTool('brainbase_onboarding_first_value', {
        dataDir, runId: started.runId, action: 'record', answerHash: `sha256:${'c'.repeat(64)}`, usedCanonicalIds: [currentDecisionId]
      });
      const completed = await callBrainbaseTool('brainbase_onboarding_first_value', {
        dataDir, runId: started.runId, action: 'review', verdict: 'useful', missingContext: []
      }) as { state: string; runId: string; nextAction: null };
      expect(completed.state).toBe('first_value_answer_reviewed');
      expect(completed.runId).toBe(started.runId);
      expect(completed.nextAction).toBeNull();
    }
  });

  it('puts a plain-language map before the full ontology contract', async () => {
    const result = await callBrainbaseTool('get_ontology') as {
      beginnerGuide: { oneSentence: string; fiveParts: Array<{ id: string }>; suggestedNextTools: string[] };
      version: string;
    };
    expect(result.beginnerGuide.oneSentence).toContain('machine-checkable agreement');
    expect(result.beginnerGuide.fiveParts.map((part) => part.id)).toEqual(['types', 'relations', 'constraints', 'inference', 'evolution']);
    expect(result.beginnerGuide.suggestedNextTools).toEqual(['audit_ontology', 'infer_decisions', 'ontology_impact']);
    expect(result.version).toBe('1.0.0');
  });
});
