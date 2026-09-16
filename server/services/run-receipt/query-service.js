// @ts-check

import { AppError } from '../../lib/errors.js';

const RUN_RECEIPT_SOURCE_TYPES = new Set(['mana', 'codex_automations', 'github_actions', 'salestailor', 'openryoko']);
const RUN_RECEIPT_STATUSES = new Set(['success', 'failed', 'blocked', 'waiting_human', 'cancelled']);
const RUN_RECEIPT_EVIDENCE_STATES = new Set(['confirmed', 'unconfirmed', 'no_data']);
const DEFAULT_RUN_RECEIPT_INBOX_LIMIT = 100;
const MAX_RUN_RECEIPT_INBOX_LIMIT = 200;
const MEETING_WORKFLOW_PATTERN = /meeting|minutes|議事録/iu;

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
        ...(receipt.judgment_trace && typeof receipt.judgment_trace === 'object'
            ? { judgment_trace: receipt.judgment_trace }
            : {}),
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

function actorFromContext(context = {}) {
    return context.actor || context.access || context;
}

function isMeetingReceipt(item) {
    if (item?.source?.type !== 'mana') return false;
    if (item.judgment_trace) return true;
    return MEETING_WORKFLOW_PATTERN.test(String(item.source.workflow_id || ''))
        || MEETING_WORKFLOW_PATTERN.test(String(item.workflow_id || ''));
}

function uniqueEvidenceRefs(...collections) {
    const refs = collections.flatMap((collection) => Array.isArray(collection) ? collection : []);
    return [...new Map(refs
        .filter((ref) => ref && typeof ref.ref === 'string')
        .map((ref) => [`${ref.kind || 'unknown'}:${ref.ref}`, ref])).values()];
}

function traceEvidenceRefs(item, trace, ...extra) {
    return uniqueEvidenceRefs(
        item.evidence_refs,
        trace?.nodes?.flatMap((node) => node?.evidence_refs || []),
        trace?.glossary?.term_refs?.flatMap((term) => term?.evidence_refs || []),
        trace?.quality?.evidence_refs,
        trace?.replay?.evidence_refs,
        trace?.replay?.changed_version_refs,
        trace?.replay?.original_failure_refs,
        trace?.replay?.separate_case_refs,
        ...extra
    );
}

function judgmentNodeKey(node) {
    return typeof node?.node_id === 'string' && node.node_id.trim()
        ? node.node_id
        : node?.id || null;
}

function isLaterJudgmentAttempt(candidate, current) {
    const candidateSequence = Number.isSafeInteger(candidate?.node?.sequence)
        ? candidate.node.sequence : null;
    const currentSequence = Number.isSafeInteger(current?.node?.sequence)
        ? current.node.sequence : null;
    if (candidateSequence !== null && currentSequence !== null && candidateSequence !== currentSequence) {
        return candidateSequence > currentSequence;
    }
    if (candidateSequence !== null && currentSequence === null) return true;
    if (candidateSequence === null && currentSequence !== null) return false;
    return candidate.index > current.index;
}

/**
 * Mana keeps every node attempt in a trace. Only the latest attempt for a
 * node describes the current run state; older attempts are retained for
 * audit/history and must not create a new defect or replay requirement.
 */
function currentJudgmentNodes(trace) {
    const groups = new Map();
    for (const [index, node] of (Array.isArray(trace?.nodes) ? trace.nodes : []).entries()) {
        const key = judgmentNodeKey(node);
        if (!key) continue;
        const attempt = { node, index };
        const attempts = groups.get(key) || [];
        attempts.push(attempt);
        groups.set(key, attempts);
    }
    const current = new Map();
    for (const [key, attempts] of groups) {
        let latest = attempts[0];
        for (const candidate of attempts.slice(1)) {
            if (isLaterJudgmentAttempt(candidate, latest)) latest = candidate;
        }
        current.set(key, latest);
    }
    return {
        currentNodes: [...current.values()].map((attempt) => attempt.node),
        currentIndexes: new Set([...current.values()].map((attempt) => attempt.index))
    };
}

/**
 * Mana may emit a terminal failure with a status/attempt suffix and then a
 * successful receipt for the same run revision. Keep the revision portion of
 * the identity while treating those terminal suffixes as attempts of one
 * operation. This lets the newest receipt win without discarding the older
 * receipt or its event references.
 */
function meetingOperationExternalRunId(externalRunId) {
    if (typeof externalRunId !== 'string' || !externalRunId.trim()) return null;
    return externalRunId.trim().replace(
        /:status:(?:success|failed|blocked|waiting_human|cancelled)(?::attempt:[^]*)?$/u,
        ''
    );
}

function meetingOperationKey(itemOrSource = {}) {
    const workflowId = itemOrSource?.source?.workflow_id || itemOrSource?.workflow_id || '';
    const externalRunId = itemOrSource?.external_run_id || itemOrSource?.externalRunId || null;
    const normalizedExternalRunId = meetingOperationExternalRunId(externalRunId);
    if (normalizedExternalRunId) return `${workflowId}:${normalizedExternalRunId}`;
    return `${workflowId}:${itemOrSource?.run_id || itemOrSource?.runId || ''}`;
}

function meetingOperationAliases(group = []) {
    const runIds = new Set();
    const externalRunIds = new Set();
    const normalizedExternalRunIds = new Set();
    const operationKeys = new Set();
    for (const item of group) {
        if (item?.run_id) runIds.add(item.run_id);
        if (item?.external_run_id) {
            externalRunIds.add(item.external_run_id);
            const normalized = meetingOperationExternalRunId(item.external_run_id);
            if (normalized) normalizedExternalRunIds.add(normalized);
        }
        operationKeys.add(meetingOperationKey(item));
    }
    return {
        run_ids: [...runIds],
        external_run_ids: [...externalRunIds],
        normalized_external_run_ids: [...normalizedExternalRunIds],
        operation_keys: [...operationKeys]
    };
}

function feedbackMatchesMeetingItem(item, target) {
    const aliases = item?.meeting_operation_aliases || {};
    const runIds = [item?.run_id, ...(aliases.run_ids || [])].filter(Boolean);
    const externalRunIds = [item?.external_run_id, ...(aliases.external_run_ids || [])].filter(Boolean);
    const normalizedExternalRunIds = [
        meetingOperationExternalRunId(item?.external_run_id),
        ...(aliases.normalized_external_run_ids || [])
    ].filter(Boolean);
    const operationKeys = [meetingOperationKey(item), ...(aliases.operation_keys || [])];
    const targetRunId = target?.run_id || target?.runId || null;
    const targetExternalRunId = target?.external_run_id || target?.externalRunId || null;
    const targetWorkflowId = target?.source?.workflow_id || target?.workflow_id || null;
    const itemWorkflowId = item?.source?.workflow_id || item?.workflow_id || null;
    if (targetWorkflowId && itemWorkflowId && targetWorkflowId !== itemWorkflowId) return false;

    if (targetRunId && runIds.includes(targetRunId)) return true;
    if (targetExternalRunId && externalRunIds.includes(targetExternalRunId)) return true;

    const normalizedExternalRunId = meetingOperationExternalRunId(targetExternalRunId);
    if (normalizedExternalRunId
        && normalizedExternalRunIds.includes(normalizedExternalRunId)) {
        // Existing feedback events may omit workflow_id. The normalized
        // external run id is then the only durable alias available.
        if (!targetWorkflowId) return true;
        return operationKeys.includes(meetingOperationKey(target));
    }
    return targetWorkflowId && operationKeys.includes(meetingOperationKey(target));
}

function isMeetingItemInWindow(item, lowerBound, upperBound) {
    return (lowerBound === null || item.effective_epoch >= lowerBound)
        && (upperBound === null || item.effective_epoch < upperBound);
}

function traceCoverage(trace) {
    if (!trace || typeof trace !== 'object') return 'unknown';
    const nodes = currentJudgmentNodes(trace).currentNodes;
    const hasEvidence = traceEvidenceRefs({}, trace).length > 0;
    if (trace.glossary?.coverage === 'confirmed'
        && trace.quality?.status === 'confirmed'
        && nodes.length > 0
        && nodes.every((node) => node?.status && node.status !== 'unknown')
        && hasEvidence) return 'confirmed';
    if (hasEvidence || nodes.some((node) => node?.status && node.status !== 'unknown')) return 'partial';
    return 'unknown';
}

function normalizeFeedbackCorrection(row) {
    const payload = row?.payload && typeof row.payload === 'object' ? row.payload : row || {};
    const event = row?.event && typeof row.event === 'object' ? row.event : {};
    const source = row?.source || event.source || {};
    const sourcePointer = row?.source_pointer || event.source_pointer || payload.source_pointer || {};
    const correctionEvent = payload.correction_event || row?.correction_event || null;
    const evidenceRefs = uniqueEvidenceRefs(
        payload.evidence_refs,
        sourcePointer.evidence_refs,
        correctionEvent?.source_pointer?.evidence_refs,
        correctionEvent?.payload?.evidence_refs,
        correctionEvent?.evidence_refs
    );
    const correctsEventId = row?.event_id || payload.event_id || null;
    if (!correctsEventId || !source?.external_run_id && !sourcePointer?.run_id) return null;
    return {
        ...(row?.feedback_id || payload.feedback_id ? {
            feedback_id: row.feedback_id || payload.feedback_id
        } : {}),
        corrects_event_id: correctsEventId,
        action: row?.action || payload.action || 'unknown',
        ...(payload.reason ? { reason: String(payload.reason).slice(0, 1000) } : {}),
        evidence_refs: evidenceRefs,
        ...(correctionEvent ? {
            replacement: {
                ...(correctionEvent.event_id ? { event_id: correctionEvent.event_id } : {}),
                ...(correctionEvent.subject?.type ? { subject_type: correctionEvent.subject.type } : {}),
                ...(correctionEvent.subject?.id ? { subject_id: correctionEvent.subject.id } : {}),
                ...(correctionEvent.payload?.summary || correctionEvent.summary ? {
                    summary: String(correctionEvent.payload?.summary || correctionEvent.summary).slice(0, 2000)
                } : {}),
                evidence_refs: uniqueEvidenceRefs(
                    correctionEvent.source_pointer?.evidence_refs,
                    correctionEvent.payload?.evidence_refs,
                    correctionEvent.evidence_refs
                )
            }
        } : {})
    };
}

function mergeCorrections(traceCorrections = [], feedbackCorrections = []) {
    const merged = [];
    const seen = new Set();
    for (const correction of [...traceCorrections, ...feedbackCorrections]) {
        if (!correction || typeof correction !== 'object') continue;
        const identity = correction.feedback_id
            ? `feedback:${correction.feedback_id}`
            : JSON.stringify([
                correction.corrects_event_id || null,
                correction.action || null,
                correction.reason || null,
                correction.replacement?.event_id || null
            ]);
        if (seen.has(identity)) continue;
        seen.add(identity);
        merged.push(correction);
    }
    return merged;
}

function judgmentExecution(item, corrections = []) {
    const trace = item.judgment_trace;
    const currentIndexes = currentJudgmentNodes(trace).currentIndexes;
    return {
        run_id: item.run_id,
        ...(item.external_run_id ? { external_run_id: item.external_run_id } : {}),
        workflow_id: item.source.workflow_id,
        dag: trace?.dag || null,
        ...(trace?.graph_playbook_status
            ? { graph_playbook_status: trace.graph_playbook_status } : {}),
        coverage: traceCoverage(trace),
        nodes: (Array.isArray(trace?.nodes) ? trace.nodes : []).slice(0, 256).map((node, index) => ({
            id: node.id,
            ...(node.node_id ? { node_id: node.node_id } : {}),
            status: node.status,
            ...(node.outcome ? { outcome: node.outcome } : {}),
            ...(node.event_id ? { event_id: node.event_id } : {}),
            ...(Number.isSafeInteger(node.sequence) ? { sequence: node.sequence } : {}),
            ...(node.node_version ? { node_version: node.node_version } : {}),
            ...(node.next_branch ? { next_branch: node.next_branch } : {}),
            ...(node.started_at ? { started_at: node.started_at } : {}),
            ...(node.finished_at ? { finished_at: node.finished_at } : {}),
            ...(Array.isArray(node.input_refs) ? { input_refs: node.input_refs } : {}),
            ...(currentIndexes.has(index) ? { is_current: true } : {}),
            evidence_refs: Array.isArray(node.evidence_refs) ? node.evidence_refs : []
        })),
        glossary: {
            coverage: trace?.glossary?.coverage || 'unknown',
            unresolved_count: trace?.glossary?.unresolved_count ?? null,
            term_refs: Array.isArray(trace?.glossary?.term_refs)
                ? trace.glossary.term_refs : []
        },
        quality: {
            status: trace?.quality?.status || 'unknown',
            evidence_refs: Array.isArray(trace?.quality?.evidence_refs)
                ? trace.quality.evidence_refs : [],
            issue_codes: Array.isArray(trace?.quality?.issue_codes)
                ? trace.quality.issue_codes : []
        },
        corrections: mergeCorrections(trace?.corrections, corrections),
        replay: {
            status: trace?.replay?.status || 'unknown',
            evidence_refs: Array.isArray(trace?.replay?.evidence_refs)
                ? trace.replay.evidence_refs : [],
            verified_run_ids: Array.isArray(trace?.replay?.verified_run_ids)
                ? trace.replay.verified_run_ids : [],
            changed_version_refs: Array.isArray(trace?.replay?.changed_version_refs)
                ? trace.replay.changed_version_refs : [],
            original_failure_refs: Array.isArray(trace?.replay?.original_failure_refs)
                ? trace.replay.original_failure_refs : [],
            separate_case_refs: Array.isArray(trace?.replay?.separate_case_refs)
                ? trace.replay.separate_case_refs : []
        },
        evidence_refs: traceEvidenceRefs(item, trace)
    };
}

function causeLink({
    item,
    trace,
    nodeId,
    nodeVersion = null,
    causeCode,
    summary,
    evidenceRefs = [],
    sourceEventIds = [],
    observedValue = null
}) {
    const causeNode = {
        node_id: nodeId,
        dag_id: trace?.dag?.id || null,
        dag_version: trace?.dag?.version || null,
        ...(nodeVersion ? { node_version: nodeVersion } : {})
    };
    return {
        cause_code: causeCode,
        cause_node: causeNode,
        source_run_id: item.run_id,
        ...(item.external_run_id ? { external_run_id: item.external_run_id } : {}),
        source_event_ids: [...new Set(sourceEventIds.filter((id) => typeof id === 'string' && id.trim()))],
        evidence_refs: uniqueEvidenceRefs(evidenceRefs),
        summary,
        ...(observedValue !== null ? { observed_value: observedValue } : {})
    };
}

function normalizeCauseCode(value, fallback = 'quality_issue') {
    const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    return normalized ? `${fallback}_${normalized}` : fallback;
}

function replayVerified(replay = {}) {
    const originalFailureRefs = Array.isArray(replay.original_failure_refs)
        ? replay.original_failure_refs : [];
    const separateCaseRefs = Array.isArray(replay.separate_case_refs)
        ? replay.separate_case_refs : [];
    const originalFailureKeys = new Set(originalFailureRefs
        .filter((ref) => ref && typeof ref.ref === 'string')
        .map((ref) => `${ref.kind || 'unknown'}:${ref.ref}`));
    return replay?.status === 'confirmed'
        && Array.isArray(replay.evidence_refs)
        && replay.evidence_refs.length > 0
        && Array.isArray(replay.verified_run_ids)
        && replay.verified_run_ids.length > 0
        && Array.isArray(replay.changed_version_refs)
        && replay.changed_version_refs.length > 0
        && originalFailureRefs.length > 0
        && separateCaseRefs.length > 0
        && separateCaseRefs.some((ref) => ref
            && typeof ref.ref === 'string'
            && !originalFailureKeys.has(`${ref.kind || 'unknown'}:${ref.ref}`));
}

function hasActionableJudgmentDefect(item, corrections = []) {
    const trace = item?.judgment_trace;
    if (!trace) return false;
    if (currentJudgmentNodes(trace).currentNodes.some((node) => (
        node?.status === 'blocked'
        || node?.status === 'unknown'
        || (node?.outcome && /error|fail|wrong|unresolved|misregistr|incorrect|miss/iu.test(node.outcome))
    ))) return true;
    const glossary = trace.glossary || {};
    if (Number(glossary.unresolved_count) > 0) return true;
    const quality = trace.quality || {};
    if (Array.isArray(quality.issue_codes) && quality.issue_codes.length > 0) return true;
    return mergeCorrections(trace.corrections, corrections).length > 0;
}

function deriveCauseLinks(item, feedbackCorrections = []) {
    const trace = item.judgment_trace;
    if (!trace) return [];
    const links = [];
    for (const node of currentJudgmentNodes(trace).currentNodes) {
        const nodeId = node.node_id || node.id;
        const nodeEventIds = node.event_id ? [node.event_id] : [];
        if (node?.status === 'blocked' || node?.status === 'unknown') {
            links.push(causeLink({
                item,
                trace,
                nodeId,
                nodeVersion: node.node_version,
                causeCode: node.status === 'blocked' ? 'judgment_node_blocked' : 'judgment_node_unknown',
                summary: node.status === 'blocked'
                    ? `判断ノード「${nodeId}」がblockedのままです`
                    : `判断ノード「${nodeId}」の実行結果がunknownです`,
                evidenceRefs: node.evidence_refs,
                sourceEventIds: nodeEventIds,
                observedValue: node.status
            }));
        }
        if (node?.outcome && /error|fail|wrong|unresolved|misregistr|incorrect|miss/iu.test(node.outcome)) {
            links.push(causeLink({
                item,
                trace,
                nodeId,
                nodeVersion: node.node_version,
                causeCode: normalizeCauseCode(node.outcome, 'judgment_outcome'),
                summary: `判断ノード「${nodeId}」の結果が${node.outcome}です`,
                evidenceRefs: node.evidence_refs,
                sourceEventIds: nodeEventIds,
                observedValue: node.outcome
            }));
        }
    }
    const glossary = trace.glossary || {};
    if (Number(glossary.unresolved_count) > 0) {
        links.push(causeLink({
            item,
            trace,
            nodeId: 'glossary_resolution',
            causeCode: 'glossary_coverage_unconfirmed',
            summary: glossary.coverage === 'unknown'
                ? '用語集の取得・照合結果がunknownです'
                : '用語集の取得・照合範囲がpartialです',
            evidenceRefs: glossary.term_refs?.flatMap((term) => term?.evidence_refs || []),
            observedValue: glossary.unresolved_count ?? glossary.coverage
        }));
    }
    const quality = trace.quality || {};
    for (const issueCode of quality.issue_codes || []) {
        links.push(causeLink({
            item,
            trace,
            nodeId: 'quality_review',
            causeCode: normalizeCauseCode(issueCode, 'quality_issue'),
            summary: `議事録品質の問題コード「${issueCode}」が記録されています`,
            evidenceRefs: quality.evidence_refs,
            observedValue: issueCode
        }));
    }
    for (const correction of mergeCorrections(trace.corrections, feedbackCorrections)) {
        links.push(causeLink({
            item,
            trace,
            nodeId: 'correction_feedback',
            causeCode: 'meeting_judgment_correction',
            summary: `判断イベント「${correction.corrects_event_id}」への${correction.action}訂正があります`,
            evidenceRefs: correction.evidence_refs || [],
            sourceEventIds: [correction.corrects_event_id],
            observedValue: correction.action
        }));
    }
    const replay = trace.replay || {};
    if (hasActionableJudgmentDefect(item, feedbackCorrections) && !replayVerified(replay)) {
        links.push(causeLink({
            item,
            trace,
            nodeId: 'replay_verification',
            causeCode: 'replay_evidence_unconfirmed',
            summary: replay.status === 'unknown'
                ? '修正後の再実行結果がunknownです'
                : '修正後の再実行に必要な根拠が不足しています',
            evidenceRefs: traceEvidenceRefs({}, trace),
            sourceEventIds: replay.verified_run_ids,
            observedValue: replay.status
        }));
    }
    return [...new Map(links.map((link) => [
        JSON.stringify([link.cause_code, link.cause_node, link.source_run_id, link.source_event_ids]),
        link
    ])).values()];
}

function aggregateReplay(items, feedbackByRun = new Map()) {
    const missingRunIds = [];
    const evidenceRefs = [];
    const changedVersionRefs = [];
    const originalFailureRefs = [];
    const separateCaseRefs = [];
    const verifiedRunIds = [];
    let requiredRunCount = 0;
    for (const item of items) {
        const corrections = feedbackByRun.get(item.run_id) || [];
        if (!hasActionableJudgmentDefect(item, corrections)) continue;
        requiredRunCount += 1;
        const replay = item.judgment_trace?.replay;
        const verified = replayVerified(replay);
        if (!verified) missingRunIds.push(item.run_id);
        evidenceRefs.push(...(replay?.evidence_refs || []));
        changedVersionRefs.push(...(replay?.changed_version_refs || []));
        originalFailureRefs.push(...(replay?.original_failure_refs || []));
        separateCaseRefs.push(...(replay?.separate_case_refs || []));
        verifiedRunIds.push(...(replay?.verified_run_ids || []));
    }
    const hasReplayEvidence = evidenceRefs.length > 0
        || changedVersionRefs.length > 0
        || originalFailureRefs.length > 0
        || separateCaseRefs.length > 0;
    const status = requiredRunCount === 0
        ? 'unknown'
        : missingRunIds.length === 0 ? 'confirmed' : hasReplayEvidence ? 'partial' : 'unknown';
    return {
        status,
        verified: status === 'confirmed',
        required: requiredRunCount > 0,
        checked_run_count: items.length,
        required_run_count: requiredRunCount,
        verified_run_ids: [...new Set(verifiedRunIds)],
        evidence_refs: uniqueEvidenceRefs(evidenceRefs),
        changed_version_refs: uniqueEvidenceRefs(changedVersionRefs),
        original_failure_refs: uniqueEvidenceRefs(originalFailureRefs),
        separate_case_refs: uniqueEvidenceRefs(separateCaseRefs),
        ...(missingRunIds.length > 0 ? { missing_run_ids: missingRunIds } : {})
    };
}

export class RunReceiptQueryService {
    constructor({
        repository,
        prepareProjectAccess = async () => {},
        assertProjectAccess = () => {},
        canAccessProject = () => true,
        knowledgeEventRepository = null
    }) {
        if (!repository) throw new Error('RunReceiptQueryService requires repository');
        this.repository = repository;
        this.prepareProjectAccess = prepareProjectAccess;
        this.assertProjectAccess = assertProjectAccess;
        this.canAccessProject = canAccessProject;
        this.knowledgeEventRepository = knowledgeEventRepository;
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

    async _listMeetingJudgmentItems({ project_id: projectId, since, until } = {}, context = {}) {
        const actor = actorFromContext(context);
        await this.prepareProjectAccess(actor);
        const normalizedProjectId = requireString(projectId, 'project_id');
        this.assertProjectAccess(normalizedProjectId, actor);
        const lowerBound = since ? runReceiptEpoch(since) : null;
        const upperBound = until ? runReceiptEpoch(until) : null;
        const allItems = this.repository.listRuns({ projectId: normalizedProjectId, limit: null })
            .map(projectItem)
            .filter(Boolean)
            .filter((item) => this.canAccessProject(item.project_id, actor))
            .filter(isMeetingReceipt)
            .sort(runReceiptOrder);
        const feedbackRows = await this._listMeetingJudgmentFeedback(normalizedProjectId, context);
        const feedbackTargets = feedbackRows.map((row) => ({
            run_id: row.run_id,
            external_run_id: row.external_run_id,
            workflow_id: row.workflow_id
        }));
        const isFeedbackTarget = (item) => feedbackTargets.some((target) => (
            feedbackMatchesMeetingItem(item, target)
        ));

        // A receipt can be persisted outside today's window while its defect or
        // later feedback is still unresolved. Group all attempts first, then
        // choose the newest receipt for the operation. This prevents an older
        // failed attempt from remaining actionable after a later success.
        const operationGroups = new Map();
        for (const item of allItems) {
            const key = meetingOperationKey(item);
            const group = operationGroups.get(key) || [];
            group.push(item);
            operationGroups.set(key, group);
        }
        const selected = [];
        for (const group of operationGroups.values()) {
            const relevant = group.some((item) => (
                isMeetingItemInWindow(item, lowerBound, upperBound)
                || hasActionableJudgmentDefect(item)
                || isFeedbackTarget(item)
            ));
            if (!relevant) continue;
            selected.push({
                ...group[0],
                // Keep immutable receipt IDs as private lookup aliases. The
                // newest attempt remains the source of the current judgment,
                // while later feedback can still point to an older receipt.
                meeting_operation_aliases: meetingOperationAliases(group)
            });
        }
        return selected.sort(runReceiptOrder);
    }

    async _listMeetingJudgmentFeedback(projectId, context = {}) {
        if (typeof this.knowledgeEventRepository?.listFeedback !== 'function') return [];
        const actor = actorFromContext(context);
        const access = {
            ...actor,
            personId: actor.personId || actor.person_id || null,
            ...(actor.organizationId || actor.organization_id
                ? { organizationId: actor.organizationId || actor.organization_id }
                : {}),
            ...(actor.tenantId || actor.tenant_id
                ? { tenantId: actor.tenantId || actor.tenant_id }
                : {})
        };
        const rows = await this.knowledgeEventRepository.listFeedback(
            { projectCode: projectId },
            { access }
        );
        return (Array.isArray(rows) ? rows : []).flatMap((row) => {
            const event = row?.event && typeof row.event === 'object' ? row.event : {};
            const source = row?.source || event.source || {};
            if (source.type !== 'mana_meeting_judgment') return [];
            const correction = normalizeFeedbackCorrection(row);
            if (!correction) return [];
            const sourcePointer = row?.source_pointer || event.source_pointer || {};
            return [{
                correction,
                run_id: sourcePointer.run_id || null,
                external_run_id: source.external_run_id || sourcePointer.external_run_id || null,
                workflow_id: source.workflow_id || null
            }];
        });
    }

    /**
     * Return bounded meeting judgment execution/correction evidence for the
     * existing routine cycle. This reads persisted Run Receipts only; it does
     * not re-fetch Slack, transcripts, or other source systems.
     */
    async summarizeMeetingJudgmentLearning(scope = {}, context = {}) {
        const items = await this._listMeetingJudgmentItems(scope, context);
        const feedbackRows = await this._listMeetingJudgmentFeedback(scope.project_id, context);
        const byRun = new Map();
        const byExternalRun = new Map();
        const itemByRun = new Map();
        const itemByExternalRun = new Map();
        const itemByOperation = new Map();
        for (const item of items) {
            const aliases = item.meeting_operation_aliases || {};
            for (const runId of [item.run_id, ...(aliases.run_ids || [])]) {
                if (runId) itemByRun.set(runId, item);
            }
            for (const externalRunId of [item.external_run_id, ...(aliases.external_run_ids || [])]) {
                if (externalRunId) itemByExternalRun.set(externalRunId, item);
            }
            for (const operationKey of [meetingOperationKey(item), ...(aliases.operation_keys || [])]) {
                itemByOperation.set(operationKey, item);
            }
        }
        for (const row of feedbackRows) {
            const item = itemByRun.get(row.run_id)
                || itemByExternalRun.get(row.external_run_id)
                || itemByOperation.get(meetingOperationKey(row))
                || items.find((candidate) => feedbackMatchesMeetingItem(candidate, row));
            if (!item) continue;
            if (!byRun.has(item.run_id)) byRun.set(item.run_id, []);
            byRun.get(item.run_id).push(row.correction);
        }
        const tracedItems = items.filter((item) => item.judgment_trace);
        const coverageStatus = items.length === 0
            ? 'unknown'
            : tracedItems.length < items.length
                ? tracedItems.length > 0 ? 'partial' : 'unknown'
                : tracedItems.every((item) => traceCoverage(item.judgment_trace) === 'confirmed')
                    ? 'confirmed' : 'partial';
        const causeLinks = tracedItems.flatMap((item) => deriveCauseLinks(item, byRun.get(item.run_id) || []));
        const corrections = tracedItems.reduce(
            (count, item) => count + mergeCorrections(
                item.judgment_trace?.corrections,
                byRun.get(item.run_id) || []
            ).length,
            0
        );
        return {
            coverage: coverageStatus,
            execution_count: items.length,
            traced_run_count: tracedItems.length,
            unknown_run_count: items.length - tracedItems.length,
            correction_count: corrections,
            dag_versions: [...new Set(tracedItems
                .map((item) => item.judgment_trace?.dag)
                .filter((dag) => dag?.id && dag?.version)
                .map((dag) => `${dag.id}@${dag.version}`))],
            executions: tracedItems.slice(0, 100).map((item) => judgmentExecution(
                item,
                byRun.get(item.run_id) || []
            )),
            cause_links: causeLinks,
            replay: aggregateReplay(tracedItems, byRun),
            window: {
                ...(scope.since ? { since: scope.since } : {}),
                ...(scope.until ? { until: scope.until } : {})
            }
        };
    }

    /**
     * A replay is closed only when the receipt itself reports a confirmed
     * replay with evidence, a changed version, the original failure, a
     * separate case, and at least one verified run id. Missing or
     * complaint-free runs remain unknown/partial.
     */
    async verifyMeetingJudgmentReplay(scope = {}, context = {}) {
        const items = await this._listMeetingJudgmentItems(scope, context);
        const feedbackRows = await this._listMeetingJudgmentFeedback(scope.project_id, context);
        const itemByRun = new Map();
        const itemByExternalRun = new Map();
        const itemByOperation = new Map();
        for (const item of items) {
            const aliases = item.meeting_operation_aliases || {};
            for (const runId of [item.run_id, ...(aliases.run_ids || [])]) {
                if (runId) itemByRun.set(runId, item);
            }
            for (const externalRunId of [item.external_run_id, ...(aliases.external_run_ids || [])]) {
                if (externalRunId) itemByExternalRun.set(externalRunId, item);
            }
            for (const operationKey of [meetingOperationKey(item), ...(aliases.operation_keys || [])]) {
                itemByOperation.set(operationKey, item);
            }
        }
        const byRun = new Map();
        for (const row of feedbackRows) {
            const item = itemByRun.get(row.run_id)
                || itemByExternalRun.get(row.external_run_id)
                || itemByOperation.get(meetingOperationKey(row))
                || items.find((candidate) => feedbackMatchesMeetingItem(candidate, row));
            if (!item) continue;
            if (!byRun.has(item.run_id)) byRun.set(item.run_id, []);
            byRun.get(item.run_id).push(row.correction);
        }
        return aggregateReplay(items, byRun);
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
