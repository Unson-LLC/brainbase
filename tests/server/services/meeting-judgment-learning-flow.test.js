import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { RunReceiptIngestService } from '../../../server/services/run-receipt/ingest-service.js';
import { RunReceiptQueryService } from '../../../server/services/run-receipt/query-service.js';
import { MeetingJudgmentEventAdapter } from '../../../server/services/run-receipt/meeting-judgment-event-adapter.js';
import { InMemoryWorkflowRepository } from '../../../server/services/workflow/workflow-repository.js';
import { ProductionRoutinePorts } from '../../../server/services/routine-runtime/production-routine-ports.js';

const actor = { person_id: 'operator', projectCodes: ['brainbase'], tenant_id: 'tenant-unson', role: 'member' };
const context = { actor, access: { ...actor, personId: 'operator' } };
const evidence = { kind: 'artifact_ref', ref: 'mana:meeting:run-1:event-1' };
function receipt({ defect = false, nodes, project = 'brainbase',
    externalRunId = 'mana:meeting-minutes:run-1:revision:0', status = 'success',
    finishedAt = '2026-09-14T01:02:00Z' } = {}) {
    return {
        contract_version: 'run_receipt.v1',
        source: { type: 'mana', workflow_id: 'cloudflare:meeting-minutes', runtime_target: 'cloudflare' },
        run: {
            project_id: project, external_run_id: externalRunId, status, evidence_state: 'confirmed',
            ...(status === 'failed' ? { blocker_reason: 'proper_name_unresolved' } : {}),
            started_at: '2026-09-14T01:00:00Z', finished_at: finishedAt,
            summary: '議事録配信済み', evidence_refs: [evidence],
            judgment_trace: {
                schema_version: 'meeting_judgment_trace.v1',
                dag: { id: 'mana_meeting_minutes_runtime', version: 'mana_meeting_minutes_runtime.v1' },
                graph_playbook_status: 'not_executed',
                nodes: nodes || [{ id: 'proper_name_validation', event_id: 'event-1', node_version: 'v1',
                    status: 'completed', outcome: 'completed', evidence_refs: [evidence] }],
                glossary: { coverage: defect ? 'partial' : 'confirmed', term_refs: [], unresolved_count: defect ? 1 : 0 },
                quality: { status: 'unknown', evidence_refs: [], issue_codes: defect ? ['proper_name_unresolved'] : [] },
                corrections: [], replay: { status: 'unknown', evidence_refs: [], verified_run_ids: [],
                    changed_version_refs: [], original_failure_refs: [], separate_case_refs: [] }
            }
        },
        delivery: { idempotency_key: `rr1_${createHash('sha256').update(JSON.stringify([project, 'mana', externalRunId])).digest('hex')}`,
            attempt: 1, sent_at: '2026-09-14T01:03:00Z' }
    };
}
function harness(allowedProjects = actor.projectCodes) {
    const repository = new InMemoryWorkflowRepository();
    const events = new Map();
    const knowledgeEventService = { ingest: vi.fn(async (event) => {
        events.set(event.event_id, event);
        return { event_id: event.event_id };
    }) };
    const knowledgeEventRepository = {
        listFeedback: vi.fn(async () => []),
        summarizeRoutineState: vi.fn(async () => ({ unprocessed_count: 0, contradiction_count: 0,
            expired_count: 0, episode_ids: [...events.keys()] }))
    };
    const query = new RunReceiptQueryService({ repository, knowledgeEventRepository,
        assertProjectAccess: (project) => { if (!allowedProjects.includes(project)) throw new Error('forbidden'); } });
    const ingest = new RunReceiptIngestService({ workflowRepository: repository,
        meetingJudgmentEventAdapter: new MeetingJudgmentEventAdapter({ knowledgeEventService }) });
    const candidateRepository = { list: vi.fn(async () => []) };
    candidateRepository.transaction = async (work) => work(candidateRepository);
    const ports = new ProductionRoutinePorts({ knowledgeEventRepository, runReceiptQueryService: query,
        candidateRepository, listJudgmentOutboxExceptions: async () => [], countRunReceiptOutbox: async () => 0,
        personalVaultReadEnabled: false });
    return { repository, events, knowledgeEventService, knowledgeEventRepository, ingest, ports, query };
}

describe('meeting judgment learning flow', () => {
    it('ingests evidence into knowledge and night reconciliation without declaring delivery to be quality confirmation', async () => {
        const h = harness();
        await h.ingest.ingest(receipt(), actor);
        expect(h.events.size).toBe(1);
        expect(h.knowledgeEventService.ingest.mock.calls[0][1].access).toMatchObject({ tenantId: 'tenant-unson' });
        const reconciliation = await h.ports.reconcile({ project_id: 'brainbase' }, context);
        expect(reconciliation.meeting_judgment_learning).toMatchObject({ execution_count: 1, traced_run_count: 1,
            replay: { required: false } });
        expect(reconciliation.meeting_judgment_learning.cause_links).toEqual([]);
        expect(reconciliation.meeting_judgment_learning.coverage).not.toBe('confirmed');
        const night = await h.ports.buildNightOutput({ reconciliation,
            compression: { confirmed: true }, verification: { retrievable: true } }, context);
        expect(night.sleep_causes.some(item => item.code === 'meeting_judgment_learning_unconfirmed')).toBe(false);
    });

    it('retries knowledge linking after receipt persistence without duplicating the run', async () => {
        const h = harness();
        h.knowledgeEventService.ingest.mockRejectedValueOnce(new Error('knowledge unavailable'));
        await expect(h.ingest.ingest(receipt(), actor)).rejects.toMatchObject({ code: 'run_receipt_knowledge_event_link_failed' });
        expect(h.repository.listRuns({ limit: null })).toHaveLength(1);
        await h.ingest.ingest(receipt(), actor);
        expect(h.repository.listRuns({ limit: null })).toHaveLength(1);
        expect(h.events.size).toBe(1);
        expect(h.knowledgeEventService.ingest).toHaveBeenCalledTimes(2);
    });

    it('carries an unresolved meeting defect into the following night without external recollection', async () => {
        const h = harness();
        await h.ingest.ingest(receipt({ defect: true }), actor);
        const reconciliation = await h.ports.reconcile({ input: { project_id: 'brainbase',
            since: '2026-09-15T00:00:00Z', until: '2026-09-16T00:00:00Z' } }, context);
        expect(reconciliation.meeting_judgment_learning).toMatchObject({ execution_count: 1,
            replay: { required: true, verified: false } });
        expect(reconciliation.meeting_judgment_learning.cause_links.length).toBeGreaterThan(0);
        expect(h.knowledgeEventService.ingest).toHaveBeenCalledOnce();
    });

    it('retains recovered failed node evidence without treating that previous attempt as the current defect', async () => {
        const h = harness();
        await h.ingest.ingest(receipt({ nodes: [
            { id: 'context_gate', event_id: 'attempt-1', node_version: 'v1', status: 'blocked', outcome: 'failed', evidence_refs: [evidence] },
            { id: 'context_gate', event_id: 'attempt-2', node_version: 'v1', status: 'completed', outcome: 'completed', evidence_refs: [evidence] }
        ] }), actor);
        const summary = await h.query.summarizeMeetingJudgmentLearning({ project_id: 'brainbase' }, context);
        expect(summary.cause_links).toEqual([]);
        expect(summary.replay.required).toBe(false);
        const run = h.repository.listRuns({ limit: null })[0];
        expect(run.metadata.run_receipt.judgment_trace.nodes).toHaveLength(2);
    });
    it('includes authorized Tech Knight meetings in the Brainbase night routine', async () => {
        const h = harness(['brainbase', 'techknight']);
        const crossProjectActor = { ...actor, projectCodes: ['brainbase', 'techknight'] };
        const crossProjectContext = { actor: crossProjectActor, access: { ...crossProjectActor, personId: 'operator' } };
        await h.ingest.ingest(receipt({ defect: true, project: 'techknight' }), crossProjectActor);
        const result = await h.ports.reconcile({ project_id: 'brainbase' }, crossProjectContext);
        expect(result.meeting_judgment_learning).toMatchObject({ execution_count: 1,
            replay: { required: true, verified: false } });
        expect(result.meeting_judgment_learning.cause_links.length).toBeGreaterThan(0);
    });

    it('links a later correction to an older run in the current night window', async () => {
        const h = harness();
        await h.ingest.ingest(receipt(), actor);
        const run = h.repository.listRuns({ limit: null })[0];
        h.knowledgeEventRepository.listFeedback.mockResolvedValue([{
            feedback_id: 'feedback-1', event_id: [...h.events.keys()][0], action: 'correct',
            created_at: '2026-09-15T12:00:00Z',
            event: { source: { type: 'mana_meeting_judgment', external_run_id: receipt().run.external_run_id },
                source_pointer: { run_id: run.run_id, evidence_refs: [evidence] } },
            payload: { reason: 'アイテルの名称が誤っている', evidence_refs: [evidence] }
        }]);
        const result = await h.ports.reconcile({ input: { project_id: 'brainbase',
            since: '2026-09-15T00:00:00Z', until: '2026-09-16T00:00:00Z' } }, context);
        expect(result.meeting_judgment_learning).toMatchObject({ execution_count: 1, correction_count: 1,
            replay: { required: true, verified: false } });
    });

    it('groups failed receipt attempts with recovery and still links feedback addressed to the old attempt', async () => {
        const h = harness();
        const failed = receipt({ status: 'failed', defect: true,
            externalRunId: `mana:meeting-minutes:run-1:revision:0:status:failed:attempt:${'a'.repeat(64)}` });
        await h.ingest.ingest(failed, actor);
        const failedRun = h.repository.listRuns({ limit: null })[0];
        const failedEventId = [...h.events.keys()][0];
        await h.ingest.ingest(receipt({ finishedAt: '2026-09-14T01:05:00Z' }), actor);
        const recovered = await h.query.summarizeMeetingJudgmentLearning({ project_id: 'brainbase' }, context);
        expect(recovered).toMatchObject({ execution_count: 1, cause_links: [], replay: { required: false } });
        expect(h.repository.listRuns({ limit: null })).toHaveLength(2);
        h.knowledgeEventRepository.listFeedback.mockResolvedValue([{
            feedback_id: 'feedback-old-attempt', event_id: failedEventId, action: 'correct',
            created_at: '2026-09-15T12:00:00Z',
            event: { source: { type: 'mana_meeting_judgment', external_run_id: failed.run.external_run_id },
                source_pointer: { run_id: failedRun.run_id, evidence_refs: [evidence] } },
            payload: { reason: '過去の判断根拠を再確認する', evidence_refs: [evidence] }
        }]);
        const corrected = await h.query.summarizeMeetingJudgmentLearning({ project_id: 'brainbase',
            since: '2026-09-15T00:00:00Z', until: '2026-09-16T00:00:00Z' }, context);
        expect(corrected).toMatchObject({ execution_count: 1, correction_count: 1,
            replay: { required: true, verified: false } });
    });

});
