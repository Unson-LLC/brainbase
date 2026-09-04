#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import process from 'node:process';
import pg from 'pg';

import { SOURCE_SYSTEM } from '../server/services/sns/oyasumi-meeting-personal-kg-service.js';
import {
    candidateOrganizationId,
    isPersonalKgCandidateInScope,
    requirePersonalKgIdentity
} from '../server/services/sns/personal-kg-identity.js';

const POLICY_KEY = 'oyasumi_meeting_personal_kg';
const ACTIVE_STATUSES = new Set(['candidate', 'pending_approval', 'approved']);
const REVIEW_STATUSES = new Set(['candidate', 'pending_approval']);
const DECISIONS = new Set(['approved', 'redacted', 'rejected', 'expired']);
const AGENCY_LEVELS = new Set(['none', 'read-only', 'synthesize', 'write-back']);
const SENSITIVITIES = new Set(['internal', 'restricted', 'confidential', 'top-secret']);
const REDACTION_STATUSES = new Set(['none', 'redacted', 'needs_redaction']);
const REVIEW_SCOPES = new Set(['needs_review', 'redaction', 'all']);

function parseArgs(argv) {
    const args = {
        json: false,
        inputJson: null,
        decisionFile: null,
        projectionPlan: false,
        write: false,
        ownerPersonId: null,
        actorPersonId: null,
        organizationId: null,
        delegationId: null,
        sourceSystem: SOURCE_SYSTEM,
        limit: null,
        includeApprovalCandidates: false,
        reviewScope: 'needs_review'
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--json') args.json = true;
        else if (arg === '--input-json') args.inputJson = argv[++index];
        else if (arg.startsWith('--input-json=')) args.inputJson = arg.slice('--input-json='.length);
        else if (arg === '--decision-file') args.decisionFile = argv[++index];
        else if (arg.startsWith('--decision-file=')) args.decisionFile = arg.slice('--decision-file='.length);
        else if (arg === '--projection-plan') args.projectionPlan = true;
        else if (arg === '--write') args.write = true;
        else if (arg === '--dry-run') args.write = false;
        else if (arg === '--owner' || arg === '--owner-person-id') args.ownerPersonId = argv[++index];
        else if (arg.startsWith('--owner=')) args.ownerPersonId = arg.slice('--owner='.length);
        else if (arg.startsWith('--owner-person-id=')) args.ownerPersonId = arg.slice('--owner-person-id='.length);
        else if (arg === '--actor' || arg === '--actor-person-id') args.actorPersonId = argv[++index];
        else if (arg.startsWith('--actor=')) args.actorPersonId = arg.slice('--actor='.length);
        else if (arg.startsWith('--actor-person-id=')) args.actorPersonId = arg.slice('--actor-person-id='.length);
        else if (arg === '--organization' || arg === '--organization-id') args.organizationId = argv[++index];
        else if (arg.startsWith('--organization=')) args.organizationId = arg.slice('--organization='.length);
        else if (arg.startsWith('--organization-id=')) args.organizationId = arg.slice('--organization-id='.length);
        else if (arg === '--delegation-id') args.delegationId = argv[++index];
        else if (arg.startsWith('--delegation-id=')) args.delegationId = arg.slice('--delegation-id='.length);
        else if (arg === '--source-system') args.sourceSystem = argv[++index];
        else if (arg.startsWith('--source-system=')) args.sourceSystem = arg.slice('--source-system='.length);
        else if (arg === '--include-approval-candidates') args.includeApprovalCandidates = true;
        else if (arg === '--review-scope') args.reviewScope = argv[++index];
        else if (arg.startsWith('--review-scope=')) args.reviewScope = arg.slice('--review-scope='.length);
        else if (arg === '--limit') args.limit = Number(argv[++index]);
        else if (arg.startsWith('--limit=')) args.limit = Number(arg.slice('--limit='.length));
        else throw new Error(`unknown argument: ${arg}`);
    }
    if (args.limit !== null && (!Number.isInteger(args.limit) || args.limit < 1)) {
        throw new Error('--limit must be a positive integer');
    }
    if (!REVIEW_SCOPES.has(args.reviewScope)) {
        throw new Error('--review-scope must be one of needs_review, redaction, all');
    }
    return args;
}

function personalKgIdentity(options, env = process.env) {
    return requirePersonalKgIdentity({
        owner_person_id: options?.owner_person_id || options?.ownerPersonId
            || env.BRAINBASE_PERSONAL_KG_OWNER_PERSON_ID,
        actor_person_id: options?.actor_person_id || options?.actorPersonId
            || env.BRAINBASE_PERSONAL_KG_ACTOR_PERSON_ID,
        organization_id: options?.organization_id || options?.organizationId
            || env.BRAINBASE_PERSONAL_KG_ORGANIZATION_ID
            || env.BRAINBASE_ORGANIZATION_ID,
        org_ids: options?.org_ids,
        delegation_id: options?.delegation_id || options?.delegationId
            || env.BRAINBASE_PERSONAL_KG_DELEGATION_ID
    }, env);
}

function databaseConfig() {
    if (process.env.INFO_SSOT_DATABASE_URL || process.env.INFO_SSOT_DB_URL) {
        return { connectionString: process.env.INFO_SSOT_DATABASE_URL || process.env.INFO_SSOT_DB_URL };
    }
    if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL };
    return null;
}

function policy(candidate) {
    return candidate.permission_snapshot?.[POLICY_KEY] || {};
}

function memoryLayer(candidate) {
    return policy(candidate).memory_layer || null;
}

function candidateSourceRef(candidate) {
    const kg = policy(candidate);
    if (kg.source_ref) return kg.source_ref;
    const sourceEventIds = Array.isArray(candidate.source_event_ids) ? candidate.source_event_ids : [];
    return sourceEventIds[0] || null;
}

function safeBodyLength(candidate) {
    if (Number.isFinite(Number(candidate.body_length))) return Number(candidate.body_length);
    if (typeof candidate.body === 'string') return candidate.body.length;
    return null;
}

function candidateReviewReasons(candidate, { includeApprovalCandidates = false, reviewScope = 'needs_review' } = {}) {
    const kg = policy(candidate);
    const reasons = [];
    if (reviewScope === 'needs_review' || reviewScope === 'all') {
        if (kg.memory_layer === 'needs_review') reasons.push('memory_layer:needs_review');
        if (kg.extraction_decision === 'needs_review') reasons.push('extraction_decision:needs_review');
    }
    if (reviewScope === 'redaction' || reviewScope === 'all') {
        if (candidate.redaction_status === 'needs_redaction') reasons.push('redaction_status:needs_redaction');
    }
    if (includeApprovalCandidates && candidate.requires_approval === true && REVIEW_STATUSES.has(candidate.promotion_status || 'candidate')) {
        reasons.push('requires_approval:active');
    }
    return reasons;
}

function isScopedCandidate(candidate, options = {}) {
    if (candidate.source_system !== (options.sourceSystem || SOURCE_SYSTEM)) return false;
    if (!candidate.permission_snapshot?.[POLICY_KEY]) return false;
    try {
        return isPersonalKgCandidateInScope(candidate, personalKgIdentity(options));
    } catch {
        return false;
    }
}

function isPolicyCandidate(candidate, { sourceSystem = SOURCE_SYSTEM } = {}) {
    if (candidate.source_system !== sourceSystem) return false;
    return Boolean(candidate.permission_snapshot?.[POLICY_KEY]);
}

function safeCandidateSummary(candidate, options = {}) {
    const kg = policy(candidate);
    return {
        id: candidate.id,
        source_system: candidate.source_system,
        source_ref: candidateSourceRef(candidate),
        source_kind: kg.source_kind || null,
        memory_layer: kg.memory_layer || null,
        category: kg.category || null,
        rule_id: kg.rule_id || null,
        cognitive_type: candidate.cognitive_type || null,
        owner_person_id: candidate.owner_person_id || null,
        visibility: candidate.visibility || null,
        sensitivity: candidate.sensitivity || null,
        role_min: candidate.role_min || null,
        agency_level: candidate.agency_level || null,
        promotion_status: candidate.promotion_status || null,
        requires_approval: candidate.requires_approval === true,
        redaction_status: candidate.redaction_status || null,
        projection_allowed: kg.projection_allowed ?? null,
        projection_gate: kg.projection_gate || null,
        retrieval_purpose: kg.retrieval_purpose || null,
        project_code: candidate.project_code || null,
        project_ids: Array.isArray(candidate.project_ids) ? candidate.project_ids : [],
        body_length: safeBodyLength(candidate),
        evidence_count: Array.isArray(candidate.evidence_ids) ? candidate.evidence_ids.length : 0,
        created_at: candidate.created_at || null,
        updated_at: candidate.updated_at || null,
        review_reasons: candidateReviewReasons(candidate, options)
    };
}

function buildReviewQueue(candidates = [], options = {}) {
    const limit = options.limit;
    const queue = candidates
        .filter((candidate) => isScopedCandidate(candidate, options))
        .filter((candidate) => candidateReviewReasons(candidate, options).length > 0)
        .map((candidate) => safeCandidateSummary(candidate, options))
        .sort((left, right) => String(left.created_at || '').localeCompare(String(right.created_at || '')) || left.id.localeCompare(right.id));
    return Number.isInteger(limit) ? queue.slice(0, limit) : queue;
}

function projectionBlockers(candidate, options = {}) {
    const kg = policy(candidate);
    const blockers = [];
    let identity = null;
    try {
        identity = personalKgIdentity(options);
    } catch {
        blockers.push('identity:required');
    }
    if (identity && candidate.owner_person_id !== identity.owner_person_id) {
        blockers.push('owner_person_id:not_requested_owner');
    }
    const organizationId = candidateOrganizationId(candidate);
    if (!organizationId) blockers.push('organization_id:missing');
    else if (identity && organizationId !== identity.organization_id) {
        blockers.push('organization_id:not_requested_organization');
    }
    if (candidate.visibility !== 'owner') blockers.push('visibility:not_owner');
    if (memoryLayer(candidate) !== 'personal_kg_core') blockers.push(`memory_layer:${memoryLayer(candidate) || 'missing'}`);
    if (!ACTIVE_STATUSES.has(candidate.promotion_status || 'candidate')) blockers.push(`promotion_status:${candidate.promotion_status || 'missing'}`);
    if (candidate.promotion_status === 'rejected') blockers.push('promotion_status:rejected');
    if (candidate.promotion_status === 'expired') blockers.push('promotion_status:expired');
    if ((candidate.sensitivity || 'internal') !== 'internal') blockers.push(`sensitivity:${candidate.sensitivity || 'missing'}`);
    if ((candidate.redaction_status || 'none') !== 'none') blockers.push(`redaction_status:${candidate.redaction_status || 'missing'}`);
    if ((candidate.agency_level || 'synthesize') === 'none') blockers.push('agency_level:none');
    if (kg.projection_allowed === false) blockers.push('projection_allowed:false');
    return [...new Set(blockers)];
}

function buildSnsProjectionPlan(candidates = [], options = {}) {
    const scoped = candidates.filter((candidate) => isPolicyCandidate(candidate, options));
    const eligible = [];
    const alreadySnsReady = [];
    const blocked = [];
    for (const candidate of scoped) {
        const layer = memoryLayer(candidate);
        if (layer === 'sns_ready') {
            const active = ACTIVE_STATUSES.has(candidate.promotion_status || 'candidate')
                && candidate.visibility === 'owner'
                && (candidate.redaction_status || 'none') === 'none'
                && (candidate.agency_level || 'synthesize') !== 'none';
            if (active) alreadySnsReady.push(safeCandidateSummary(candidate));
            else blocked.push({ ...safeCandidateSummary(candidate), projection_blockers: projectionBlockers(candidate, options) });
            continue;
        }
        const blockers = projectionBlockers(candidate, options);
        if (blockers.length === 0) {
            eligible.push({
                ...safeCandidateSummary(candidate),
                projection_action: 'needs_body_level_projection_writer'
            });
        } else {
            blocked.push({ ...safeCandidateSummary(candidate), projection_blockers: blockers });
        }
    }
    return {
        summary: {
            input_candidates: scoped.length,
            eligible: eligible.length,
            already_sns_ready: alreadySnsReady.length,
            blocked: blocked.length
        },
        eligible,
        already_sns_ready: alreadySnsReady,
        blocked
    };
}

function statusTransitionsFor(currentStatus, decision) {
    if (decision === 'approved') {
        if (currentStatus === 'candidate') return ['pending_approval', 'approved'];
        if (currentStatus === 'pending_approval') return ['approved'];
        if (currentStatus === 'approved') return [];
        return null;
    }
    if (decision === 'rejected') {
        if (currentStatus === 'candidate' || currentStatus === 'pending_approval') return ['rejected'];
        if (currentStatus === 'rejected') return [];
        return null;
    }
    if (decision === 'expired') {
        if (currentStatus === 'candidate' || currentStatus === 'pending_approval') return ['expired'];
        if (currentStatus === 'expired') return [];
        return null;
    }
    if (decision === 'redacted') return [];
    return null;
}

function normalizedDecision(record) {
    return {
        id: record.id,
        decision: record.decision || record.outcome,
        agency_level: record.agency_level || null,
        sensitivity: record.sensitivity || null,
        redaction_status: record.redaction_status || null,
        projection_allowed: typeof record.projection_allowed === 'boolean' ? record.projection_allowed : null,
        note: record.note || record.reason || null
    };
}

function validateDecisionRecord(candidate, decisionRecord) {
    const errors = [];
    if (!candidate) errors.push('candidate:not_found');
    if (!DECISIONS.has(decisionRecord.decision)) errors.push(`decision:unsupported:${decisionRecord.decision || 'missing'}`);
    if (decisionRecord.agency_level && !AGENCY_LEVELS.has(decisionRecord.agency_level)) errors.push(`agency_level:unsupported:${decisionRecord.agency_level}`);
    if (decisionRecord.sensitivity && !SENSITIVITIES.has(decisionRecord.sensitivity)) errors.push(`sensitivity:unsupported:${decisionRecord.sensitivity}`);
    if (decisionRecord.redaction_status && !REDACTION_STATUSES.has(decisionRecord.redaction_status)) errors.push(`redaction_status:unsupported:${decisionRecord.redaction_status}`);
    if (!candidate) return errors;

    const transitions = statusTransitionsFor(candidate.promotion_status || 'candidate', decisionRecord.decision);
    if (transitions === null) {
        errors.push(`promotion_status:invalid_transition:${candidate.promotion_status || 'missing'}->${decisionRecord.decision}`);
    }
    if (decisionRecord.decision === 'approved') {
        const nextRedaction = decisionRecord.redaction_status || candidate.redaction_status || 'none';
        const nextSensitivity = decisionRecord.sensitivity || candidate.sensitivity || 'internal';
        if (nextRedaction === 'needs_redaction') errors.push('approved:redaction_still_needs_review');
        if (nextSensitivity !== 'internal' && decisionRecord.projection_allowed === true) {
            errors.push('approved_for_projection:sensitivity_not_internal');
        }
    }
    return errors;
}

function buildDecisionPlan(candidates = [], decisionRecords = [], options = {}) {
    const candidateById = new Map(candidates
        .filter((candidate) => isScopedCandidate(candidate, options))
        .map((candidate) => [candidate.id, candidate]));
    const decisions = decisionRecords.map(normalizedDecision);
    const items = decisions.map((decisionRecord) => {
        const candidate = candidateById.get(decisionRecord.id);
        const errors = validateDecisionRecord(candidate, decisionRecord);
        const currentStatus = candidate?.promotion_status || 'candidate';
        const transitions = errors.length === 0 ? statusTransitionsFor(currentStatus, decisionRecord.decision) : null;
        const next = candidate ? {
            promotion_status: transitions && transitions.length > 0 ? transitions[transitions.length - 1] : currentStatus,
            redaction_status: decisionRecord.redaction_status || (decisionRecord.decision === 'redacted' ? 'redacted' : candidate.redaction_status || 'none'),
            sensitivity: decisionRecord.sensitivity || candidate.sensitivity || 'internal',
            agency_level: decisionRecord.agency_level || (decisionRecord.decision === 'redacted' ? 'none' : candidate.agency_level || 'synthesize'),
            projection_allowed: decisionRecord.projection_allowed
                ?? (decisionRecord.decision === 'redacted' ? false : policy(candidate).projection_allowed ?? null)
        } : null;
        return {
            id: decisionRecord.id,
            decision: decisionRecord.decision,
            status: errors.length > 0 ? 'blocked' : 'ready',
            errors,
            current: candidate ? safeCandidateSummary(candidate) : null,
            next,
            status_transitions: transitions || [],
            audit_reason: decisionRecord.note || `personal_kg_review_projection:${decisionRecord.decision}`
        };
    });
    return {
        mode: options.write ? 'write_plan' : 'dry_run',
        summary: {
            decisions: items.length,
            ready: items.filter((item) => item.status === 'ready').length,
            blocked: items.filter((item) => item.status === 'blocked').length
        },
        items
    };
}

function readJsonFile(filePath) {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.candidates)) return parsed.candidates;
    if (Array.isArray(parsed.decisions)) return parsed.decisions;
    throw new Error(`${filePath} must contain an array, candidates[], or decisions[]`);
}

async function loadCandidatesFromDatabase({ connectionString, ownerPersonId, organizationId, sourceSystem }) {
    if (!connectionString) {
        throw new Error('INFO_SSOT_DATABASE_URL, INFO_SSOT_DB_URL, DATABASE_URL, or --input-json is required');
    }
    if (!ownerPersonId || !organizationId) {
        throw new Error('ownerPersonId and organizationId are required for Personal KG database reads');
    }
    const pool = new pg.Pool({ connectionString });
    try {
        const result = await pool.query(
            `SELECT id, cognitive_type, owner_person_id, actor_person_id, source_system, source_event_ids,
                    workspace, channel_id, thread_ts, project_code, org_ids, project_ids, team_id,
                    visibility, sensitivity, role_min, agency_level, recommended_subject_type,
                    recommended_owner_person_id, promotion_status, promoted_graph_entity_id,
                    requires_approval, permission_snapshot, evidence_ids, redaction_status,
                    confidence, expires_at, created_at, updated_at, LENGTH(body) AS body_length
             FROM memory_candidates
             WHERE owner_person_id = $1
               AND organization_id = $2
               AND source_system = $3
               AND permission_snapshot ? $4
             ORDER BY created_at ASC, id ASC`,
            [ownerPersonId, organizationId, sourceSystem, POLICY_KEY]
        );
        return result.rows;
    } finally {
        await pool.end().catch(() => {});
    }
}

async function applyDecisionPlan({ connectionString, plan, candidates, actorPersonId }) {
    if (!connectionString) throw new Error('--write requires database connection');
    const ready = plan.items.filter((item) => item.status === 'ready');
    const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const pool = new pg.Pool({ connectionString });
    const applied = [];
    try {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            for (const item of ready) {
                const candidate = candidateById.get(item.id);
                let previousStatus = candidate.promotion_status || 'candidate';
                for (const nextStatus of item.status_transitions) {
                    await client.query(
                        `UPDATE memory_candidates
                         SET promotion_status = $1, requires_approval = $2, updated_at = NOW()
                         WHERE id = $3`,
                        [nextStatus, nextStatus === 'pending_approval', item.id]
                    );
                    await client.query(
                        `INSERT INTO promotion_audit_events
                         (candidate_id, actor_person_id, decision_owner_person_id, decision_reason, previous_status, next_status, evidence_ids)
                         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
                        [item.id, actorPersonId, candidate.owner_person_id, item.audit_reason, previousStatus, nextStatus, JSON.stringify(candidate.evidence_ids || [])]
                    );
                    previousStatus = nextStatus;
                }
                const nextSnapshot = {
                    ...(candidate.permission_snapshot || {}),
                    personal_kg_review: {
                        decision: item.decision,
                        decided_by: actorPersonId,
                        decided_at: new Date().toISOString(),
                        reason: item.audit_reason,
                        projection_allowed: item.next.projection_allowed
                    }
                };
                await client.query(
                    `UPDATE memory_candidates
                     SET sensitivity = $1,
                         redaction_status = $2,
                         agency_level = $3,
                         permission_snapshot = $4::jsonb,
                         updated_at = NOW()
                     WHERE id = $5`,
                    [item.next.sensitivity, item.next.redaction_status, item.next.agency_level, JSON.stringify(nextSnapshot), item.id]
                );
                applied.push(item.id);
            }
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
    } finally {
        await pool.end().catch(() => {});
    }
    return { applied_count: applied.length, applied_ids: applied };
}

function buildOutput({ candidates, args, decisionRecords = null, applyResult = null }) {
    const identity = personalKgIdentity(args);
    const reviewQueue = buildReviewQueue(candidates, args);
    const projectionPlan = args.projectionPlan ? buildSnsProjectionPlan(candidates, args) : null;
    const decisionPlan = decisionRecords ? buildDecisionPlan(candidates, decisionRecords, args) : null;
    return {
        mode: 'personal_kg_review_projection',
        source_system: args.sourceSystem,
        owner_person_id: identity.owner_person_id,
        write: args.write,
        summary: {
            input_candidates: candidates.filter((candidate) => isScopedCandidate(candidate, args)).length,
            review_candidates: reviewQueue.length,
            projection_eligible: projectionPlan?.summary.eligible || 0,
            projection_blocked: projectionPlan?.summary.blocked || 0,
            already_sns_ready: projectionPlan?.summary.already_sns_ready || 0,
            decision_ready: decisionPlan?.summary.ready || 0,
            decision_blocked: decisionPlan?.summary.blocked || 0
        },
        review_queue: reviewQueue,
        projection_plan: projectionPlan,
        decision_plan: decisionPlan,
        apply_result: applyResult
    };
}

function outputText(output) {
    const lines = [
        `${output.source_system} personal KG review projection`,
        `owner_person_id: ${output.owner_person_id}`,
        `input_candidates: ${output.summary.input_candidates}`,
        `review_candidates: ${output.summary.review_candidates}`,
        `projection_eligible: ${output.summary.projection_eligible}`,
        `projection_blocked: ${output.summary.projection_blocked}`,
        `already_sns_ready: ${output.summary.already_sns_ready}`,
        `decision_ready: ${output.summary.decision_ready}`,
        `decision_blocked: ${output.summary.decision_blocked}`
    ];
    for (const item of output.review_queue) {
        lines.push(`${item.id}\t${item.memory_layer}\t${item.promotion_status}\t${item.redaction_status}\t${item.agency_level}\t${item.source_ref}\t${item.review_reasons.join(',')}`);
    }
    return lines.join('\n');
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const identity = personalKgIdentity({
        ...args,
        owner_person_id: args.ownerPersonId,
        actor_person_id: args.actorPersonId,
        organization_id: args.organizationId,
        delegation_id: args.delegationId
    });
    const scopedArgs = {
        ...args,
        ownerPersonId: identity.owner_person_id,
        actorPersonId: identity.actor_person_id,
        organizationId: identity.organization_id,
        delegationId: identity.delegation_id || args.delegationId || null,
        org_ids: identity.org_ids
    };
    const candidates = args.inputJson
        ? readJsonFile(args.inputJson)
        : await loadCandidatesFromDatabase({
            connectionString: databaseConfig()?.connectionString,
            ownerPersonId: identity.owner_person_id,
            organizationId: identity.organization_id,
            sourceSystem: args.sourceSystem
        });
    const decisionRecords = args.decisionFile ? readJsonFile(args.decisionFile) : null;
    let applyResult = null;
    const dryRunOutput = buildOutput({ candidates, args: { ...scopedArgs, write: false }, decisionRecords });
    if (args.write) {
        if (!decisionRecords) throw new Error('--write requires --decision-file');
        if (dryRunOutput.decision_plan?.summary.blocked > 0) throw new Error('decision plan has blocked items; rerun without --write');
        applyResult = await applyDecisionPlan({
            connectionString: databaseConfig()?.connectionString,
            plan: dryRunOutput.decision_plan,
            candidates,
            actorPersonId: identity.actor_person_id
        });
    }
    const output = args.write
        ? { ...dryRunOutput, write: true, apply_result: applyResult }
        : dryRunOutput;
    console.log(args.json ? JSON.stringify(output, null, 2) : outputText(output));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

export {
    buildDecisionPlan,
    buildOutput,
    buildReviewQueue,
    buildSnsProjectionPlan,
    candidateReviewReasons,
    candidateSourceRef,
    isScopedCandidate,
    isPolicyCandidate,
    parseArgs,
    projectionBlockers,
    safeCandidateSummary,
    statusTransitionsFor
};
