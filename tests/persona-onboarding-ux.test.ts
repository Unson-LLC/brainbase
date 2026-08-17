import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { callBrainbaseTool } from '../src/server.js';
import { loadPersonalOs } from '../src/ssot.js';

const dirs: string[] = [];

function stableHash(value: string): string {
  let hashValue = 0;
  for (const char of value) hashValue = ((hashValue << 5) - hashValue + char.charCodeAt(0)) | 0;
  return Math.abs(hashValue).toString(36);
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('beginner-safe onboarding output contract', () => {
  it('keeps source state, review safety, decision meaning, and first-value completion intact across 32 fixtures', async () => {
    for (let index = 1; index <= 32; index += 1) {
      const dataDir = await mkdtemp(join(tmpdir(), `brainbase-persona-${index}-`));
      dirs.push(dataDir);
      const projectName = `Persona ${index} project`;
      const projectId = `project-${stableHash(projectName)}`;

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
        candidates: [
          { kind: 'project', payload: { name: projectName }, observationClass: 'observed', evidenceId: 'project' },
          {
            kind: 'decision',
            payload: { decision: `Persona ${index} legacy policy`, topic: 'ontology-runtime', projectId },
            observationClass: 'observed',
            evidenceId: 'legacy-decision'
          }
        ]
      }) as { candidates: Array<{ id: string }> };
      const legacyReviewed = await callBrainbaseTool('brainbase_onboarding_review', {
        dataDir,
        runId: legacyRun.runId,
        actions: legacyIngested.candidates.map(({ id }) => ({ candidateId: id, decision: 'approve', reason: '文書で確認済み' }))
      }) as { promotedCanonicalIds: string[] };
      const legacyDecisionId = legacyReviewed.promotedCanonicalIds.find((id) => id.startsWith('decision-'))!;

      const started = await callBrainbaseTool('brainbase_onboarding_start', {
        dataDir,
        valueTarget: '現在有効なOntology判断を知る',
        sources: [
          { id: 'gmail-main', mode: 'gmail', status: 'waiting_for_authorization' },
          { id: 'drive-current', mode: 'drive', status: 'ready', permissionScope: ['folder:current'] }
        ]
      }) as {
        id: string;
        runId: string;
        guide: { current: string; completed: string[]; remaining: string; plainText: string };
        selectedSourceIds: string[];
        sources: Array<{ id: string; status: string }>;
        nextAction: { tool: string; label: string; instruction: string; confirmation: { changes: string; reversible: boolean; recovery: string } };
        safetyBoundaries: {
          mode: string;
          review: string;
          resume: string;
          completion: string;
        };
      };
      expect(Object.keys(started).slice(0, 2)).toEqual(['guide', 'nextAction']);
      expect(started.runId).toBe(started.id);
      expect(started.nextAction.tool).toBe('brainbase_onboarding_ingest');
      expect(started.nextAction.label).toBe('準備できた情報源を取り込む');
      expect(started.nextAction.instruction).toContain('取り込みます');
      expect(started.guide).toMatchObject({
        current: '利用する情報源を選びました。',
        remaining: '情報の取り込み、候補の確認、最初の回答の評価が残っています。'
      });
      expect(started.guide.plainText).toContain('次は「準備できた情報源を取り込む」');
      expect(started.guide.plainText).toContain(started.runId);
      expect(started.selectedSourceIds).toEqual(['drive-current']);
      expect(started.sources.find((source) => source.id === 'gmail-main')?.status).toBe('waiting_for_authorization');
      expect(started.safetyBoundaries).toMatchObject({ mode: 'mandatory' });
      expect(started.safetyBoundaries.review).toContain('自動承認');
      expect(started.safetyBoundaries.resume).toContain(started.runId);
      expect(started.safetyBoundaries.completion).toContain('再実行しません');

      const currentPayload = {
        decision: `Persona ${index} uses Ontology 1.0.0`,
        projectId,
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
      }) as {
        runId: string;
        candidates: Array<{ id: string }>;
        guide: { current: string; completed: string[]; remaining: string; plainText: string };
        nextAction: {
          tool: string;
          requiredIds: string[];
          inputHelp: Array<{ field: string; meaning: string; source: string }>;
          confirmation: { changes: string; reversible: boolean; recovery: string; cannotSkip: string; resumeRule: string };
        };
      };
      const candidateId = ingested.candidates[0].id;
      expect(ingested.runId).toBe(started.runId);
      expect(ingested.nextAction).toMatchObject({ tool: 'brainbase_onboarding_review', requiredIds: [candidateId] });
      expect(ingested.guide.current).toBe('取り込んだ候補を確認する段階です。');
      expect(ingested.nextAction.confirmation).toMatchObject({ reversible: true });
      expect(ingested.nextAction.confirmation.changes).toContain('確認した候補だけ');
      expect(ingested.nextAction.confirmation.recovery).toContain('却下');
      expect(ingested.nextAction.confirmation.cannotSkip).toContain('全件自動承認');
      expect(ingested.nextAction.confirmation.resumeRule).toContain(started.runId);
      expect(ingested.nextAction.confirmation.resumeRule).toContain('完了済み');
      expect(ingested.nextAction.inputHelp).toEqual(expect.arrayContaining([
        expect.objectContaining({ field: 'candidateId', source: expect.stringContaining('requiredIds') })
      ]));

      await expect(callBrainbaseTool('brainbase_onboarding_review', {
        dataDir,
        runId: started.runId,
        actions: [{ candidateId, decision: 'approve', reason: '推測のまま承認' }]
      })).rejects.toThrow(/use decision "edit" with a human-confirmed payload, or use "reject"/);

      const reviewed = await callBrainbaseTool('brainbase_onboarding_review', {
        dataDir,
        runId: started.runId,
        actions: [{ candidateId, decision: 'edit', reason: '人が内容を確認した', payload: currentPayload }]
      }) as { promotedCanonicalIds: string[]; nextAction: { tool: string; instruction: string; inputHelp: Array<{ field: string; source: string }> }; guide: { current: string } };
      expect(reviewed.nextAction).toMatchObject({ tool: 'brainbase_onboarding_first_value' });
      expect(reviewed.nextAction.instruction).toContain('action=record');
      expect(reviewed.nextAction.instruction).toContain('回答の記録');
      expect(reviewed.nextAction.inputHelp).toEqual(expect.arrayContaining([
        expect.objectContaining({ field: 'answerHash', source: expect.stringContaining('回答') }),
        expect.objectContaining({ field: 'usedCanonicalIds', source: expect.stringContaining('promotedCanonicalIds') })
      ]));
      expect(reviewed.guide.current).toBe('確認済みの候補を正式な情報として登録しました。');
      const currentDecisionId = reviewed.promotedCanonicalIds.find((id) => id.startsWith('decision-'))!;
      const os = await loadPersonalOs(dataDir);
      expect(os.decisions.find((decision) => decision.id === currentDecisionId)).toMatchObject({
        decision: currentPayload.decision,
        topic: currentPayload.topic,
        supersedes: currentPayload.supersedes,
        effectiveAt: currentPayload.effectiveAt,
        rationale: currentPayload.rationale,
        tags: currentPayload.tags
      });

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
        dataDir,
        runId: started.runId,
        action: 'review',
        verdict: 'useful',
        missingContext: [],
        answerHash: `sha256:${'c'.repeat(64)}`,
        usedCanonicalIds: [currentDecisionId]
      }) as { state: string; runId: string; nextAction: null; guide: { current: string; remaining: string } };
      expect(completed.state).toBe('first_value_answer_reviewed');
      expect(completed.runId).toBe(started.runId);
      expect(completed.nextAction).toBeNull();
      expect(completed.guide).toMatchObject({
        current: '最初の回答の評価まで完了しました。',
        completed: ['情報源の選択', '情報の取り込み', '候補の確認', '最初の回答の記録', '回答の評価'],
        remaining: 'ありません。'
      });
      expect((completed.guide as typeof completed.guide & { plainText: string }).plainText).toContain('完了済み操作は繰り返しません');
    }
  }, 30_000);

  it('puts a plain-language map before the full ontology contract', async () => {
    const result = await callBrainbaseTool('get_ontology') as {
      beginnerGuide: {
        startHere: string;
        oneSentence: string;
        workExample: string;
        fiveParts: Array<{ id: string; name: string; question: string; example: string }>;
        changeSafety: { check: string; recover: string };
        unsafeShortcuts: Array<{
          request: string;
          handling: 'reject_and_explain';
          safeAlternative: string;
        }>;
        toolChooser: Array<{ goal: string; tool: string; when: string }>;
        changeChecklist: string[];
        detailsNotice: string;
        suggestedNextTools: string[];
      };
      version: string;
    };
    expect(Object.keys(result)[0]).toBe('beginnerGuide');
    expect(result.beginnerGuide.startHere).toContain('まずここ');
    expect(result.beginnerGuide.oneSentence).toContain('仕事の言葉');
    expect(result.beginnerGuide.workExample).toContain('新しい方針');
    expect(result.beginnerGuide.fiveParts.map((part) => part.id)).toEqual(['types', 'relations', 'constraints', 'inference', 'evolution']);
    expect(result.beginnerGuide.fiveParts.map((part) => part.name)).toEqual(['種類', '関係', '必須条件', '判断規則', '変更履歴']);
    expect(result.beginnerGuide.changeSafety.check).toContain('影響');
    expect(result.beginnerGuide.changeSafety.recover).toContain('新しい版');
    expect(result.beginnerGuide.unsafeShortcuts).toEqual(expect.arrayContaining([
      expect.objectContaining({ request: expect.stringContaining('履歴を削除'), handling: 'reject_and_explain', safeAlternative: expect.stringContaining('supersedes') }),
      expect.objectContaining({ request: expect.stringContaining('監査を完了扱い'), handling: 'reject_and_explain', safeAlternative: expect.stringContaining('実行結果') }),
      expect.objectContaining({ request: expect.stringContaining('必須項目を空欄'), handling: 'reject_and_explain', safeAlternative: expect.stringContaining('不足') })
    ]));
    expect(result.beginnerGuide.toolChooser).toEqual([
      expect.objectContaining({ goal: '変更の影響を知りたい', tool: 'ontology_impact' }),
      expect.objectContaining({ goal: '現在の不整合を調べたい', tool: 'audit_ontology' }),
      expect.objectContaining({ goal: '現在有効な判断を知りたい', tool: 'infer_decisions' })
    ]);
    expect(result.beginnerGuide.changeChecklist.join(' ')).toContain('変更前');
    expect(result.beginnerGuide.changeChecklist.join(' ')).toContain('実行結果');
    expect(result.beginnerGuide.detailsNotice).toContain('正式契約');
    expect(result.beginnerGuide.suggestedNextTools).toEqual(['audit_ontology', 'infer_decisions', 'ontology_impact']);
    expect(result.version).toBe('2.0.0');
  });
});
