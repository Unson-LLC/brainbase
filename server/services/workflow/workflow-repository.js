// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const EMPTY_LEDGER = {
    schema_version: '0.1.0',
    workflows: [],
    workflow_context_sources: [],
    runs: [],
    run_steps: [],
    context_snapshots: [],
    human_steps: [],
    outputs: [],
    audit_logs: [],
    workflow_locks: []
};

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function nowIso() {
    return new Date().toISOString();
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
        run_steps: Array.isArray(parsed.run_steps) ? parsed.run_steps : [],
        context_snapshots: Array.isArray(parsed.context_snapshots) ? parsed.context_snapshots : [],
        human_steps: Array.isArray(parsed.human_steps) ? parsed.human_steps : [],
        outputs: Array.isArray(parsed.outputs) ? parsed.outputs : [],
        audit_logs: Array.isArray(parsed.audit_logs) ? parsed.audit_logs : [],
        workflow_locks: Array.isArray(parsed.workflow_locks) ? parsed.workflow_locks : []
    };
}

export class InMemoryWorkflowRepository {
    constructor({ seedWorkflows = [] } = {}) {
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

    updateWorkflow(workflowId, patch) {
        const current = this.getWorkflow(workflowId);
        if (!current) return null;
        return this.upsertWorkflow({ ...current, ...patch, id: workflowId });
    }

    createRun(run) {
        const next = {
            closure_state: 'open',
            status: 'queued',
            output_count: 0,
            human_waiting: false,
            created_at: nowIso(),
            ...run
        };
        this.ledger.runs.push(next);
        this._persist();
        return clone(next);
    }

    updateRun(runId, patch) {
        const index = this.ledger.runs.findIndex((item) => item.id === runId);
        if (index === -1) return null;
        this.ledger.runs[index] = { ...this.ledger.runs[index], ...patch };
        this._persist();
        return clone(this.ledger.runs[index]);
    }

    getRun(runId) {
        const run = this.ledger.runs.find((item) => item.id === runId);
        return run ? clone(run) : null;
    }

    listRuns({ workflowId = null, projectId = null, limit = 50 } = {}) {
        const runs = this.ledger.runs
            .filter((run) => !workflowId || run.workflow_id === workflowId)
            .filter((run) => !projectId || run.project_id === projectId)
            .sort((a, b) => String(b.started_at || b.created_at).localeCompare(String(a.started_at || a.created_at)));
        return clone(runs.slice(0, limit));
    }

    createRunStep(step) {
        this.ledger.run_steps.push({ created_at: nowIso(), ...step });
        this._persist();
        return clone(this.ledger.run_steps[this.ledger.run_steps.length - 1]);
    }

    updateRunStep(stepId, patch) {
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
        this.ledger.context_snapshots.push({ created_at: nowIso(), ...snapshot });
        this._persist();
        return clone(this.ledger.context_snapshots[this.ledger.context_snapshots.length - 1]);
    }

    listContextSnapshots(runId) {
        return clone(this.ledger.context_snapshots.filter((item) => item.workflow_run_id === runId));
    }

    createHumanStep(step) {
        const next = { status: 'pending', created_at: nowIso(), ...step };
        this.ledger.human_steps.push(next);
        this._persist();
        return clone(next);
    }

    updateHumanStep(stepId, patch) {
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

    createOutput(output) {
        this.ledger.outputs.push({ created_at: nowIso(), ...output });
        this._persist();
        return clone(this.ledger.outputs[this.ledger.outputs.length - 1]);
    }

    listOutputs(runId) {
        return clone(this.ledger.outputs.filter((item) => item.workflow_run_id === runId));
    }

    writeAuditLog(entry) {
        this.ledger.audit_logs.push({ id: entry.id || `audit_${crypto.randomUUID()}`, created_at: nowIso(), ...entry });
        this._persist();
        return clone(this.ledger.audit_logs[this.ledger.audit_logs.length - 1]);
    }

    listAuditLogs({ targetId = null, limit = 50 } = {}) {
        const logs = this.ledger.audit_logs
            .filter((item) => !targetId || item.target_id === targetId)
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
        return clone(logs.slice(0, limit));
    }

    acquireWorkflowLock({ workspace_id, workflow_id, locked_by, ttl_ms = 300000 }) {
        const now = Date.now();
        const existingIndex = this.ledger.workflow_locks.findIndex((item) => (
            item.workspace_id === workspace_id && item.workflow_id === workflow_id
        ));
        if (existingIndex !== -1) {
            const existing = this.ledger.workflow_locks[existingIndex];
            if (new Date(existing.expires_at).getTime() > now) {
                return null;
            }
            this.ledger.workflow_locks.splice(existingIndex, 1);
        }
        const lockedAt = new Date(now).toISOString();
        const lock = {
            workspace_id,
            workflow_id,
            locked_by,
            locked_at: lockedAt,
            expires_at: new Date(now + ttl_ms).toISOString()
        };
        this.ledger.workflow_locks.push(lock);
        this._persist();
        return clone(lock);
    }

    releaseWorkflowLock({ workspace_id, workflow_id, locked_by }) {
        const index = this.ledger.workflow_locks.findIndex((item) => (
            item.workspace_id === workspace_id
            && item.workflow_id === workflow_id
            && item.locked_by === locked_by
        ));
        if (index === -1) return false;
        this.ledger.workflow_locks.splice(index, 1);
        this._persist();
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

    _persist() {}
}

export class JsonFileWorkflowRepository extends InMemoryWorkflowRepository {
    constructor({ filePath, seedWorkflows = [] }) {
        super();
        this.filePath = filePath;
        this.ledger = readLedgerFile(filePath);
        for (const workflow of seedWorkflows) {
            if (!this.getWorkflow(workflow.id)) {
                this.upsertWorkflow(workflow);
            }
        }
    }

    _persist() {
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
}
