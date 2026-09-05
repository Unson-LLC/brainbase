import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { RunReceiptContractError } from '../../../server/services/run-receipt/contract.js';
import { RunReceiptIngestService } from '../../../server/services/run-receipt/ingest-service.js';
import { ExternalRunnerIngestService } from '../../../server/services/external-runner/ingest-service.js';
import {
    InMemoryWorkflowRepository,
    JsonFileWorkflowRepository
} from '../../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../../server/services/workflow/workflow-runner.js';
import { TestAutomationRuntime } from '../../helpers/test-automation-runtime.js';

const tempDirectories = [];

afterEach(() => {
    while (tempDirectories.length) {
        fs.rmSync(tempDirectories.pop(), { recursive: true, force: true });
    }
});

function idempotencyKey(projectId, sourceType, externalRunId) {
    return `rr1_${createHash('sha256')
        .update(JSON.stringify([projectId, sourceType, externalRunId]))
        .digest('hex')}`;
}

function createTempLedger(prefix = 'brainbase-run-receipt-ledger-') {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirectories.push(directory);
    return path.join(directory, 'workflow-ledger.json');
}

function createDeferred() {
    let resolve;
    const promise = new Promise((next) => {
        resolve = next;
    });
    return { promise, resolve };
}

function makeReceipt(overrides = {}) {
    const source = {
        type: 'mana',
        workflow_id: 'mana:lambda:daily-secretary',
        runtime_target: 'lambda',
        ...(overrides.source || {})
    };
    const run = {
        project_id: 'brainbase',
        external_run_id: 'mana:lambda:daily-secretary:run:1',
        status: 'success',
        evidence_state: 'confirmed',
        started_at: '2026-07-15T09:00:00+09:00',
        finished_at: '2026-07-15T09:02:00+09:00',
        summary: '12 records processed',
        metrics: { processed: 12 },
        evidence_refs: [{ kind: 'log_ref', ref: 'cloudwatch:log-stream/example' }],
        ...(overrides.run || {})
    };
    return {
        contract_version: 'run_receipt.v1',
        source,
        run,
        delivery: {
            idempotency_key: idempotencyKey(run.project_id, source.type, run.external_run_id),
            attempt: 1,
            sent_at: '2026-07-15T09:02:03+09:00',
            ...(overrides.delivery || {})
        }
    };
}

function makeService(options = {}) {
    const repository = options.repository || new InMemoryWorkflowRepository();
    return {
        repository,
        service: new RunReceiptIngestService({
            workflowRepository: repository,
            lockAcquireTimeoutMs: 100,
            lockRetryMs: 1,
            ...options
        })
    };
}

function makeExternalRunnerPayload() {
    return {
        contract_version: 'external_runner.v0',
        runner: {
            type: 'cloudflare_computer',
            external_run_id: 'shared-ledger-cloudflare-run-1',
            agent_id: 'shared-ledger-agent',
            trace_ref: 'https://evidence.example.invalid/computer/shared-ledger-cloudflare-run-1'
        },
        run: {
            org_id: 'brainbase',
            project_id: 'brainbase',
            role_agent_id: 'operations',
            workflow_id: 'shared-ledger-external-workflow',
            workflow_name: 'Shared ledger external workflow',
            status: 'completed'
        },
        loop_control: {
            owner_id: 'system',
            cost_owner_id: 'system',
            approval_owner_id: 'system',
            stop_conditions: ['external_send_requires_approval']
        },
        context_sources: [{
            source_type: 'graph_ssot',
            source_ref: 'project:brainbase',
            digest: 'sha256:shared-ledger-context',
            redaction_status: 'not_required',
            evidence_refs: ['graph://project/brainbase']
        }],
        judgment_dag_trace: {
            dag_id: 'shared-ledger-v1',
            version: '1',
            nodes: ['observe'],
            evidence_refs: ['graph://project/brainbase']
        },
        rounds: [{
            round_id: 'round-1',
            status: 'completed',
            evidence_refs: ['cloudflare-computer://shared-ledger-cloudflare-run-1/round-1']
        }],
        outputs: [],
        learning_candidates: []
    };
}

describe('RunReceiptIngestService', () => {
    it('invalid receipt_workflow/run/step/auditを一切変更せず拒否する', async () => {
        const { repository, service } = makeService();
        const snapshot = JSON.stringify(repository.ledger);

        await expect(service.ingest(makeReceipt({
            run: { raw_log: 'source-owned raw content must not enter Brainbase' }
        }))).rejects.toMatchObject({ code: 'forbidden_key' });

        expect(JSON.stringify(repository.ledger)).toBe(snapshot);
        expect(repository.listWorkflows()).toHaveLength(0);
        expect(repository.listRuns({ limit: null })).toHaveLength(0);
        expect(repository.listAuditLogs()).toHaveLength(0);
    });

    it.each([
        ['log_ref', 'https://user:password@example.invalid/log'],
        ['artifact_ref', 'cloudwatch:user:password@example.invalid/log']
    ])('credential-bearing %s_workflow/run/step/auditを一切変更せず拒否する', async (kind, ref) => {
        const { repository, service } = makeService();
        const snapshot = JSON.stringify(repository.ledger);

        await expect(service.ingest(makeReceipt({
            run: { evidence_refs: [{ kind, ref }] }
        }))).rejects.toMatchObject({ code: 'invalid_evidence_ref' });

        expect(JSON.stringify(repository.ledger)).toBe(snapshot);
        expect(repository.listWorkflows()).toHaveLength(0);
        expect(repository.listRuns({ limit: null })).toHaveLength(0);
        expect(repository.listAuditLogs()).toHaveLength(0);
    });

    it('valid receipt_共有台帳へworkflow/run/auditを原子的に投影する', async () => {
        const { repository, service } = makeService();
        const result = await service.ingest(makeReceipt());

        expect(result.status).toBe('created');
        expect(repository.listWorkflows()).toHaveLength(1);
        expect(repository.listRuns({ limit: null })).toHaveLength(1);
        expect(repository.listAuditLogs({ targetId: result.run.id })).toHaveLength(1);
        expect(result.workflow.metadata.run_receipt).toMatchObject({
            project_id: 'brainbase',
            source_type: 'mana',
            source_workflow_id: 'mana:lambda:daily-secretary'
        });
        expect(result.run).toMatchObject({
            status: 'success',
            closure_state: 'closed',
            action_required: 'none'
        });
        expect(result.run.metadata.run_receipt).toMatchObject({
            source_status: 'success',
            evidence_state: 'confirmed',
            metrics: { processed: 12 }
        });
        expect(JSON.stringify(result.audit_logs)).not.toMatch(/raw_log|customer_text|transcript/);
    });

    it.each(['receipt-first', 'external-runner-first'])(
        '%s_Receiptとexternal_runner duplicate replayの共有台帳surfaceを相互に保持する',
        async (order) => {
            const repository = new InMemoryWorkflowRepository();
            const receiptService = new RunReceiptIngestService({ workflowRepository: repository });
            const externalService = new ExternalRunnerIngestService({ workflowRepository: repository });
            let receiptResult;
            let externalResult;

            if (order === 'receipt-first') {
                receiptResult = await receiptService.ingest(makeReceipt());
                externalResult = await externalService.ingest(makeExternalRunnerPayload());
            } else {
                externalResult = await externalService.ingest(makeExternalRunnerPayload());
                receiptResult = await receiptService.ingest(makeReceipt());
            }
            const duplicate = await externalService.ingest(makeExternalRunnerPayload());

            expect(duplicate).toMatchObject({ status: 'duplicate', run: { id: externalResult.run.id } });
            expect(repository.getWorkflow(receiptResult.workflow.id)).toBeTruthy();
            expect(repository.getWorkflow(externalResult.workflow.id)).toBeTruthy();
            expect(repository.getRun(receiptResult.run.id)).toBeTruthy();
            expect(repository.getRun(externalResult.run.id)).toBeTruthy();
            expect(repository.listContextSnapshots(externalResult.run.id)).toHaveLength(1);
            expect(repository.listAuditLogs({ targetId: receiptResult.run.id })).toEqual(expect.arrayContaining([
                expect.objectContaining({ action: 'run_receipt.ingested' })
            ]));
            expect(repository.listAuditLogs({ targetId: externalResult.run.id })).toEqual(expect.arrayContaining([
                expect.objectContaining({ action: 'external_runner.ingested' }),
                expect.objectContaining({ action: 'external_runner.duplicate_replay_ignored' })
            ]));
        }
    );

    it.each(['receipt-first', 'workflow-runner-first'])(
        '%s_ReceiptとWorkflowRunner mutationのworkflow run step auditを相互に保持する',
        async (order) => {
            const repository = new InMemoryWorkflowRepository();
            const receiptService = new RunReceiptIngestService({ workflowRepository: repository });
            const workflow = {
                id: 'shared-ledger-operational-workflow',
                workspace_id: 'default',
                project_id: 'brainbase',
                name: 'Shared ledger operational workflow',
                implementation_key: 'shared-ledger-handler',
                execution_env: 'local',
                hitl_policy: 'none',
                context_sources: []
            };
            await repository.transaction(() => repository.upsertWorkflow(workflow));
            const runner = new WorkflowRunner({
                repository,
                handlers: {
                    'shared-ledger-handler': async () => ({
                        status: 'success',
                        closureState: 'closed',
                        message: 'shared ledger workflow complete'
                    })
                }
            });
            let receiptResult;
            let workflowResult;

            if (order === 'receipt-first') {
                receiptResult = await receiptService.ingest(makeReceipt());
                workflowResult = await runner.runWorkflow(workflow, { runId: 'shared-ledger-operational-run' });
            } else {
                workflowResult = await runner.runWorkflow(workflow, { runId: 'shared-ledger-operational-run' });
                receiptResult = await receiptService.ingest(makeReceipt());
            }

            expect(repository.getRun(receiptResult.run.id)).toBeTruthy();
            expect(repository.getRun(workflowResult.run.id)).toMatchObject({ status: 'success' });
            expect(repository.listRunSteps(workflowResult.run.id)).toEqual([
                expect.objectContaining({ status: 'success', step_key: 'run' })
            ]);
            expect(repository.listAuditLogs({ targetId: receiptResult.run.id })).toEqual(expect.arrayContaining([
                expect.objectContaining({ action: 'run_receipt.ingested' })
            ]));
            expect(repository.listAuditLogs({ targetId: workflowResult.run.id })).toEqual(expect.arrayContaining([
                expect.objectContaining({ action: 'workflow.run.finished' })
            ]));
        }
    );

    it('別Json repositoryのReceiptとexternal_runnerが同時書込でも全surfaceを保持する', async () => {
        const filePath = createTempLedger();
        const receiptTransactionEntered = createDeferred();
        const releaseReceiptTransaction = createDeferred();

        class BarrierJsonRepository extends JsonFileWorkflowRepository {
            barrierUsed = false;

            async _beginTransaction(state) {
                await super._beginTransaction(state);
                if (this.barrierUsed) return;
                this.barrierUsed = true;
                receiptTransactionEntered.resolve();
                await releaseReceiptTransaction.promise;
            }
        }

        const receiptRepository = new BarrierJsonRepository({ filePath });
        const externalRepository = new JsonFileWorkflowRepository({ filePath });
        const receiptService = new RunReceiptIngestService({ workflowRepository: receiptRepository });
        const externalService = new ExternalRunnerIngestService({ workflowRepository: externalRepository });

        const receiptPromise = receiptService.ingest(makeReceipt());
        await receiptTransactionEntered.promise;
        let externalSettled = false;
        const externalPromise = externalService.ingest(makeExternalRunnerPayload()).finally(() => {
            externalSettled = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(externalSettled).toBe(false);
        releaseReceiptTransaction.resolve();
        const [receiptResult, externalResult] = await Promise.all([receiptPromise, externalPromise]);
        const reloaded = new JsonFileWorkflowRepository({ filePath });

        expect(reloaded.getWorkflow(receiptResult.workflow.id)).toBeTruthy();
        expect(reloaded.getWorkflow(externalResult.workflow.id)).toBeTruthy();
        expect(reloaded.getRun(receiptResult.run.id)).toBeTruthy();
        expect(reloaded.getRun(externalResult.run.id)).toBeTruthy();
        expect(reloaded.listContextSnapshots(externalResult.run.id)).toHaveLength(1);
        expect(reloaded.listAuditLogs({ targetId: receiptResult.run.id })).toEqual(expect.arrayContaining([
            expect.objectContaining({ action: 'run_receipt.ingested' })
        ]));
        expect(reloaded.listAuditLogs({ targetId: externalResult.run.id })).toEqual(expect.arrayContaining([
            expect.objectContaining({ action: 'external_runner.ingested' })
        ]));
    });

    it('別Json repositoryのReceiptとexternal_runner duplicate replayが競合しても監査証跡を保持する', async () => {
        const filePath = createTempLedger();
        const seedRepository = new JsonFileWorkflowRepository({ filePath });
        const seedExternalService = new ExternalRunnerIngestService({ workflowRepository: seedRepository });
        const externalResult = await seedExternalService.ingest(makeExternalRunnerPayload());
        const receiptTransactionEntered = createDeferred();
        const releaseReceiptTransaction = createDeferred();
        const duplicateLeaseAttempted = createDeferred();
        let duplicateLeaseAcquired = false;

        class ReceiptBarrierJsonRepository extends JsonFileWorkflowRepository {
            barrierUsed = false;

            async _beginTransaction(state) {
                await super._beginTransaction(state);
                if (this.barrierUsed) return;
                this.barrierUsed = true;
                receiptTransactionEntered.resolve();
                await releaseReceiptTransaction.promise;
            }
        }

        class DuplicateProbeJsonRepository extends JsonFileWorkflowRepository {
            async _acquireTransactionLease(ownerId) {
                duplicateLeaseAttempted.resolve();
                const lease = await super._acquireTransactionLease(ownerId);
                duplicateLeaseAcquired = true;
                return lease;
            }
        }

        const receiptRepository = new ReceiptBarrierJsonRepository({ filePath });
        const duplicateRepository = new DuplicateProbeJsonRepository({ filePath });
        const receiptService = new RunReceiptIngestService({ workflowRepository: receiptRepository });
        const duplicateService = new ExternalRunnerIngestService({ workflowRepository: duplicateRepository });

        const receiptPromise = receiptService.ingest(makeReceipt());
        await receiptTransactionEntered.promise;
        const duplicatePromise = duplicateService.ingest(makeExternalRunnerPayload());
        await duplicateLeaseAttempted.promise;

        expect(duplicateLeaseAcquired).toBe(false);
        releaseReceiptTransaction.resolve();
        const [receiptResult, duplicateResult] = await Promise.all([receiptPromise, duplicatePromise]);
        const reloaded = new JsonFileWorkflowRepository({ filePath });

        expect(duplicateResult).toMatchObject({ status: 'duplicate', run: { id: externalResult.run.id } });
        expect(reloaded.getRun(receiptResult.run.id)).toBeTruthy();
        expect(reloaded.getRun(externalResult.run.id)).toBeTruthy();
        expect(reloaded.listAuditLogs({ targetId: receiptResult.run.id, limit: 1000 })).toEqual(expect.arrayContaining([
            expect.objectContaining({ action: 'run_receipt.ingested' })
        ]));
        expect(reloaded.listAuditLogs({ targetId: externalResult.run.id, limit: 1000 })).toEqual(expect.arrayContaining([
            expect.objectContaining({ action: 'external_runner.ingested' }),
            expect.objectContaining({ action: 'external_runner.duplicate_replay_ignored' })
        ]));
    });

    it('別Json repositoryのReceiptがWorkflowRunner実行中に入ってもrun/step/auditを保持する', async () => {
        const filePath = createTempLedger();
        const seedRepository = new JsonFileWorkflowRepository({ filePath });
        const workflow = {
            id: 'shared-ledger-operational-workflow',
            workspace_id: 'default',
            project_id: 'brainbase',
            name: 'Shared ledger operational workflow',
            implementation_key: 'shared-ledger-handler',
            execution_env: 'local',
            hitl_policy: 'none',
            context_sources: []
        };
        await seedRepository.transaction(() => seedRepository.upsertWorkflow(workflow));

        const runnerRepository = new JsonFileWorkflowRepository({ filePath });
        const receiptRepository = new JsonFileWorkflowRepository({ filePath });
        const handlerEntered = createDeferred();
        const releaseHandler = createDeferred();
        const runner = new WorkflowRunner({
            repository: runnerRepository,
            handlers: {
                'shared-ledger-handler': async () => {
                    handlerEntered.resolve();
                    await releaseHandler.promise;
                    return {
                        status: 'success',
                        closureState: 'closed',
                        message: 'shared ledger workflow complete'
                    };
                }
            }
        });
        const receiptService = new RunReceiptIngestService({ workflowRepository: receiptRepository });

        const workflowPromise = runner.runWorkflow(workflow, { runId: 'shared-ledger-operational-run' });
        await handlerEntered.promise;
        const receiptResult = await receiptService.ingest(makeReceipt());
        releaseHandler.resolve();
        const workflowResult = await workflowPromise;
        const reloaded = new JsonFileWorkflowRepository({ filePath });

        expect(reloaded.getRun(receiptResult.run.id)).toBeTruthy();
        expect(reloaded.getRun(workflowResult.run.id)).toMatchObject({ status: 'success' });
        expect(reloaded.listRunSteps(workflowResult.run.id)).toEqual([
            expect.objectContaining({ status: 'success', step_key: 'run' })
        ]);
        expect(reloaded.listAuditLogs({ targetId: receiptResult.run.id })).toEqual(expect.arrayContaining([
            expect.objectContaining({ action: 'run_receipt.ingested' })
        ]));
        expect(reloaded.listAuditLogs({ targetId: workflowResult.run.id })).toEqual(expect.arrayContaining([
            expect.objectContaining({ action: 'workflow.run.finished' })
        ]));
    });

    it('5 sourceの保存結果を権限内のInboxへ返し、未認可projectを開示しない', async () => {
        const repository = new InMemoryWorkflowRepository();
        const receiptService = new RunReceiptIngestService({ workflowRepository: repository });
        const sourceTypes = ['mana', 'codex_automations', 'github_actions', 'salestailor', 'openryoko'];

        for (const sourceType of sourceTypes) {
            await receiptService.ingest(makeReceipt({
                source: { type: sourceType, workflow_id: `${sourceType}:workflow` },
                run: { external_run_id: `${sourceType}:run:1` }
            }));
        }
        await receiptService.ingest(makeReceipt({
            run: { project_id: 'restricted-project' }
        }));
        const actor = { organizationId: 'org-test', projectCodes: ['brainbase'] };
        const workflowService = new TestAutomationRuntime({
            repository,
            runner: {},
            configParser: {
                async getProjects() {
                    return {
                        projects: [{ id: 'brainbase' }, { id: 'restricted-project' }],
                        source: { status: 'loaded' }
                    };
                }
            }
        });

        expect(repository.listRuns({ limit: null })).toHaveLength(6);
        for (const sourceType of sourceTypes) {
            const inbox = await workflowService.runReceiptQueryService.listInbox({ sourceType }, actor);
            expect(inbox.items).toHaveLength(1);
            expect(inbox.items[0]).toMatchObject({
                source: { type: sourceType },
                project_id: 'brainbase'
            });
        }
        for (const unauthorizedActor of [
            {},
            { projectCodes: actor.projectCodes },
            { ...actor, projectCodes: [] }
        ]) {
            const inbox = await workflowService.runReceiptQueryService.listInbox({}, unauthorizedActor);
            expect(inbox.items).toEqual([]);
            expect(inbox.count).toBe(0);
        }
    });

    it('同じexternal_run_idでもprojectまたはsourceが違う_別runとして永続化する', async () => {
        const { repository, service } = makeService();
        const receipts = [
            makeReceipt(),
            makeReceipt({ run: { project_id: 'salestailor' } }),
            makeReceipt({ source: { type: 'github_actions' } })
        ];

        const results = [];
        for (const receipt of receipts) results.push(await service.ingest(receipt));

        expect(results.map((result) => result.status)).toEqual(['created', 'created', 'created']);
        expect(new Set(results.map((result) => result.run.id))).toHaveLength(3);
        expect(repository.listRuns({ limit: null })).toHaveLength(3);
        expect(repository.listRuns({ limit: null }).map((run) => ({
            projectId: run.project_id,
            sourceType: run.metadata.run_receipt.source.type,
            externalRunId: run.metadata.run_receipt.source_external_run_id
        }))).toEqual(expect.arrayContaining([
            {
                projectId: 'brainbase',
                sourceType: 'mana',
                externalRunId: 'mana:lambda:daily-secretary:run:1'
            },
            {
                projectId: 'salestailor',
                sourceType: 'mana',
                externalRunId: 'mana:lambda:daily-secretary:run:1'
            },
            {
                projectId: 'brainbase',
                sourceType: 'github_actions',
                externalRunId: 'mana:lambda:daily-secretary:run:1'
            }
        ]));
    });

    it('許可されたsource-owned evidence参照_JSON台帳の再読込後も保持する', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-run-receipt-evidence-'));
        tempDirectories.push(directory);
        const filePath = path.join(directory, 'workflow-ledger.json');
        const repository = new JsonFileWorkflowRepository({ filePath });
        const { service } = makeService({ repository });
        const evidenceRefs = [
            { kind: 'artifact_ref', ref: 's3:bucket/result.json' },
            { kind: 'log_ref', ref: 'cloudwatch:log-group:log-stream/example' }
        ];

        const result = await service.ingest(makeReceipt({ run: { evidence_refs: evidenceRefs } }));
        const reloaded = new JsonFileWorkflowRepository({ filePath });

        expect(reloaded.getRun(result.run.id).metadata.run_receipt.evidence_refs).toEqual(evidenceRefs);
        expect(reloaded.listAuditLogs({ targetId: result.run.id })[0].after.evidence_refs).toEqual(evidenceRefs);
    });

    it('deliveryだけ違う再送_duplicateかつ台帳を変更しない', async () => {
        const { repository, service } = makeService();
        const created = await service.ingest(makeReceipt());
        const snapshot = JSON.stringify(repository.ledger);
        const duplicate = await service.ingest(makeReceipt({
            delivery: { attempt: 8, sent_at: '2026-07-15T12:00:00Z' }
        }));

        expect(duplicate.status).toBe('duplicate');
        expect(duplicate.run.id).toBe(created.run.id);
        expect(JSON.stringify(repository.ledger)).toBe(snapshot);
    });

    it('同じidentityでimmutable内容が変わる_run_receipt_conflictかつrollbackする', async () => {
        const { repository, service } = makeService();
        await service.ingest(makeReceipt());
        const snapshot = JSON.stringify(repository.ledger);

        await expect(service.ingest(makeReceipt({
            run: { summary: '13 records processed', metrics: { processed: 13 } }
        }))).rejects.toMatchObject({ code: 'run_receipt_conflict' });
        expect(JSON.stringify(repository.ledger)).toBe(snapshot);
    });

    it('同時の同一receipt_identity lockで1 createdと残りduplicateになる', async () => {
        const { repository, service } = makeService({ lockAcquireTimeoutMs: 1000 });
        const results = await Promise.all(Array.from({ length: 8 }, () => service.ingest(makeReceipt())));

        expect(results.filter((result) => result.status === 'created')).toHaveLength(1);
        expect(results.filter((result) => result.status === 'duplicate')).toHaveLength(7);
        expect(repository.listRuns({ limit: null })).toHaveLength(1);
        expect(repository.listAuditLogs()).toHaveLength(1);
    });

    it('異なるreceipt identity_並行しても全workflow/run/auditを保持する', async () => {
        const { repository, service } = makeService({ lockAcquireTimeoutMs: 1000 });
        await Promise.all(Array.from({ length: 6 }, (_, index) => service.ingest(makeReceipt({
            run: { external_run_id: `mana:lambda:daily-secretary:run:${index + 1}` }
        }))));

        expect(repository.listWorkflows()).toHaveLength(1);
        expect(repository.listRuns({ limit: null })).toHaveLength(6);
        expect(repository.listAuditLogs()).toHaveLength(6);
    });

    it.each(['transaction', 'acquireWorkflowLock', 'releaseWorkflowLock'])(
        'repository.%sなし_書込前に拒否する',
        async (capability) => {
            const repository = new InMemoryWorkflowRepository();
            repository[capability] = undefined;
            const service = new RunReceiptIngestService({ workflowRepository: repository });

            await expect(service.ingest(makeReceipt())).rejects.toMatchObject({
                code: 'workflow_repository_capability_required'
            });
            expect(repository.listRuns({ limit: null })).toHaveLength(0);
        }
    );

    it('identity lock timeout_書込なしで明示的に失敗する', async () => {
        const repository = new InMemoryWorkflowRepository();
        const { service } = makeService({ repository, lockAcquireTimeoutMs: 5, lockRetryMs: 1 });
        const first = await service.normalize(makeReceipt());
        repository.acquireWorkflowLock({
            workspace_id: first.lock.workspace_id,
            workflow_id: first.lock.workflow_id,
            locked_by: 'other-owner',
            ttl_ms: 60000
        });

        await expect(service.ingest(makeReceipt())).rejects.toMatchObject({ code: 'run_receipt_lock_timeout' });
        expect(repository.listRuns({ limit: null })).toHaveLength(0);
    });

    it('identity lockはreceipt namespaceとprojectを含む正規tupleを使う', async () => {
        const repository = new InMemoryWorkflowRepository();
        const acquired = [];
        const originalAcquire = repository.acquireWorkflowLock.bind(repository);
        repository.acquireWorkflowLock = (input) => {
            acquired.push(input);
            return originalAcquire(input);
        };
        const { service } = makeService({ repository });
        const normalized = service.normalize(makeReceipt());

        await service.ingest(makeReceipt());

        expect(acquired).toHaveLength(1);
        expect(acquired[0]).toMatchObject({
            workspace_id: 'run_receipt:brainbase',
            workflow_id: normalized.identity.run_id
        });
    });

    it('identity lock取得後にだけ台帳transactionへ入り_commit後にlockを解放する', async () => {
        const repository = new InMemoryWorkflowRepository();
        const events = [];
        const originalAcquire = repository.acquireWorkflowLock.bind(repository);
        const originalTransaction = repository.transaction.bind(repository);
        const originalRelease = repository.releaseWorkflowLock.bind(repository);
        repository.acquireWorkflowLock = (input) => {
            events.push('identity-lock-acquired');
            return originalAcquire(input);
        };
        repository.transaction = async (callback) => {
            events.push('transaction-entered');
            const result = await originalTransaction(callback);
            events.push('transaction-committed');
            return result;
        };
        repository.releaseWorkflowLock = (input) => {
            events.push('identity-lock-released');
            return originalRelease(input);
        };
        const { service } = makeService({ repository });

        await service.ingest(makeReceipt());

        expect(events).toEqual([
            'identity-lock-acquired',
            'transaction-entered',
            'transaction-committed',
            'identity-lock-released'
        ]);
    });

    it('deterministic workflow idに別identityが存在_衝突として拒否する', async () => {
        const { repository, service } = makeService();
        const normalized = await service.normalize(makeReceipt());
        await repository.transaction(() => repository.upsertWorkflow({
            id: normalized.identity.workflow_id,
            workspace_id: 'default',
            project_id: 'brainbase',
            name: 'collision',
            metadata: { run_receipt: { source_type: 'github_actions' } }
        }));
        const snapshot = JSON.stringify(repository.ledger);

        await expect(service.ingest(makeReceipt())).rejects.toMatchObject({ code: 'run_receipt_workflow_collision' });
        expect(JSON.stringify(repository.ledger)).toBe(snapshot);
    });

    it('既存runにreceipt metadataがない_衝突として拒否する', async () => {
        const { repository, service } = makeService();
        const normalized = await service.normalize(makeReceipt());
        await repository.transaction(() => repository.createRun({
            id: normalized.identity.run_id,
            workspace_id: 'default',
            project_id: 'brainbase',
            workflow_id: normalized.identity.workflow_id
        }));

        await expect(service.ingest(makeReceipt())).rejects.toBeInstanceOf(RunReceiptContractError);
        expect(repository.listRuns({ limit: null })).toHaveLength(1);
        expect(repository.listAuditLogs()).toHaveLength(0);
    });
});
