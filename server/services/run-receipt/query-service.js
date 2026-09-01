// @ts-check

import { AppError } from '../../lib/errors.js';

const RUN_RECEIPT_SOURCE_TYPES = new Set(['mana', 'codex_automations', 'github_actions', 'salestailor', 'openryoko']);
const RUN_RECEIPT_STATUSES = new Set(['success', 'failed', 'blocked', 'waiting_human', 'cancelled']);
const RUN_RECEIPT_EVIDENCE_STATES = new Set(['confirmed', 'unconfirmed', 'no_data']);
const DEFAULT_RUN_RECEIPT_INBOX_LIMIT = 100;
const MAX_RUN_RECEIPT_INBOX_LIMIT = 200;

function runReceiptEpoch(value) {
    const epoch = Date.parse(String(value || ''));
    return Number.isFinite(epoch) ? epoch : 0;
}

function runReceiptOrder(left, right) {
    const effectiveDifference = right.effective_epoch - left.effective_epoch;
    if (effectiveDifference !== 0) return effectiveDifference;
    const createdDifference = right.created_epoch - left.created_epoch;
    if (createdDifference !== 0) return createdDifference;
    return String(right.id).localeCompare(String(left.id));
}

function runReceiptPriority(item) {
    if (item.source_status === 'blocked' || item.source_action_required) return 1;
    if (item.source_status === 'failed') return 2;
    if (item.source_status === 'waiting_human') return 3;
    if (item.evidence_state === 'unconfirmed') return 4;
    if (item.evidence_state === 'no_data') return 5;
    return 6;
}

function normalizeLimit(value) {
    const limit = value === undefined || value === null || value === ''
        ? DEFAULT_RUN_RECEIPT_INBOX_LIMIT
        : Number(value);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RUN_RECEIPT_INBOX_LIMIT) {
        throw AppError.validation(
            `limit must be an integer between 1 and ${MAX_RUN_RECEIPT_INBOX_LIMIT}`,
            { field: 'limit' }
        );
    }
    return limit;
}

function normalizeEnum(value, field, allowed) {
    if (value === undefined || value === null || value === '') return null;
    if (!allowed.has(value)) {
        throw AppError.validation(`${field} is not supported`, { field, value });
    }
    return value;
}

function requireString(value, field) {
    if (typeof value !== 'string' || !value.trim()) {
        throw AppError.validation(`${field} is required`, { field });
    }
    return value.trim();
}

function projectItem(run) {
    const receipt = run?.metadata?.run_receipt;
    const source = receipt?.source;
    if (!receipt || !source?.type || !source?.workflow_id || !receipt.source_status || !receipt.evidence_state) {
        return null;
    }
    const effectiveAt = run.finished_at || run.started_at || run.created_at || null;
    return {
        id: run.id,
        run_id: run.id,
        workflow_id: run.workflow_id,
        project_id: run.project_id,
        org_id: run.org_id || receipt.org_id || null,
        source,
        source_status: receipt.source_status,
        evidence_state: receipt.evidence_state,
        observation_kind: receipt.observation_kind || 'source_run',
        action_required: run.action_required || 'none',
        source_action: receipt.source_action || null,
        source_action_required: receipt.source_action_required === true,
        summary: receipt.summary || run.message || null,
        blocker_reason: receipt.blocker_reason || null,
        evidence_refs: Array.isArray(receipt.evidence_refs) ? receipt.evidence_refs : [],
        metrics: receipt.metrics && typeof receipt.metrics === 'object' ? receipt.metrics : {},
        external_run_id: receipt.source_external_run_id || null,
        parent_external_run_id: receipt.parent_external_run_id || null,
        started_at: run.started_at || null,
        finished_at: run.finished_at || null,
        created_at: run.created_at || null,
        effective_at: effectiveAt,
        effective_epoch: runReceiptEpoch(effectiveAt),
        created_epoch: runReceiptEpoch(run.created_at)
    };
}

function publicItem(item) {
    const { effective_epoch, created_epoch, ...result } = item;
    return result;
}

export class RunReceiptQueryService {
    constructor({
        repository,
        prepareProjectAccess = async () => {},
        assertProjectAccess = () => {},
        canAccessProject = () => true
    }) {
        if (!repository) throw new Error('RunReceiptQueryService requires repository');
        this.repository = repository;
        this.prepareProjectAccess = prepareProjectAccess;
        this.assertProjectAccess = assertProjectAccess;
        this.canAccessProject = canAccessProject;
    }

    async listInbox({
        projectId = null,
        sourceType = null,
        runStatus = null,
        evidenceState = null,
        limit = DEFAULT_RUN_RECEIPT_INBOX_LIMIT
    } = {}, actor = {}) {
        await this.prepareProjectAccess(actor);
        const normalizedSourceType = normalizeEnum(sourceType, 'source_type', RUN_RECEIPT_SOURCE_TYPES);
        const normalizedRunStatus = normalizeEnum(runStatus, 'run_status', RUN_RECEIPT_STATUSES);
        const normalizedEvidenceState = normalizeEnum(
            evidenceState,
            'evidence_state',
            RUN_RECEIPT_EVIDENCE_STATES
        );
        const normalizedLimit = normalizeLimit(limit);
        if (projectId) this.assertProjectAccess(projectId, actor);

        const latestByIdentity = new Map();
        for (const run of this.repository.listLatestRunReceipts({ projectId })) {
            const item = projectItem(run);
            if (!item || !this.canAccessProject(item.project_id, actor)) continue;
            const identity = JSON.stringify([
                item.project_id,
                item.source.type,
                item.source.workflow_id
            ]);
            const existing = latestByIdentity.get(identity);
            if (!existing || runReceiptOrder(item, existing) < 0) {
                latestByIdentity.set(identity, item);
            }
        }

        const matching = Array.from(latestByIdentity.values())
            .filter((item) => !projectId || item.project_id === projectId)
            .filter((item) => !normalizedSourceType || item.source.type === normalizedSourceType)
            .filter((item) => !normalizedRunStatus || item.source_status === normalizedRunStatus)
            .filter((item) => !normalizedEvidenceState || item.evidence_state === normalizedEvidenceState)
            .map((item) => ({ ...item, priority: runReceiptPriority(item) }))
            .sort((left, right) => {
                const priorityDifference = left.priority - right.priority;
                return priorityDifference !== 0 ? priorityDifference : runReceiptOrder(left, right);
            });
        const count = matching.length;
        const items = matching.slice(0, normalizedLimit).map(publicItem);
        return {
            items,
            count,
            has_more: count > items.length,
            omitted_count: count - items.length
        };
    }

    async listHistory({
        projectId,
        sourceType,
        sourceIdentity,
        limit = DEFAULT_RUN_RECEIPT_INBOX_LIMIT
    } = {}, actor = {}) {
        await this.prepareProjectAccess(actor);
        const normalizedProjectId = requireString(projectId, 'project_id');
        const normalizedSourceType = normalizeEnum(
            requireString(sourceType, 'source_type'),
            'source_type',
            RUN_RECEIPT_SOURCE_TYPES
        );
        const normalizedSourceIdentity = requireString(sourceIdentity, 'source_identity');
        const normalizedLimit = normalizeLimit(limit);
        this.assertProjectAccess(normalizedProjectId, actor);

        const matching = this.repository.listRuns({ projectId: normalizedProjectId, limit: null })
            .map(projectItem)
            .filter(Boolean)
            .filter((item) => this.canAccessProject(item.project_id, actor))
            .filter((item) => item.source.type === normalizedSourceType)
            .filter((item) => item.source.workflow_id === normalizedSourceIdentity)
            .sort(runReceiptOrder);
        const count = matching.length;
        const items = matching.slice(0, normalizedLimit).map(publicItem);

        return {
            source: {
                type: normalizedSourceType,
                identity: normalizedSourceIdentity
            },
            items,
            count,
            has_more: count > items.length,
            omitted_count: count - items.length
        };
    }

    async diagnose({ projectId, runId } = {}, actor = {}) {
        await this.prepareProjectAccess(actor);
        const normalizedProjectId = requireString(projectId, 'project_id');
        const normalizedRunId = requireString(runId, 'run_id');
        this.assertProjectAccess(normalizedProjectId, actor);

        const item = projectItem(this.repository.getRun(normalizedRunId));
        if (!item || item.project_id !== normalizedProjectId) {
            throw AppError.notFound('run_receipt', normalizedRunId);
        }
        this.assertProjectAccess(item.project_id, actor);

        const issueCodes = [];
        if (item.source_status === 'blocked') issueCodes.push('source_blocked');
        if (item.source_status === 'failed') issueCodes.push('source_failed');
        if (item.source_status === 'waiting_human') issueCodes.push('human_action_required');
        if (item.evidence_state === 'no_data') issueCodes.push('evidence_missing');
        if (item.evidence_state === 'unconfirmed') issueCodes.push('evidence_unconfirmed');

        return {
            receipt: publicItem(item),
            diagnosis: {
                state: issueCodes.length > 0 || item.source_action_required
                    ? 'action_required'
                    : 'healthy',
                issue_codes: issueCodes,
                recommended_action: item.source_action || (
                    item.action_required && item.action_required !== 'none'
                        ? item.action_required
                        : null
                )
            }
        };
    }

    async summarizeRoutineState({
        project_id: projectId,
        since,
        until,
        routine_automation_ids: routineAutomationIds
    } = {}, context = {}) {
        const actor = context.actor || context.access || context;
        await this.prepareProjectAccess(actor);
        const normalizedProjectId = requireString(projectId, 'project_id');
        this.assertProjectAccess(normalizedProjectId, actor);
        const lowerBound = since ? runReceiptEpoch(since) : null;
        const upperBound = until ? runReceiptEpoch(until) : null;
        const identities = Array.isArray(routineAutomationIds) ? new Set(routineAutomationIds) : null;
        const items = this.repository.listRuns({ projectId: normalizedProjectId, limit: null })
            .map(projectItem)
            .filter(Boolean)
            .filter((item) => this.canAccessProject(item.project_id, actor))
            .filter((item) => !identities || identities.has(item.source.workflow_id))
            .filter((item) => lowerBound === null || item.effective_epoch >= lowerBound)
            .filter((item) => upperBound === null || item.effective_epoch < upperBound)
            .sort(runReceiptOrder);
        const uniqueRuns = [...items.reduce((runs, item) => {
            const identity = item.external_run_id
                ? `${item.source.workflow_id}:${item.external_run_id}`
                : `${item.source.workflow_id}:${item.run_id}`;
            if (!runs.has(identity)) runs.set(identity, item);
            return runs;
        }, new Map()).values()];
        const latestByRoutine = identities
            ? [...uniqueRuns.reduce((latest, item) => {
                if (!latest.has(item.source.workflow_id)) latest.set(item.source.workflow_id, item);
                return latest;
            }, new Map()).values()]
            : uniqueRuns;
        return {
            outbox_count: null,
            stoppage_count: latestByRoutine.filter((item) => isStoppedReceipt(item)).length
        };
    }
}

function isStoppedReceipt(item) {
    return ['blocked', 'failed', 'waiting_human'].includes(item.source_status)
        || ['no_data', 'unconfirmed'].includes(item.evidence_state);
}
