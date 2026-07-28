// In-process E2E for C2: agent report → Companion approval inbox → approve → close.
//
// Live E2E against the running server is blocked: the running server currently
// runs main-branch code without the `agent_report` runner type, so a live ingest
// would be rejected by the old contract-schema until this PR merges + the server
// restarts. This suite instead exercises the real ExternalRunnerIngestService +
// Dedicated runtime services + repository wiring in-process (no HTTP mocks), covering the
// full user-visible flow:
//
//   bb-report-submit payload → ingest → run persisted (waiting_human) →
//   listCompanionApprovalInbox surfaces it (kind: workflow_approval) →
//   resolveHumanStep (approve) → run closes → inbox no longer lists it →
//   no orphan needs_action run remains.
//
// See: docs/architecture/story-brainbase-agent-report-approval-inbox-architecture.md

import { describe, expect, it } from 'vitest';

import { ExternalRunnerIngestService } from '../../server/services/external-runner/ingest-service.js';
import { InMemoryWorkflowRepository } from '../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../server/services/workflow/workflow-runner.js';
import {
    TestAutomationRuntime,
    createDefaultWorkflowHandlers
} from '../helpers/test-automation-runtime.js';
import { buildAgentReportPayload } from '../../scripts/bin/bb-report-submit.mjs';

function makeStack() {
    const repository = new InMemoryWorkflowRepository();
    const ingestService = new ExternalRunnerIngestService({ workflowRepository: repository });
    // Intentionally no handler registered for external-runner:agent_report:
    // agent_report runs are approval-only and must be closed by resolveHumanStep,
    // not executed by a runner handler.
    const runner = new WorkflowRunner({ repository, handlers: createDefaultWorkflowHandlers() });
    const workflowService = new TestAutomationRuntime({
        repository,
        runner,
        configParser: {
            async getProjects() {
                return { projects: [{ id: 'brainbase', session_select: true }] };
            }
        }
    });
    return { repository, ingestService, workflowService };
}

const ACTOR = { person_id: 'sato_keigo', projectCodes: ['brainbase'], role: 'member', authSource: 'test' };

describe('C2 in-process E2E: agent report → approval inbox → approve → close', () => {
    it('ingested agent_report surfaces in the approval inbox, then closes on approval and leaves no orphan run', async () => {
        const { repository, ingestService, workflowService } = makeStack();

        // 1. Build the exact payload bb-report-submit sends, then ingest it.
        const payload = buildAgentReportPayload({
            sender: 'agent/ceo',
            title: 'CEOレビュー 2026-07',
            period: '2026-07',
            markdown: '# CEOレビュー\n\nモード=攻め、来月アクション3件',
            requiredBy: 'sato_keigo'
        });
        const ingested = await ingestService.ingest(payload);
        expect(ingested.run).toMatchObject({ status: 'waiting_human', closure_state: 'open' });
        const runId = ingested.run.id;

        // 2. The run must appear in the Companion approval inbox (kind: workflow_approval).
        const inboxBefore = await workflowService.listCompanionApprovalInbox(
            { projectId: 'brainbase' },
            ACTOR
        );
        const itemBefore = inboxBefore.items.find((item) => item.run_id === runId);
        expect(itemBefore).toBeTruthy();
        expect(itemBefore).toMatchObject({ kind: 'workflow_approval', status: 'waiting_human' });
        expect(itemBefore.pending_human_steps.length).toBe(1);
        expect(itemBefore.outputs.length).toBe(1);

        // 3. Approve the human step.
        const pendingStep = repository
            .listHumanSteps(runId)
            .find((step) => step.status === 'pending');
        expect(pendingStep).toBeTruthy();
        const resolved = await workflowService.automationRunService.resolveHumanStep(
            pendingStep.id,
            { resolution: 'approved' },
            ACTOR
        );
        expect(resolved.human_step).toMatchObject({ status: 'approved' });
        expect(resolved.resumed_run).toMatchObject({
            id: runId,
            status: 'success',
            closure_state: 'closed',
            human_waiting: false,
            action_required: 'none'
        });

        // 4. The run must no longer appear in the inbox (approved → gone).
        const inboxAfter = await workflowService.listCompanionApprovalInbox(
            { projectId: 'brainbase' },
            ACTOR
        );
        expect(inboxAfter.items.find((item) => item.run_id === runId)).toBeUndefined();

        // 5. No orphan needs_action run may remain in the ledger.
        const orphans = repository
            .listRuns()
            .filter((run) => run.closure_state === 'needs_action' || run.status === 'needs_action');
        expect(orphans).toHaveLength(0);

        // 6. The persisted run reflects the closed state.
        const persisted = repository.getRun(runId);
        expect(persisted).toMatchObject({ status: 'success', closure_state: 'closed' });
    });

    it('rejected agent_report leaves the inbox and closes as cancelled without orphan runs', async () => {
        const { repository, ingestService, workflowService } = makeStack();

        const payload = buildAgentReportPayload({
            sender: 'agent/retro',
            title: '週次レトロ 2026-W27',
            period: '2026-W27',
            markdown: '# レトロ\n\n先週の学び',
            requiredBy: 'sato_keigo'
        });
        const ingested = await ingestService.ingest(payload);
        const runId = ingested.run.id;

        const inboxBefore = await workflowService.listCompanionApprovalInbox(
            { projectId: 'brainbase' },
            ACTOR
        );
        expect(inboxBefore.items.find((item) => item.run_id === runId)).toBeTruthy();

        const pendingStep = repository.listHumanSteps(runId).find((step) => step.status === 'pending');
        const resolved = await workflowService.automationRunService.resolveHumanStep(
            pendingStep.id,
            { resolution: 'rejected' },
            ACTOR
        );
        expect(resolved.resumed_run).toMatchObject({ status: 'cancelled', closure_state: 'closed' });

        const inboxAfter = await workflowService.listCompanionApprovalInbox(
            { projectId: 'brainbase' },
            ACTOR
        );
        expect(inboxAfter.items.find((item) => item.run_id === runId)).toBeUndefined();

        const orphans = repository
            .listRuns()
            .filter((run) => run.closure_state === 'needs_action' || run.status === 'needs_action');
        expect(orphans).toHaveLength(0);
    });
});
