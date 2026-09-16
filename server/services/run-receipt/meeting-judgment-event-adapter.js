// @ts-check

import { createHash } from 'node:crypto';

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function digest(value) {
    return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function firstEvidenceUri(evidenceRefs = []) {
    const first = Array.isArray(evidenceRefs) ? evidenceRefs[0] : null;
    if (!first) return null;
    if (first.kind === 'url') return first.ref;
    return `brainbase-evidence://${encodeURIComponent(first.ref)}`;
}

function accessFromActor(actor = {}) {
    const personId = actor.person_id || actor.personId || null;
    const projectCodes = Array.isArray(actor.projectCodes) ? actor.projectCodes : [];
    const role = actor.role || null;
    const organizationId = actor.organizationId || actor.organization_id || null;
    const tenantId = actor.tenantId || actor.tenant_id || null;
    return {
        ...(personId ? { personId } : {}),
        projectCodes,
        ...(role ? { role } : {}),
        ...(organizationId ? { organizationId } : {}),
        ...(tenantId ? { tenantId } : {})
    };
}

function traceCoverage(trace) {
    const statuses = Array.isArray(trace.nodes) ? trace.nodes.map((node) => node.status) : [];
    const hasNodeEvidence = statuses.some((_, index) => trace.nodes[index]?.evidence_refs?.length > 0);
    const hasTraceEvidence = Boolean(
        trace.quality?.evidence_refs?.length
        || trace.replay?.evidence_refs?.length
        || hasNodeEvidence
    );
    if (trace.glossary?.coverage === 'confirmed'
        && trace.quality?.status === 'confirmed'
        && statuses.length > 0
        && statuses.every((status) => status !== 'unknown')
        && hasTraceEvidence) return 'confirmed';
    if (hasTraceEvidence || statuses.some((status) => status !== 'unknown')) return 'partial';
    return 'unknown';
}

function sourcePointer({ runId, evidenceRefs }) {
    return {
        uri: firstEvidenceUri(evidenceRefs) || `brainbase-run-receipt://${encodeURIComponent(runId)}`,
        type: 'mana_run_receipt',
        run_id: runId,
        evidence_refs: evidenceRefs
    };
}

function observationEvent({ normalized, persistedRunId, trace, now }) {
    const externalRunId = normalized.run.external_run_id;
    const sourceIdentity = `${normalized.run.project_id}:${externalRunId}`;
    const eventId = `kev_meeting_judgment_${digest({
        project_id: normalized.run.project_id,
        source_type: normalized.source.type,
        external_run_id: externalRunId,
        trace
    }).slice(0, 32)}`;
    const evidenceRefs = normalized.run.evidence_refs || [];
    const occurredAt = normalized.run.finished_at || normalized.run.started_at || now();
    const applicabilityScope = {
        project_code: normalized.run.project_id,
        scope: 'meeting_judgment_learning',
        ...(normalized.run.org_id ? { organization_id: normalized.run.org_id } : {})
    };
    return {
        schema_version: 'knowledge_event.v1',
        event_id: eventId,
        occurred_at: occurredAt,
        captured_at: now(),
        source: {
            type: 'mana_meeting_judgment',
            workflow_id: normalized.source.workflow_id,
            external_run_id: externalRunId,
            source_identity: sourceIdentity,
            dag_id: trace.dag.id,
            dag_version: trace.dag.version
        },
        subject: {
            type: 'meeting_judgment_execution',
            id: externalRunId
        },
        decision_authority: {
            authorized: false,
            reason: 'observation_only',
            domain: 'meeting_judgment_learning'
        },
        applicability_scope: applicabilityScope,
        permission_snapshot: {
            visibility: 'internal',
            sensitivity: 'internal'
        },
        source_pointer: sourcePointer({ runId: persistedRunId, evidenceRefs }),
        body_hash: digest({ external_run_id: externalRunId, trace }),
        parent_episode_id: `meeting_judgment:${normalized.run.project_id}:${externalRunId}`,
        payload: {
            summary: 'Mana meeting judgment execution trace',
            judgment_trace: trace
        },
        ...(normalized.run.org_id ? { organization_id: normalized.run.org_id } : {})
    };
}

function replacementEvent({ normalized, correction, currentEvent, persistedRunId, now }) {
    const replacement = correction.replacement;
    const evidenceRefs = replacement?.evidence_refs?.length
        ? replacement.evidence_refs
        : correction.evidence_refs?.length
            ? correction.evidence_refs
            : normalized.run.evidence_refs || [];
    if (evidenceRefs.length === 0) return null;
    const eventId = replacement?.event_id
        || `kev_meeting_correction_${digest({
            project_id: normalized.run.project_id,
            corrects_event_id: correction.corrects_event_id,
            feedback_id: correction.feedback_id || null,
            replacement: replacement || null
        }).slice(0, 32)}`;
    const subjectType = replacement?.subject_type || currentEvent?.subject?.type || 'meeting_judgment_correction';
    const subjectId = replacement?.subject_id || currentEvent?.subject?.id || correction.corrects_event_id;
    const summary = replacement?.summary || correction.reason || 'Mana meeting judgment correction';
    const occurredAt = normalized.run.finished_at || normalized.run.started_at || now();
    const applicabilityScope = {
        project_code: normalized.run.project_id,
        scope: 'meeting_judgment_learning',
        ...(normalized.run.org_id ? { organization_id: normalized.run.org_id } : {})
    };
    return {
        schema_version: 'knowledge_event.v1',
        event_id: eventId,
        occurred_at: occurredAt,
        captured_at: now(),
        source: {
            type: 'mana_meeting_judgment_correction',
            workflow_id: normalized.source.workflow_id,
            external_run_id: normalized.run.external_run_id,
            run_id: persistedRunId
        },
        subject: { type: subjectType, id: subjectId },
        decision_authority: {
            authorized: false,
            reason: 'feedback_observation',
            domain: 'meeting_judgment_learning'
        },
        applicability_scope: applicabilityScope,
        permission_snapshot: {
            visibility: 'internal',
            sensitivity: 'internal'
        },
        source_pointer: sourcePointer({ runId: persistedRunId, evidenceRefs }),
        body_hash: digest({
            corrects_event_id: correction.corrects_event_id,
            event_id: eventId,
            summary,
            evidence_refs: evidenceRefs
        }),
        parent_episode_id: `meeting_judgment:${normalized.run.project_id}:${normalized.run.external_run_id}`,
        corrects_event_id: correction.corrects_event_id,
        payload: { summary },
        ...(normalized.run.org_id ? { organization_id: normalized.run.org_id } : {})
    };
}

function correctionFeedbackId(normalized, correction) {
    return correction.feedback_id || `kfb_meeting_${digest({
        project_id: normalized.run.project_id,
        external_run_id: normalized.run.external_run_id,
        corrects_event_id: correction.corrects_event_id,
        action: correction.action,
        reason: correction.reason || null,
        replacement: correction.replacement || null
    }).slice(0, 32)}`;
}

function failure(error, extra = {}) {
    return {
        status: 'unresolved',
        error_code: typeof error?.code === 'string' ? error.code : 'meeting_judgment_learning_link_failed',
        ...extra
    };
}

/**
 * Adapts the existing authenticated Mana Run Receipt into Brainbase's existing
 * knowledge-event and feedback paths. It intentionally stores bounded trace
 * metadata only; transcript/body content stays in Mana's execution system.
 */
export class MeetingJudgmentEventAdapter {
    constructor({ knowledgeEventService, knowledgeFeedbackService = null, now = () => new Date().toISOString() }) {
        this.knowledgeEventService = knowledgeEventService;
        this.knowledgeFeedbackService = knowledgeFeedbackService;
        this.now = now;
    }

    async ingest({ normalized, result, actor = {} } = {}) {
        if (normalized?.source?.type !== 'mana') {
            return { status: 'skipped', coverage: 'unknown', reason: 'source_not_mana' };
        }
        const trace = normalized.run?.judgment_trace;
        const runId = result?.run?.id || normalized.run.external_run_id;
        if (!trace) {
            return {
                status: 'unknown',
                coverage: 'unknown',
                reason: 'judgment_trace_missing',
                run_id: runId
            };
        }
        if (typeof this.knowledgeEventService?.ingest !== 'function') {
            return failure(null, {
                coverage: traceCoverage(trace),
                reason: 'knowledge_event_service_unavailable',
                run_id: runId
            });
        }

        const access = accessFromActor(actor);
        const event = observationEvent({ normalized, persistedRunId: runId, trace, now: this.now });
        let eventResult;
        try {
            eventResult = await this.knowledgeEventService.ingest(event, { access });
        } catch (error) {
            return failure(error, {
                coverage: traceCoverage(trace),
                run_id: runId,
                observation_event_id: event.event_id
            });
        }

        const corrections = [];
        for (const correction of trace.corrections || []) {
            corrections.push(await this._ingestCorrection({
                normalized,
                correction,
                runId,
                access
            }));
        }
        const unresolved = corrections.filter((item) => item.status !== 'linked');
        return {
            status: unresolved.length ? 'partial' : 'linked',
            coverage: traceCoverage(trace),
            run_id: runId,
            observation_event_id: event.event_id,
            knowledge_event: eventResult,
            corrections,
            ...(unresolved.length ? { unresolved_count: unresolved.length } : {})
        };
    }

    async _ingestCorrection({ normalized, correction, runId, access }) {
        if (typeof this.knowledgeFeedbackService?.recordFeedback !== 'function') {
            return {
                status: 'unresolved',
                error_code: 'knowledge_feedback_service_unavailable',
                feedback_id: correctionFeedbackId(normalized, correction),
                corrects_event_id: correction.corrects_event_id,
                action: correction.action
            };
        }
        const feedbackId = correctionFeedbackId(normalized, correction);
        let currentEvent = null;
        if (typeof this.knowledgeEventService?.eventRepository?.findById === 'function') {
            try {
                currentEvent = await this.knowledgeEventService.eventRepository.findById(
                    correction.corrects_event_id,
                    { projectCode: normalized.run.project_id, access }
                );
            } catch {
                // The feedback service remains the authority for existence and access.
            }
        }
        const feedback = {
            feedback_id: feedbackId,
            event_id: correction.corrects_event_id,
            action: correction.action,
            ...(correction.reason ? { reason: correction.reason } : {})
        };
        if (correction.action === 'correct') {
            const replacement = replacementEvent({ normalized, correction, currentEvent, persistedRunId: runId, now: this.now });
            if (!replacement) {
                return {
                    status: 'unresolved',
                    error_code: 'correction_evidence_missing',
                    feedback_id: feedbackId,
                    corrects_event_id: correction.corrects_event_id,
                    action: correction.action
                };
            }
            feedback.correction_event = replacement;
        }
        try {
            const feedbackResult = await this.knowledgeFeedbackService.recordFeedback(feedback, { access });
            return {
                status: 'linked',
                feedback_id: feedbackId,
                corrects_event_id: correction.corrects_event_id,
                action: correction.action,
                result: feedbackResult
            };
        } catch (error) {
            return failure(error, {
                feedback_id: feedbackId,
                corrects_event_id: correction.corrects_event_id,
                action: correction.action
            });
        }
    }
}

export { traceCoverage };
