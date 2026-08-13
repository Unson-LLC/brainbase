import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
    InMemoryWorkflowRepository,
    JsonFileWorkflowRepository
} from '../../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../../server/services/workflow/workflow-runner.js';
import {
    createBrainbaseAliveWorkflow,
    createDefaultWorkflowHandlers
} from '../../helpers/test-automation-runtime.js';

function makeRunner(workflow = createBrainbaseAliveWorkflow()) {
    const repository = new InMemoryWorkflowRepository({ seedWorkflows: [workflow] });
    const runner = new WorkflowRunner({
        repository,
        handlers: createDefaultWorkflowHandlers({
            clock: () => new Date('2026-06-01T09:00:00.000Z')
        })
    });
    return { repository, runner, workflow };
}

function createTransactionGuardedRepository(workflow) {
    const target = new InMemoryWorkflowRepository({ seedWorkflows: [workflow] });
    const mutationMethods = new Set([
        'createRun',
        'createRunStep',
        'createContextSnapshot',
        'createHumanStep',
        'createOutput',
        'updateRun',
        'updateRunStep',
        'writeAuditLog'
    ]);
    let transactionDepth = 0;
    const repository = new Proxy(target, {
        get(object, property) {
            if (property === 'activeTransactionCount') return transactionDepth;
            if (property === 'transaction') {
                return (callback) => object.transaction(async () => {
                    transactionDepth += 1;
                    try {
                        return await callback();
                    } finally {
                        transactionDepth -= 1;
                    }
                });
            }
            const value = object[property];
            if (typeof value !== 'function') return value;
            if (mutationMethods.has(property)) {
                return (...args) => {
                    if (transactionDepth === 0) {
                        throw new Error(`${String(property)} requires repository.transaction()`);
                    }
                    return value.apply(object, args);
                };
            }
            return value.bind(object);
        }
    });
    return repository;
}

describe('WorkflowRunner', () => {
    it('persists initial and terminal groups in separate transactions with the remote handler outside the lease', async () => {
        const workflow = {
            ...createBrainbaseAliveWorkflow(),
            id: 'transaction-boundary-workflow',
            implementation_key: 'transaction-boundary-workflow',
            context_sources: []
        };
        const repository = createTransactionGuardedRepository(workflow);
        let releaseHandler;
        let handlerEntered;
        const entered = new Promise((resolve) => {
            handlerEntered = resolve;
        });
        const runner = new WorkflowRunner({
            repository,
            handlers: {
                'transaction-boundary-workflow': async () => {
                    expect(repository.activeTransactionCount).toBe(0);
                    handlerEntered();
                    await new Promise((resolve) => {
                        releaseHandler = resolve;
                    });
                    return { status: 'success', closureState: 'closed' };
                }
            }
        });

        const running = runner.runWorkflow(workflow, { runId: 'run-transaction-boundary' });
        await Promise.race([
            entered,
            running.then(() => {
                throw new Error('workflow finished before the remote handler entered');
            })
        ]);
        let unrelatedCommitted = false;
        await repository.transaction(async () => {
            unrelatedCommitted = true;
        });
        expect(unrelatedCommitted).toBe(true);

        releaseHandler();
        const result = await running;
        expect(result.run.status).toBe('success');
        expect(repository.getRun('run-transaction-boundary')).toMatchObject({ status: 'success' });
    });

    it('records brainbase-alive as a successful closed run with output and context snapshot', async () => {
        const { repository, runner, workflow } = makeRunner();

        const { run } = await runner.runWorkflow(workflow, {
            actorId: 'sato',
            triggerType: 'manual',
            env: 'local'
        });

        expect(run).toMatchObject({
            workflow_id: 'brainbase-alive',
            project_id: 'general',
            status: 'success',
            closure_state: 'closed',
            action_required: 'none',
            output_count: 1
        });
        expect(repository.listWorkflowContextSources(workflow.id)).toHaveLength(1);
        expect(repository.listRunSteps(run.id)).toEqual([
            expect.objectContaining({
                workflow_run_id: run.id,
                step_key: 'run',
                status: 'success'
            })
        ]);
        expect(repository.listContextSnapshots(run.id)).toHaveLength(1);
        expect(repository.listOutputs(run.id)).toHaveLength(1);
    });

    it('marks a run needs_action when a required context source is missing', async () => {
        const workflow = {
            ...createBrainbaseAliveWorkflow(),
            id: 'missing-context',
            implementation_key: 'brainbase-alive',
            context_sources: [{
                source_type: 'local_fs',
                source_ref: '',
                required: true
            }]
        };
        const { repository, runner } = makeRunner(workflow);

        const { run } = await runner.runWorkflow(workflow, { actorId: 'sato' });

        expect(run.status).toBe('needs_action');
        expect(run.closure_state).toBe('needs_action');
        expect(run.action_required).toBe('update_input');
        expect(run.message).toContain('Required context missing');
        expect(repository.listRunSteps(run.id)[0]).toMatchObject({
            status: 'needs_action',
            action_required: 'update_input'
        });
    });

    it('creates a pending human step before handler execution when hitl_policy requires approval', async () => {
        const workflow = {
            ...createBrainbaseAliveWorkflow(),
            id: 'publish-draft',
            implementation_key: 'publish-draft',
            hitl_policy: 'before_publish'
        };
        const repository = new InMemoryWorkflowRepository({ seedWorkflows: [workflow] });
        let handlerCalled = false;
        const runner = new WorkflowRunner({
            repository,
            handlers: {
                'publish-draft': async () => {
                    handlerCalled = true;
                    return { status: 'success' };
                }
            }
        });

        const { run, humanStep } = await runner.runWorkflow(workflow, { actorId: 'sato' });

        expect(handlerCalled).toBe(false);
        expect(run.status).toBe('waiting_human');
        expect(run.human_waiting).toBe(true);
        expect(run.action_required).toBe('approve');
        expect(humanStep).toMatchObject({
            workflow_id: 'publish-draft',
            status: 'pending',
            step_type: 'approval'
        });
        expect(repository.listHumanSteps(run.id)).toHaveLength(1);
    });

    it('still executes a human-gated workflow after human resume resolution', async () => {
        const workflow = {
            ...createBrainbaseAliveWorkflow(),
            id: 'publish-draft-resume',
            implementation_key: 'publish-draft-resume',
            hitl_policy: 'before_publish'
        };
        const repository = new InMemoryWorkflowRepository({ seedWorkflows: [workflow] });
        const runner = new WorkflowRunner({
            repository,
            handlers: {
                'publish-draft-resume': async () => ({
                    status: 'success',
                    closureState: 'closed',
                    actionRequired: 'none',
                    outputCount: 1,
                    message: 'Published after approval',
                    data: { published: true }
                })
            }
        });

        const { run } = await runner.runWorkflow(workflow, {
            actorId: 'sato',
            humanStepResolution: { stepId: 'human_1', resolution: 'approved' }
        });

        expect(run.status).toBe('success');
        expect(run.closure_state).toBe('closed');
        expect(repository.listOutputs(run.id)).toHaveLength(1);
    });

    it('skips a duplicate run while the workflow lock is held', async () => {
        const workflow = {
            ...createBrainbaseAliveWorkflow(),
            id: 'locked-workflow',
            implementation_key: 'locked-workflow',
            timeout_ms: 1000
        };
        const repository = new InMemoryWorkflowRepository({ seedWorkflows: [workflow] });
        let releaseHandler;
        const runner = new WorkflowRunner({
            repository,
            handlers: {
                'locked-workflow': async () => {
                    await new Promise((resolve) => {
                        releaseHandler = resolve;
                    });
                    return { status: 'success', closureState: 'closed' };
                }
            }
        });

        const firstRun = runner.runWorkflow(workflow, { actorId: 'sato', runId: 'run_first' });
        await Promise.resolve();
        const duplicate = await runner.runWorkflow(workflow, { actorId: 'sato', runId: 'run_second' });
        releaseHandler();
        const first = await firstRun;

        expect(duplicate.run).toMatchObject({
            id: 'run_second',
            status: 'skipped',
            action_required: 'rerun'
        });
        expect(first.run.status).toBe('success');
        expect(repository.listAuditLogs({ targetId: 'run_second' })).toEqual(expect.arrayContaining([
            expect.objectContaining({ action: 'workflow.run.skipped_locked' })
        ]));
    });

    it('fails a run when the workflow handler exceeds timeout_ms', async () => {
        const workflow = {
            ...createBrainbaseAliveWorkflow(),
            id: 'timeout-workflow',
            implementation_key: 'timeout-workflow',
            timeout_ms: 5
        };
        const repository = new InMemoryWorkflowRepository({ seedWorkflows: [workflow] });
        const runner = new WorkflowRunner({
            repository,
            handlers: {
                'timeout-workflow': async () => {
                    await new Promise((resolve) => setTimeout(resolve, 80));
                    return { status: 'success' };
                }
            }
        });

        const { run } = await runner.runWorkflow(workflow, { actorId: 'sato' });

        expect(run).toMatchObject({
            status: 'failed',
            closure_state: 'needs_action',
            action_required: 'check_error'
        });
        expect(run.error_message).toContain('Workflow timed out after 5ms');

        const duplicate = await runner.runWorkflow(workflow, { actorId: 'sato', runId: 'run_after_timeout' });
        expect(duplicate.run).toMatchObject({
            id: 'run_after_timeout',
            status: 'skipped',
            action_required: 'rerun'
        });
        await new Promise((resolve) => setTimeout(resolve, 90));
        const afterSettle = await runner.runWorkflow(workflow, { actorId: 'sato', runId: 'run_after_settle' });
        expect(afterSettle.run.id).toBe('run_after_settle');
    });

    it('quarantines corrupted workflow ledger json and persists atomically', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-workflow-ledger-'));
        const filePath = path.join(dir, 'workflow-ledger.json');
        fs.writeFileSync(filePath, '{not-json');

        const repository = new JsonFileWorkflowRepository({
            filePath,
            seedWorkflows: [createBrainbaseAliveWorkflow()]
        });

        expect(repository.listWorkflows()).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'brainbase-alive' })
        ]));
        expect(fs.existsSync(filePath)).toBe(true);
        expect(fs.readdirSync(dir).some((name) => name.startsWith('workflow-ledger.json.corrupt-'))).toBe(true);
        expect(JSON.parse(fs.readFileSync(filePath, 'utf8')).workflows).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'brainbase-alive' })
        ]));
        expect(fs.readdirSync(dir).some((name) => name.endsWith('.tmp'))).toBe(false);
    });

    it('keeps JsonFile workflow locks visible across repository instances', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-workflow-lock-'));
        const filePath = path.join(dir, 'workflow-ledger.json');
        const first = new JsonFileWorkflowRepository({ filePath });
        const second = new JsonFileWorkflowRepository({ filePath });

        const lock = first.acquireWorkflowLock({
            workspace_id: 'default',
            workflow_id: 'external_runtime_dispatch:loop-001',
            locked_by: 'process-a',
            ttl_ms: 600000
        });

        expect(lock).toMatchObject({ locked_by: 'process-a' });
        expect(second.acquireWorkflowLock({
            workspace_id: 'default',
            workflow_id: 'external_runtime_dispatch:loop-001',
            locked_by: 'process-b',
            ttl_ms: 600000
        })).toBeNull();
        expect(first.releaseWorkflowLock({
            workspace_id: 'default',
            workflow_id: 'external_runtime_dispatch:loop-001',
            locked_by: 'process-a'
        })).toBe(true);
        expect(second.acquireWorkflowLock({
            workspace_id: 'default',
            workflow_id: 'external_runtime_dispatch:loop-001',
            locked_by: 'process-b',
            ttl_ms: 600000
        })).toMatchObject({ locked_by: 'process-b' });
    });

    it('runs through initial and terminal commits on the production Json repository', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-workflow-runner-json-'));
        const filePath = path.join(dir, 'workflow-ledger.json');
        const workflow = {
            ...createBrainbaseAliveWorkflow(),
            id: 'json-production-workflow',
            implementation_key: 'json-production-workflow',
            context_sources: []
        };
        const repository = new JsonFileWorkflowRepository({
            filePath,
            seedWorkflows: [workflow]
        });
        const runner = new WorkflowRunner({
            repository,
            handlers: {
                'json-production-workflow': async () => ({
                    status: 'success',
                    closureState: 'closed',
                    outputCount: 1,
                    data: { persisted: true }
                })
            }
        });

        const { run } = await runner.runWorkflow(workflow, { runId: 'run-json-production' });
        const reloaded = new JsonFileWorkflowRepository({ filePath });

        expect(run).toMatchObject({ id: 'run-json-production', status: 'success' });
        expect(reloaded.getRun(run.id)).toMatchObject({ status: 'success', closure_state: 'closed' });
        expect(reloaded.listOutputs(run.id)).toHaveLength(1);
        expect(fs.existsSync(path.join(dir, '.workflow-locks'))).toBe(true);
        expect(fs.readdirSync(path.join(dir, '.workflow-locks'))).toEqual([]);
    });
});
