// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

const EMPTY_LEDGER = {
    schema_version: '0.1.0',
    workflows: [],
    workflow_context_sources: [],
    runs: [],
    latest_run_receipts: [],
    run_steps: [],
    context_snapshots: [],
    human_steps: [],
    outputs: [],
    audit_logs: [],
    workflow_locks: [],
    role_agent_instances: [],
    workflow_templates: [],
    workflow_bindings: [],
    workflow_triggers: [],
    loop_intents: [],
    company_authority_approval_receipts: []
};

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function nowIso() {
    return new Date().toISOString();
}

function isLocalProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error?.code === 'EPERM';
    }
}

function waitSync(milliseconds) {
    if (milliseconds <= 0) return;
    const signal = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(signal, 0, 0, milliseconds);
}

function lockKey({ workspace_id, workflow_id }) {
    return crypto.createHash('sha256')
        .update(`${workspace_id || 'default'}:${workflow_id || 'unknown'}`)
        .digest('hex');
}

function runReceiptIdentity(run) {
    if (run?.metadata?.contract_version !== 'run_receipt.v1') return null;
    const receipt = run.metadata.run_receipt;
    const source = receipt?.source;
    if (
        !run.project_id
        || !source?.type
        || !source?.workflow_id
        || !receipt?.source_status
        || !receipt?.evidence_state
    ) return null;
    return JSON.stringify([run.project_id, source.type, source.workflow_id]);
}

function runReceiptEpoch(value) {
    const epoch = Date.parse(String(value || ''));
    return Number.isFinite(epoch) ? epoch : 0;
}

function compareRunReceiptRecency(left, right) {
    const leftEffective = runReceiptEpoch(left.finished_at || left.started_at || left.created_at);
    const rightEffective = runReceiptEpoch(right.finished_at || right.started_at || right.created_at);
    if (leftEffective !== rightEffective) return rightEffective - leftEffective;
    const leftCreated = runReceiptEpoch(left.created_at);
    const rightCreated = runReceiptEpoch(right.created_at);
    if (leftCreated !== rightCreated) return rightCreated - leftCreated;
    return String(right.id).localeCompare(String(left.id));
}

function buildLatestRunReceiptProjection(runs) {
    const latestByIdentity = new Map();
    for (const run of runs) {
        const identity = runReceiptIdentity(run);
        if (!identity) continue;
        const existing = latestByIdentity.get(identity);
        if (!existing || compareRunReceiptRecency(run, existing) < 0) {
            latestByIdentity.set(identity, run);
        }
    }
    return clone(Array.from(latestByIdentity.values()));
}

function indexLatestRunReceipt(ledger, run) {
    const identity = runReceiptIdentity(run);
    if (!identity) return;
    const index = ledger.latest_run_receipts.findIndex(
        (candidate) => runReceiptIdentity(candidate) === identity
    );
    if (index === -1) {
        ledger.latest_run_receipts.push(clone(run));
        return;
    }
    if (compareRunReceiptRecency(run, ledger.latest_run_receipts[index]) < 0) {
        ledger.latest_run_receipts[index] = clone(run);
    }
}

function readLedgerFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return clone(EMPTY_LEDGER);
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        const quarantinePath = `${filePath}.corrupt-${Date.now()}`;
        try {
            fs.renameSync(filePath, quarantinePath);
        } catch {
            // Keep startup resilient even if quarantine cannot be written.
        }
        return {
            ...clone(EMPTY_LEDGER),
            recovery_error: error instanceof Error ? error.message : String(error),
            recovered_from: quarantinePath
        };
    }
    return {
        ...clone(EMPTY_LEDGER),
        ...parsed,
        workflows: Array.isArray(parsed.workflows) ? parsed.workflows : [],
        workflow_context_sources: Array.isArray(parsed.workflow_context_sources) ? parsed.workflow_context_sources : [],
        runs: Array.isArray(parsed.runs) ? parsed.runs : [],
        // Rebuild once at load time so ledgers written by an older process cannot
        // leave a stale persisted projection that hides a newer receipt.
        latest_run_receipts: buildLatestRunReceiptProjection(
            Array.isArray(parsed.runs) ? parsed.runs : []
        ),
        run_steps: Array.isArray(parsed.run_steps) ? parsed.run_steps : [],
        context_snapshots: Array.isArray(parsed.context_snapshots) ? parsed.context_snapshots : [],
        human_steps: Array.isArray(parsed.human_steps) ? parsed.human_steps : [],
        outputs: Array.isArray(parsed.outputs) ? parsed.outputs : [],
        audit_logs: Array.isArray(parsed.audit_logs) ? parsed.audit_logs : [],
        workflow_locks: Array.isArray(parsed.workflow_locks) ? parsed.workflow_locks : [],
        role_agent_instances: Array.isArray(parsed.role_agent_instances) ? parsed.role_agent_instances : [],
        workflow_templates: Array.isArray(parsed.workflow_templates) ? parsed.workflow_templates : [],
        workflow_bindings: Array.isArray(parsed.workflow_bindings) ? parsed.workflow_bindings : [],
        workflow_triggers: Array.isArray(parsed.workflow_triggers) ? parsed.workflow_triggers : [],
        loop_intents: Array.isArray(parsed.loop_intents) ? parsed.loop_intents : [],
        company_authority_approval_receipts: Array.isArray(parsed.company_authority_approval_receipts)
            ? parsed.company_authority_approval_receipts
            : []
    };
}

export class InMemoryWorkflowRepository {
    constructor({ seedWorkflows = [] } = {}) {
        this._transactionContext = new AsyncLocalStorage();
        this._transactionQueueTail = Promise.resolve();
        this._requireTransactionForMutations = false;
        this._workflowLocks = [];
        this.ledger = clone(EMPTY_LEDGER);
        for (const workflow of seedWorkflows) {
            this.upsertWorkflow(workflow);
        }
    }

    listWorkflows() {
        return clone(this.ledger.workflows);
    }

    getWorkflow(workflowId) {
        const workflow = this.ledger.workflows.find((item) => item.id === workflowId);
        return workflow ? clone(workflow) : null;
    }

    upsertWorkflow(workflow) {
        this._assertMutationAllowed();
        if (!workflow.workspace_id) {
            throw new Error('workflow.workspace_id is required');
        }
        if (!workflow.project_id) {
            throw new Error('workflow.project_id is required');
        }
        const now = nowIso();
        const next = {
            enabled: true,
            execution_env: 'local',
            risk_level: 'low',
            hitl_policy: 'none',
            context_sources: [],
            ...workflow,
            updated_at: now,
            created_at: workflow.created_at || now
        };
        const index = this.ledger.workflows.findIndex((item) => item.id === next.id);
        if (index === -1) {
            this.ledger.workflows.push(next);
        } else {
            this.ledger.workflows[index] = { ...this.ledger.workflows[index], ...next };
        }
        this._replaceWorkflowContextSources(next);
        this._persist();
        return clone(next);
    }

    createRun(run) {
        this._assertMutationAllowed();
        const next = {
            closure_state: 'open',
            status: 'queued',
            output_count: 0,
            human_waiting: false,
            created_at: nowIso(),
            ...run
        };
        this.ledger.runs.push(next);
        indexLatestRunReceipt(this.ledger, next);
        this._persist();
        return clone(next);
    }

    updateRun(runId, patch) {
        this._assertMutationAllowed();
        const index = this.ledger.runs.findIndex((item) => item.id === runId);
        if (index === -1) return null;
        const previous = this.ledger.runs[index];
        this.ledger.runs[index] = { ...this.ledger.runs[index], ...patch };
        if (runReceiptIdentity(previous) || runReceiptIdentity(this.ledger.runs[index])) {
            this.ledger.latest_run_receipts = buildLatestRunReceiptProjection(this.ledger.runs);
        }
        this._persist();
        return clone(this.ledger.runs[index]);
    }

    getRun(runId) {
        const run = this.ledger.runs.find((item) => item.id === runId);
        return run ? clone(run) : null;
    }

    findRun({ workflowId = null, predicate = null } = {}) {
        const match = this.ledger.runs.find((run) =>
            (!workflowId || run.workflow_id === workflowId)
            && (!predicate || predicate(run)));
        return match ? clone(match) : null;
    }

    listRuns({ workflowId = null, projectId = null, limit = 50 } = {}) {
        const runs = this.ledger.runs
            .filter((run) => !workflowId || run.workflow_id === workflowId)
            .filter((run) => !projectId || run.project_id === projectId)
            .sort((a, b) => String(b.started_at || b.created_at).localeCompare(String(a.started_at || a.created_at)));
        if (limit === null) return clone(runs);
        return clone(runs.slice(0, limit));
    }

    listLatestRunReceipts({ projectId = null } = {}) {
        return clone(this.ledger.latest_run_receipts
            .filter((run) => !projectId || run.project_id === projectId));
    }

    createRunStep(step) {
        this._assertMutationAllowed();
        this.ledger.run_steps.push({ created_at: nowIso(), ...step });
        this._persist();
        return clone(this.ledger.run_steps[this.ledger.run_steps.length - 1]);
    }

    updateRunStep(stepId, patch) {
        this._assertMutationAllowed();
        const index = this.ledger.run_steps.findIndex((item) => item.id === stepId);
        if (index === -1) return null;
        this.ledger.run_steps[index] = { ...this.ledger.run_steps[index], ...patch };
        this._persist();
        return clone(this.ledger.run_steps[index]);
    }

    listRunSteps(runId) {
        return clone(this.ledger.run_steps.filter((item) => item.workflow_run_id === runId));
    }

    listWorkflowContextSources(workflowId) {
        return clone(this.ledger.workflow_context_sources.filter((item) => item.workflow_id === workflowId));
    }

    createContextSnapshot(snapshot) {
        this._assertMutationAllowed();
        this.ledger.context_snapshots.push({ created_at: nowIso(), ...snapshot });
        this._persist();
        return clone(this.ledger.context_snapshots[this.ledger.context_snapshots.length - 1]);
    }

    listContextSnapshots(runId) {
        return clone(this.ledger.context_snapshots.filter((item) => item.workflow_run_id === runId));
    }

    createHumanStep(step) {
        this._assertMutationAllowed();
        const next = { status: 'pending', created_at: nowIso(), ...step };
        this.ledger.human_steps.push(next);
        this._persist();
        return clone(next);
    }

    updateHumanStep(stepId, patch) {
        this._assertMutationAllowed();
        const index = this.ledger.human_steps.findIndex((item) => item.id === stepId);
        if (index === -1) return null;
        this.ledger.human_steps[index] = { ...this.ledger.human_steps[index], ...patch };
        this._persist();
        return clone(this.ledger.human_steps[index]);
    }

    getHumanStep(stepId) {
        const step = this.ledger.human_steps.find((item) => item.id === stepId);
        return step ? clone(step) : null;
    }

    listHumanSteps(runId) {
        return clone(this.ledger.human_steps.filter((item) => item.workflow_run_id === runId));
    }

    createCompanyAuthorityApprovalReceipt(receipt) {
        this._assertMutationAllowed();
        if (!receipt?.id) throw new Error('company_authority_approval_receipts.id is required');
        if (this.ledger.company_authority_approval_receipts.some((item) => item.id === receipt.id)) {
            throw new Error(`company authority approval receipt '${receipt.id}' already exists`);
        }
        const next = {
            created_at: nowIso(),
            consumed_at: null,
            consumed_by: null,
            ...receipt
        };
        this.ledger.company_authority_approval_receipts.push(next);
        this._persist();
        return clone(next);
    }

    getCompanyAuthorityApprovalReceipt(receiptId) {
        const receipt = this.ledger.company_authority_approval_receipts
            .find((item) => item.id === receiptId);
        return receipt ? clone(receipt) : null;
    }

    listCompanyAuthorityApprovalReceipts({ humanStepId = null, tenantId = null } = {}) {
        return clone(this.ledger.company_authority_approval_receipts
            .filter((item) => !humanStepId || item.human_step_id === humanStepId)
            .filter((item) => !tenantId || item.tenant_id === tenantId));
    }

    consumeCompanyAuthorityApprovalReceipt(receiptId, {
        consumed_at: consumedAt,
        consumed_by: consumedBy,
        expected = {}
    } = {}) {
        this._assertMutationAllowed();
        const index = this.ledger.company_authority_approval_receipts
            .findIndex((item) => item.id === receiptId);
        if (index === -1) return null;
        const current = this.ledger.company_authority_approval_receipts[index];
        if (current.consumed_at) return null;
        for (const [field, value] of Object.entries(expected)) {
            if (value !== undefined && value !== null && current[field] !== value) return null;
        }
        const next = {
            ...current,
            consumed_at: consumedAt || nowIso(),
            consumed_by: consumedBy || null
        };
        this.ledger.company_authority_approval_receipts[index] = next;
        this._persist();
        return clone(next);
    }

    createOutput(output) {
        this._assertMutationAllowed();
        this.ledger.outputs.push({ created_at: nowIso(), ...output });
        this._persist();
        return clone(this.ledger.outputs[this.ledger.outputs.length - 1]);
    }

    listOutputs(runId) {
        return clone(this.ledger.outputs.filter((item) => item.workflow_run_id === runId));
    }

    getOutput(outputId) {
        const output = this.ledger.outputs.find((item) => item.id === outputId);
        return output ? clone(output) : null;
    }

    updateOutput(outputId, patch) {
        this._assertMutationAllowed();
        const index = this.ledger.outputs.findIndex((item) => item.id === outputId);
        if (index === -1) return null;
        this.ledger.outputs[index] = { ...this.ledger.outputs[index], ...patch };
        this._persist();
        return clone(this.ledger.outputs[index]);
    }

    writeAuditLog(entry) {
        this._assertMutationAllowed();
        this.ledger.audit_logs.push({ id: entry.id || `audit_${crypto.randomUUID()}`, created_at: nowIso(), ...entry });
        this._persist();
        return clone(this.ledger.audit_logs[this.ledger.audit_logs.length - 1]);
    }

    upsertAuditLog(entry) {
        if (!entry.id) throw new Error('audit entry id is required for upsert');
        const index = this.ledger.audit_logs.findIndex((item) => item.id === entry.id);
        if (index === -1) {
            this.ledger.audit_logs.push({ created_at: nowIso(), ...entry });
            this._persist();
            return clone(this.ledger.audit_logs[this.ledger.audit_logs.length - 1]);
        }
        this.ledger.audit_logs[index] = {
            ...this.ledger.audit_logs[index],
            ...entry,
            created_at: this.ledger.audit_logs[index].created_at
        };
        this._persist();
        return clone(this.ledger.audit_logs[index]);
    }

    listAuditLogs({ targetId = null, limit = 50 } = {}) {
        const logs = this.ledger.audit_logs
            .filter((item) => !targetId || item.target_id === targetId)
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
        return clone(logs.slice(0, limit));
    }

    async transaction(callback) {
        const current = this._transactionContext.getStore();
        if (current?.repository === this && current.active) {
            try {
                return await callback();
            } catch (error) {
                current.rollbackOnly = true;
                current.rollbackCause ||= error;
                throw error;
            }
        }

        const releaseTurn = await this._waitForTransactionTurn();
        const state = {
            repository: this,
            ownerId: crypto.randomUUID(),
            active: true,
            rollbackOnly: false,
            rollbackCause: null,
            dirty: false,
            snapshot: null,
            lease: null
        };

        return this._transactionContext.run(state, async () => {
            try {
                await this._beginTransaction(state);
                state.snapshot = clone(this.ledger);
                const result = await callback();
                if (state.rollbackOnly) {
                    const cause = state.rollbackCause instanceof Error
                        ? `: ${state.rollbackCause.message}`
                        : '';
                    throw new Error(`Workflow transaction is rollback-only${cause}`);
                }
                await this._commitTransaction(state);
                return result;
            } catch (error) {
                if (state.snapshot) this.ledger = state.snapshot;
                await this._rollbackTransaction(state, error);
                throw error;
            } finally {
                state.active = false;
                try {
                    await this._endTransaction(state);
                } finally {
                    releaseTurn();
                }
            }
        });
    }

    upsertRoleAgentInstance(agent) {
        return this._upsertCollectionItem('role_agent_instances', agent);
    }

    getRoleAgentInstance(agentId) {
        return this._getCollectionItem('role_agent_instances', agentId);
    }

    listRoleAgentInstances({ orgId = null, projectId = null, roleArchetypeId = null } = {}) {
        return this._listCollectionItems('role_agent_instances')
            .filter((agent) => !orgId || agent.org_id === orgId)
            .filter((agent) => !projectId || agent.project_id === projectId)
            .filter((agent) => !roleArchetypeId || agent.role_archetype_id === roleArchetypeId);
    }

    upsertWorkflowTemplate(template) {
        return this._upsertCollectionItem('workflow_templates', template);
    }

    getWorkflowTemplate(templateId) {
        return this._getCollectionItem('workflow_templates', templateId);
    }

    listWorkflowTemplates({ orgId = null, projectId = null, workflowKind = null } = {}) {
        return this._listCollectionItems('workflow_templates')
            .filter((template) => !orgId || !template.org_id || template.org_id === orgId)
            .filter((template) => !projectId || !template.project_id || template.project_id === projectId)
            .filter((template) => !workflowKind || template.workflow_kind === workflowKind);
    }

    upsertWorkflowBinding(binding) {
        return this._upsertCollectionItem('workflow_bindings', binding);
    }

    getWorkflowBinding(bindingId) {
        return this._getCollectionItem('workflow_bindings', bindingId);
    }

    listWorkflowBindings({ orgId = null, projectId = null, roleAgentInstanceId = null } = {}) {
        return this._listCollectionItems('workflow_bindings')
            .filter((binding) => !orgId || binding.org_id === orgId)
            .filter((binding) => !projectId || binding.project_id === projectId)
            .filter((binding) => !roleAgentInstanceId || binding.role_agent_instance_id === roleAgentInstanceId);
    }

    upsertWorkflowTrigger(trigger) {
        return this._upsertCollectionItem('workflow_triggers', trigger);
    }

    getWorkflowTrigger(triggerId) {
        return this._getCollectionItem('workflow_triggers', triggerId);
    }

    listWorkflowTriggers({ orgId = null, projectId = null, workflowBindingId = null, triggerType = null } = {}) {
        return this._listCollectionItems('workflow_triggers')
            .filter((trigger) => !orgId || trigger.org_id === orgId)
            .filter((trigger) => !projectId || trigger.project_id === projectId)
            .filter((trigger) => !workflowBindingId || trigger.workflow_binding_id === workflowBindingId)
            .filter((trigger) => !triggerType || trigger.trigger_type === triggerType);
    }

    upsertLoopIntent(intent) {
        return this._upsertCollectionItem('loop_intents', intent);
    }

    getLoopIntent(intentId) {
        return this._getCollectionItem('loop_intents', intentId);
    }

    listLoopIntents({ orgId = null, projectId = null, workflowBindingId = null, triggerId = null } = {}) {
        return this._listCollectionItems('loop_intents')
            .filter((intent) => !orgId || intent.org_id === orgId)
            .filter((intent) => !projectId || intent.project_id === projectId)
            .filter((intent) => !workflowBindingId || intent.workflow_binding_id === workflowBindingId)
            .filter((intent) => !triggerId || intent.trigger_id === triggerId)
            .sort((a, b) => String(b.created_at || b.updated_at).localeCompare(String(a.created_at || a.updated_at)));
    }

    acquireWorkflowLock({ workspace_id, workflow_id, locked_by, ttl_ms = 300000 }) {
        const now = Date.now();
        const existingIndex = this._workflowLocks.findIndex((item) => (
            item.workspace_id === workspace_id && item.workflow_id === workflow_id
        ));
        if (existingIndex !== -1) {
            const existing = this._workflowLocks[existingIndex];
            if (new Date(existing.expires_at).getTime() > now) {
                return null;
            }
            this._workflowLocks.splice(existingIndex, 1);
        }
        const lockedAt = new Date(now).toISOString();
        const lock = {
            workspace_id,
            workflow_id,
            locked_by,
            locked_at: lockedAt,
            expires_at: new Date(now + ttl_ms).toISOString()
        };
        this._workflowLocks.push(lock);
        return clone(lock);
    }

    releaseWorkflowLock({ workspace_id, workflow_id, locked_by }) {
        const index = this._workflowLocks.findIndex((item) => (
            item.workspace_id === workspace_id
            && item.workflow_id === workflow_id
            && item.locked_by === locked_by
        ));
        if (index === -1) return false;
        this._workflowLocks.splice(index, 1);
        return true;
    }

    _replaceWorkflowContextSources(workflow) {
        this.ledger.workflow_context_sources = this.ledger.workflow_context_sources
            .filter((item) => item.workflow_id !== workflow.id);
        const sources = Array.isArray(workflow.context_sources) ? workflow.context_sources : [];
        sources.forEach((source, index) => {
            this.ledger.workflow_context_sources.push({
                id: source.id || `wctx_${workflow.id}_${index + 1}`,
                workspace_id: workflow.workspace_id || 'default',
                org_id: workflow.org_id || source.org_id || null,
                project_id: workflow.project_id,
                workflow_id: workflow.id,
                source_type: source.source_type || source.type || 'unknown',
                source_ref: source.source_ref || null,
                scope: source.scope || 'project',
                permission: source.permission || 'read',
                required: Boolean(source.required),
                preview: source.preview || null,
                created_at: nowIso(),
                updated_at: nowIso()
            });
        });
    }

    _upsertCollectionItem(collectionName, item) {
        this._assertMutationAllowed();
        if (!item?.id) {
            throw new Error(`${collectionName}.id is required`);
        }
        const now = nowIso();
        const collection = this.ledger[collectionName];
        const next = {
            enabled: true,
            ...item,
            updated_at: now,
            created_at: item.created_at || now
        };
        const index = collection.findIndex((current) => current.id === next.id);
        if (index === -1) {
            collection.push(next);
        } else {
            collection[index] = { ...collection[index], ...next };
        }
        this._persist();
        return clone(next);
    }

    _getCollectionItem(collectionName, itemId) {
        const item = this.ledger[collectionName].find((current) => current.id === itemId);
        return item ? clone(item) : null;
    }

    _listCollectionItems(collectionName) {
        return clone(this.ledger[collectionName]);
    }

    _assertMutationAllowed() {
        if (!this._requireTransactionForMutations) return;
        const state = this._transactionContext.getStore();
        if (state?.repository === this && state.active) return;
        throw new Error('Json workflow ledger mutation requires repository.transaction()');
    }

    async _waitForTransactionTurn() {
        const previous = this._transactionQueueTail;
        let release;
        this._transactionQueueTail = new Promise((resolve) => {
            release = resolve;
        });
        await previous.catch(() => {});
        return release;
    }

    async _beginTransaction() {}

    async _commitTransaction() {}

    async _rollbackTransaction() {}

    async _endTransaction() {}

    _persist() {
        const state = this._transactionContext.getStore();
        if (state?.repository === this && state.active) {
            state.dirty = true;
        }
    }
}

export class JsonFileWorkflowRepository extends InMemoryWorkflowRepository {
    constructor({
        filePath,
        seedWorkflows = [],
        leaseAcquireTimeoutMs = 5000,
        leaseRetryMs = 20,
        leaseTtlMs = 30000,
        workflowLockMutationTtlMs = 30000
    }) {
        super();
        this.filePath = filePath;
        this.leaseAcquireTimeoutMs = leaseAcquireTimeoutMs;
        this.leaseRetryMs = leaseRetryMs;
        this.leaseTtlMs = leaseTtlMs;
        this.workflowLockMutationTtlMs = workflowLockMutationTtlMs;
        this.transactionLeasePath = filePath ? `${filePath}.transaction-lock.json` : null;
        this.transactionLeaseReclaimPath = this.transactionLeasePath
            ? `${this.transactionLeasePath}.reclaim`
            : null;
        this.ledger = readLedgerFile(filePath);
        this._requireTransactionForMutations = Boolean(filePath);
        this._initializeSeedWorkflows(seedWorkflows);
    }

    _writeLedgerFile() {
        if (!this.filePath) return;
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        const payload = {
            ...this.ledger,
            schema_version: '0.1.0',
            updated_at: nowIso()
        };
        const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`);
        fs.renameSync(tmpPath, this.filePath);
    }

    async _beginTransaction(state) {
        if (!this.filePath) return;
        state.lease = await this._acquireTransactionLease(state.ownerId);
        this.reload();
    }

    async _commitTransaction(state) {
        if (state.dirty) this._writeLedgerFile();
    }

    async _endTransaction(state) {
        if (state.lease) this._releaseTransactionLease(state.ownerId);
    }

    reload() {
        if (!this.filePath) return clone(this.ledger);
        this.ledger = readLedgerFile(this.filePath);
        return clone(this.ledger);
    }

    acquireWorkflowLock({ workspace_id, workflow_id, locked_by, ttl_ms = 300000 }) {
        if (!this.filePath) return super.acquireWorkflowLock({ workspace_id, workflow_id, locked_by, ttl_ms });
        const lockDir = path.join(path.dirname(this.filePath), '.workflow-locks');
        fs.mkdirSync(lockDir, { recursive: true });
        const lockPath = this._workflowLockPath({ workspace_id, workflow_id });
        const now = Date.now();
        const lock = {
            workspace_id,
            workflow_id,
            locked_by,
            pid: process.pid,
            locked_at: new Date(now).toISOString(),
            expires_at: new Date(now + ttl_ms).toISOString()
        };

        const writeLock = () => {
            const pendingPath = `${lockPath}.pending-${crypto.randomUUID()}`;
            const fd = fs.openSync(pendingPath, 'wx');
            try {
                fs.writeFileSync(fd, `${JSON.stringify(lock, null, 2)}\n`);
                fs.fsyncSync(fd);
            } finally {
                fs.closeSync(fd);
            }
            try {
                // Publish only a complete file and never replace a competing owner.
                fs.linkSync(pendingPath, lockPath);
                return clone(lock);
            } finally {
                fs.rmSync(pendingPath, { force: true });
            }
        };

        try {
            return writeLock();
        } catch (error) {
            if (error?.code !== 'EEXIST') throw error;
            const mutationGuard = this._acquireWorkflowLockMutation(lockPath);
            if (!mutationGuard) return null;
            let quarantinePath = null;
            try {
                const existing = this._readWorkflowLock(lockPath);
                const expiresAt = new Date(existing?.expires_at).getTime();
                if (existing && isLocalProcessAlive(existing.pid)) return null;
                if (existing && Number.isFinite(expiresAt) && expiresAt > Date.now()) return null;
                quarantinePath = this._quarantineWorkflowLock(lockPath);
                try {
                    return writeLock();
                } catch (retryError) {
                    if (retryError?.code === 'EEXIST') return null;
                    throw retryError;
                }
            } catch (reclaimError) {
                if (reclaimError?.code === 'ENOENT') return null;
                throw reclaimError;
            } finally {
                if (quarantinePath) fs.rmSync(quarantinePath, { force: true });
                this._releaseWorkflowLockMutation(lockPath, mutationGuard);
            }
        }
    }

    releaseWorkflowLock({ workspace_id, workflow_id, locked_by }) {
        if (!this.filePath) return super.releaseWorkflowLock({ workspace_id, workflow_id, locked_by });
        const lockPath = this._workflowLockPath({ workspace_id, workflow_id });
        if (!fs.existsSync(lockPath)) return false;
        const mutationGuard = this._acquireWorkflowLockMutation(lockPath);
        if (!mutationGuard) return false;
        let quarantinePath = null;
        try {
            const existing = this._readWorkflowLock(lockPath);
            if (!existing || existing.locked_by !== locked_by) return false;
            quarantinePath = this._quarantineWorkflowLock(lockPath);
            return true;
        } catch (error) {
            if (error?.code === 'ENOENT') return false;
            throw error;
        } finally {
            if (quarantinePath) fs.rmSync(quarantinePath, { force: true });
            this._releaseWorkflowLockMutation(lockPath, mutationGuard);
        }
    }

    _workflowLockPath({ workspace_id, workflow_id }) {
        return path.join(
            path.dirname(this.filePath),
            '.workflow-locks',
            `${lockKey({ workspace_id, workflow_id })}.json`
        );
    }

    _readWorkflowLock(lockPath) {
        try {
            return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        } catch {
            return null;
        }
    }

    _acquireWorkflowLockMutation(lockPath) {
        const mutationPath = `${lockPath}.mutation`;
        const createMutation = () => {
            fs.mkdirSync(mutationPath);
            try {
                const now = Date.now();
                const ownerId = crypto.randomUUID();
                const ownerPath = path.join(mutationPath, `owner-${ownerId}.json`);
                const owner = {
                    owner_id: ownerId,
                    pid: process.pid,
                    acquired_at: new Date(now).toISOString(),
                    expires_at: new Date(now + this.workflowLockMutationTtlMs).toISOString()
                };
                fs.writeFileSync(ownerPath, `${JSON.stringify(owner, null, 2)}\n`, { flag: 'wx' });
                return { ...owner, owner_path: ownerPath };
            } catch (error) {
                fs.rmSync(mutationPath, { recursive: true, force: true });
                throw error;
            }
        };

        try {
            return createMutation();
        } catch (error) {
            if (error?.code !== 'EEXIST') throw error;
        }

        let stat;
        let ownerRecord = null;
        try {
            stat = fs.statSync(mutationPath);
        } catch (error) {
            if (error?.code === 'ENOENT') {
                try {
                    return createMutation();
                } catch (retryError) {
                    if (retryError?.code === 'EEXIST') return false;
                    throw retryError;
                }
            }
            throw error;
        }
        ownerRecord = this._readWorkflowLockMutationOwner(mutationPath);
        const owner = ownerRecord?.owner || null;

        const expiresAt = new Date(owner?.expires_at).getTime();
        const expiredByMetadata = Number.isFinite(expiresAt) && expiresAt <= Date.now();
        const expiredByAge = stat && Date.now() - stat.mtimeMs >= this.workflowLockMutationTtlMs;
        if (owner && isLocalProcessAlive(owner.pid)) return false;
        if (!expiredByMetadata && !expiredByAge) return false;

        const currentStat = (() => {
            try {
                return fs.statSync(mutationPath);
            } catch (error) {
                if (error?.code === 'ENOENT') return null;
                throw error;
            }
        })();
        if (!currentStat || currentStat.dev !== stat.dev || currentStat.ino !== stat.ino) return false;
        const currentOwnerRecord = this._readWorkflowLockMutationOwner(mutationPath);
        const observedOwnerId = ownerRecord?.owner?.owner_id || null;
        const currentOwnerId = currentOwnerRecord?.owner?.owner_id || null;
        const observedOwnerPath = ownerRecord?.owner_path || null;
        const currentOwnerPath = currentOwnerRecord?.owner_path || null;
        if (observedOwnerId !== currentOwnerId || observedOwnerPath !== currentOwnerPath) return false;

        try {
            if (observedOwnerPath) fs.rmSync(observedOwnerPath);
            fs.rmdirSync(mutationPath);
        } catch (error) {
            if (['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error?.code)) return false;
            throw error;
        }
        try {
            return createMutation();
        } catch (error) {
            if (error?.code === 'EEXIST') return false;
            throw error;
        }
    }

    _readWorkflowLockMutationOwner(mutationPath) {
        let ownerFiles;
        try {
            ownerFiles = fs.readdirSync(mutationPath)
                .filter((name) => name === 'owner.json' || /^owner-[^.]+\.json$/.test(name))
                .sort();
        } catch (error) {
            if (error?.code === 'ENOENT') return null;
            throw error;
        }
        if (ownerFiles.length !== 1) return null;
        const ownerPath = path.join(mutationPath, ownerFiles[0]);
        try {
            return {
                owner: JSON.parse(fs.readFileSync(ownerPath, 'utf8')),
                owner_path: ownerPath
            };
        } catch {
            return { owner: null, owner_path: ownerPath };
        }
    }

    _releaseWorkflowLockMutation(lockPath, mutationGuard) {
        const mutationPath = `${lockPath}.mutation`;
        if (!mutationGuard?.owner_id || !mutationGuard?.owner_path) return false;
        const current = this._readWorkflowLockMutationOwner(mutationPath);
        if (current?.owner?.owner_id !== mutationGuard.owner_id
            || current.owner_path !== mutationGuard.owner_path) return false;
        try {
            fs.rmSync(mutationGuard.owner_path);
            fs.rmdirSync(mutationPath);
            return true;
        } catch (error) {
            if (['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error?.code)) return false;
            throw error;
        }
    }

    _quarantineWorkflowLock(lockPath) {
        const quarantinePath = `${lockPath}.stale-${crypto.randomUUID()}`;
        fs.renameSync(lockPath, quarantinePath);
        return quarantinePath;
    }

    _initializeSeedWorkflows(seedWorkflows) {
        if (!this.filePath || seedWorkflows.length === 0) return;
        const ownerId = `seed:${crypto.randomUUID()}`;
        const lease = this._acquireTransactionLeaseSync(ownerId);
        const previousLedger = clone(this.ledger);
        try {
            this.reload();
            const state = {
                repository: this,
                ownerId,
                active: true,
                rollbackOnly: false,
                rollbackCause: null,
                dirty: false,
                snapshot: clone(this.ledger),
                lease
            };
            this._transactionContext.run(state, () => {
                for (const workflow of seedWorkflows) {
                    if (!this.getWorkflow(workflow.id)) this.upsertWorkflow(workflow);
                }
            });
            state.active = false;
            if (state.dirty) this._writeLedgerFile();
        } catch (error) {
            this.ledger = previousLedger;
            throw error;
        } finally {
            this._releaseTransactionLease(ownerId);
        }
    }

    async _acquireTransactionLease(ownerId) {
        const startedAt = Date.now();
        while (true) {
            try {
                return this._createTransactionLease(ownerId);
            } catch (error) {
                if (error?.code !== 'EEXIST') throw error;
                if (this._reclaimStaleTransactionLease()) continue;
                if (Date.now() - startedAt >= this.leaseAcquireTimeoutMs) {
                    throw new Error(`Timed out acquiring workflow ledger lease after ${this.leaseAcquireTimeoutMs}ms`);
                }
                await new Promise((resolve) => setTimeout(resolve, this.leaseRetryMs));
            }
        }
    }

    _acquireTransactionLeaseSync(ownerId) {
        const startedAt = Date.now();
        while (true) {
            try {
                return this._createTransactionLease(ownerId);
            } catch (error) {
                if (error?.code !== 'EEXIST') throw error;
                if (this._reclaimStaleTransactionLease()) continue;
                if (Date.now() - startedAt >= this.leaseAcquireTimeoutMs) {
                    throw new Error(`Timed out acquiring workflow ledger lease after ${this.leaseAcquireTimeoutMs}ms`);
                }
                waitSync(this.leaseRetryMs);
            }
        }
    }

    _createTransactionLease(ownerId) {
        fs.mkdirSync(path.dirname(this.transactionLeasePath), { recursive: true });
        const now = Date.now();
        const lease = {
            schema_version: '1.0.0',
            owner_id: ownerId,
            pid: process.pid,
            acquired_at: new Date(now).toISOString(),
            expires_at: new Date(now + this.leaseTtlMs).toISOString()
        };
        fs.mkdirSync(this.transactionLeasePath);
        try {
            fs.writeFileSync(this._transactionLeaseMetadataPath(), `${JSON.stringify(lease, null, 2)}\n`);
        } catch (error) {
            fs.rmSync(this.transactionLeasePath, { recursive: true, force: true });
            throw error;
        }
        return lease;
    }

    _reclaimStaleTransactionLease() {
        if (!this._acquireTransactionLeaseReclaimLock()) return false;
        try {
            const existing = this._readTransactionLease();
            const expired = new Date(existing?.expires_at).getTime() <= Date.now();
            if (!existing || !expired || isLocalProcessAlive(existing.pid)) return false;

            const quarantinePath = `${this.transactionLeasePath}.stale-${crypto.randomUUID()}`;
            try {
                fs.renameSync(this.transactionLeasePath, quarantinePath);
            } catch (error) {
                if (error?.code === 'ENOENT') return true;
                throw error;
            }
            fs.rmSync(quarantinePath, { recursive: true, force: true });
            return true;
        } finally {
            this._releaseTransactionLeaseReclaimLock();
        }
    }

    _releaseTransactionLease(ownerId) {
        if (!this.transactionLeasePath || !fs.existsSync(this.transactionLeasePath)) return false;
        const existing = this._readTransactionLease();
        if (existing?.owner_id !== ownerId) return false;
        try {
            fs.rmSync(this.transactionLeasePath, { recursive: true });
            return true;
        } catch (error) {
            if (error?.code === 'ENOENT') return false;
            throw error;
        }
    }

    _transactionLeaseMetadataPath() {
        return path.join(this.transactionLeasePath, 'lease.json');
    }

    _readTransactionLease() {
        try {
            const stat = fs.statSync(this.transactionLeasePath);
            const metadataPath = stat.isDirectory()
                ? this._transactionLeaseMetadataPath()
                : this.transactionLeasePath;
            return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        } catch {
            return null;
        }
    }

    _acquireTransactionLeaseReclaimLock() {
        try {
            fs.mkdirSync(this.transactionLeaseReclaimPath);
            return true;
        } catch (error) {
            if (error?.code === 'EEXIST') return false;
            throw error;
        }
    }

    _releaseTransactionLeaseReclaimLock() {
        fs.rmSync(this.transactionLeaseReclaimPath, { recursive: true, force: true });
    }
}
