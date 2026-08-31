// @ts-check

import { AppError } from '../../lib/errors.js';

const GRAPH_ENTITY_TYPES = [
    'project',
    'person',
    'org',
    'decision',
    'raci_assignment',
    'glossary_term',
    'kpi',
    'initiative'
];
const PLAYBOOK_NODES = [
    'source_intake',
    'project_resolution_gate',
    'project_scoped_graph_context',
    'mention_resolution',
    'glossary_resolution',
    'meeting_note_generation',
    'task_candidate_generation',
    'decision_candidate_generation',
    'graph_promotion_candidates',
    'human_review_package'
];
const PLAYBOOK_EDGES = [
    ['source_intake', 'project_resolution_gate'],
    ['project_resolution_gate', 'project_scoped_graph_context'],
    ['project_scoped_graph_context', 'mention_resolution'],
    ['project_scoped_graph_context', 'glossary_resolution'],
    ['mention_resolution', 'meeting_note_generation'],
    ['glossary_resolution', 'meeting_note_generation'],
    ['meeting_note_generation', 'task_candidate_generation'],
    ['meeting_note_generation', 'decision_candidate_generation'],
    ['decision_candidate_generation', 'graph_promotion_candidates'],
    ['task_candidate_generation', 'human_review_package'],
    ['graph_promotion_candidates', 'human_review_package']
];
const EXCEPTION_BRANCHES = {
    source_intake: [
        'missing_tactiq_or_plaud_transcript',
        'primary_mcp_source_missing',
        'source_artifact_hash_missing'
    ],
    project_resolution_gate: [
        'missing_project_candidate',
        'multiple_project_candidates',
        'project_access_denied'
    ],
    project_scoped_graph_context: ['graph_ssot_unavailable', 'empty_project_context'],
    glossary_resolution: ['empty_project_glossary', 'term_conflict_requires_human_review'],
    meeting_note_generation: ['source_fact_not_in_transcript', 'graph_context_used_as_fact_source'],
    human_review_package: [
        'task_create_requires_human_approval',
        'decision_promotion_requires_human_approval',
        'graph_write_requires_human_approval',
        'external_send_requires_human_approval'
    ]
};
const SOURCE_ROUTING_POLICY = Object.freeze({
    online: 'tactiq',
    offline: 'plaud',
    online_tactiq_unavailable: 'plaud',
    slack: 'pointer_or_fallback_only'
});

function jsonClone(value) {
    if (value === undefined) return null;
    return JSON.parse(JSON.stringify(value));
}

function readOptionalString(input, snakeKey, camelKey = snakeKey) {
    const value = input?.[snakeKey] ?? input?.[camelKey];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readFirstOptionalString(input, ...keys) {
    for (const key of keys) {
        const value = readOptionalString(input, key);
        if (value) return value;
    }
    return '';
}

function normalizeStringList(value) {
    if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
    if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
    return [];
}

function validationError(message, stateTransition, details = {}) {
    return AppError.validation(message, { state_transition: stateTransition, ...details });
}

function readReviewPackage(input = {}) {
    const candidate = input.review_package || input.reviewPackage || input.package || input;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        throw validationError('review_package must be a JSON object', 'blocked_invalid_review_package');
    }
    return jsonClone(candidate);
}

function projectResolutionEvidence({ input = {}, reviewPackage = {}, meetingIdentity = {} }) {
    return {
        explicit_input: {
            org_id: readOptionalString(input, 'org_id', 'orgId'),
            project_id: readOptionalString(input, 'project_id', 'projectId')
        },
        review_package_scope: {
            org_id: readOptionalString(reviewPackage, 'org_id', 'orgId'),
            project_id: readOptionalString(reviewPackage, 'project_id', 'projectId')
        },
        meeting_identity_candidate: {
            org_id: readOptionalString(meetingIdentity, 'candidate_org_id', 'candidateOrgId'),
            project_id: readOptionalString(meetingIdentity, 'candidate_project_id', 'candidateProjectId')
        }
    };
}

function projectCandidateIds(meetingIdentity = {}) {
    const candidates = [
        ...(Array.isArray(meetingIdentity.candidate_project_ids) ? meetingIdentity.candidate_project_ids : []),
        ...(Array.isArray(meetingIdentity.candidateProjectIds) ? meetingIdentity.candidateProjectIds : []),
        ...(Array.isArray(meetingIdentity.project_candidates) ? meetingIdentity.project_candidates : []),
        ...(Array.isArray(meetingIdentity.projectCandidates) ? meetingIdentity.projectCandidates : [])
    ];
    return Array.from(new Set(candidates.map((candidate) => {
        if (typeof candidate === 'string') return candidate.trim();
        if (!candidate || typeof candidate !== 'object') return '';
        return readOptionalString(candidate, 'project_id', 'projectId') || readOptionalString(candidate, 'id') || '';
    }).filter(Boolean)));
}

function resolvedProject({ input, reviewPackage, meetingIdentity, orgId, projectId, caseScope }) {
    const evidence = projectResolutionEvidence({ input, reviewPackage, meetingIdentity });
    const source = evidence.explicit_input.project_id
        ? 'explicit_input'
        : (evidence.review_package_scope.project_id ? 'review_package_scope' : 'meeting_identity_candidate');
    return {
        status: 'single_high_confidence_project',
        org_id: orgId,
        project_id: projectId,
        case_scope: caseScope || null,
        source,
        candidates: [{ org_id: orgId, project_id: projectId, confidence: 1, selected: true, source }],
        evidence
    };
}

function blockedProject({ input, reviewPackage, meetingIdentity, orgId, projectId, caseScope, code, message }) {
    const evidence = projectResolutionEvidence({ input, reviewPackage, meetingIdentity });
    return {
        status: code,
        org_id: orgId || null,
        project_id: projectId || null,
        case_scope: caseScope || null,
        source: 'pre_ingest_validation',
        candidates: projectCandidateIds(meetingIdentity).map((candidateProjectId) => ({
            org_id: orgId || evidence.meeting_identity_candidate.org_id || null,
            project_id: candidateProjectId,
            confidence: null,
            selected: false,
            source: 'meeting_identity_candidates'
        })),
        evidence,
        active_exception: { node: 'project_resolution_gate', code, message }
    };
}

function graphEntities(context = {}) {
    const entities = context?.entities;
    if (Array.isArray(entities)) return entities;
    if (!entities || typeof entities !== 'object') return [];
    return Object.values(entities).flatMap((records) => Array.isArray(records) ? records : []);
}

function graphTypeCounts(context = {}) {
    const entities = context?.entities;
    if (Array.isArray(entities)) {
        return entities.reduce((counts, record) => {
            const type = record?.entity_type || record?.type || record?.payload?.entity_type || 'unknown';
            counts[type] = (counts[type] || 0) + 1;
            return counts;
        }, {});
    }
    if (!entities || typeof entities !== 'object') return {};
    return Object.fromEntries(Object.entries(entities).map(([type, records]) => [type, Array.isArray(records) ? records.length : 0]));
}

function glossaryCount(context = {}) {
    const entities = context?.entities;
    if (Array.isArray(entities)) {
        return entities.filter((record) => record?.entity_type === 'glossary_term' || record?.type === 'glossary_term').length;
    }
    return Array.isArray(entities?.glossary_term) ? entities.glossary_term.length : 0;
}

function sourceArtifactRef(sourceEvent = {}) {
    return readFirstOptionalString(sourceEvent, 'transcript_id', 'transcriptId', 'note_id', 'noteId', 'recording_id', 'recordingId', 'document_id', 'documentId', 'mcp_resource_uri', 'mcpResourceUri', 'permalink', 'url', 'file_id', 'fileId');
}

function sourceContentHash(sourceEvent = {}) {
    return readFirstOptionalString(sourceEvent, 'local_artifact_sha256', 'localArtifactSha256', 'transcript_sha256', 'transcriptSha256', 'content_hash', 'contentHash');
}

function sourceStatus(sourceEvent = {}, evidenceRefs = []) {
    const sourceSystem = readFirstOptionalString(sourceEvent, 'source_system', 'sourceSystem', 'provider', 'source_provider', 'sourceProvider').toLowerCase();
    const meetingMode = readFirstOptionalString(sourceEvent, 'meeting_mode', 'meetingMode', 'mode').toLowerCase();
    const tactiqUnavailable = Boolean(sourceEvent.tactiq_unavailable || sourceEvent.tactiqUnavailable || sourceEvent.tactiq_not_available || sourceEvent.tactiqNotAvailable);
    const expectedPrimaryProvider = meetingMode === 'offline' || (meetingMode === 'online' && tactiqUnavailable)
        ? 'plaud'
        : (meetingMode === 'online' ? 'tactiq' : 'tactiq_or_plaud');
    const hasSlackAttachment = Boolean(sourceEvent.file_id || sourceEvent.fileId);
    const hasTranscriptHash = Boolean(sourceContentHash(sourceEvent));
    const hasEvidenceRefs = evidenceRefs.length > 0;
    const hasArtifactRef = Boolean(sourceArtifactRef(sourceEvent));
    const isTactiq = sourceSystem === 'tactiq';
    const isPlaud = sourceSystem === 'plaud';
    const isMcpSource = isTactiq || isPlaud;
    const providerMatches = expectedPrimaryProvider === 'tactiq_or_plaud' ? isMcpSource : sourceSystem === expectedPrimaryProvider;
    const hasProviderArtifact = isMcpSource && hasArtifactRef && (hasTranscriptHash || hasEvidenceRefs);
    const hasPrimaryMcpSource = hasProviderArtifact && providerMatches;
    const hasFallbackEvidence = hasSlackAttachment || hasTranscriptHash || hasEvidenceRefs;
    return {
        source_system: sourceSystem || null,
        meeting_mode: meetingMode || null,
        expected_primary_provider: expectedPrimaryProvider,
        primary_provider_policy: SOURCE_ROUTING_POLICY,
        has_mcp_transcript: isTactiq && hasArtifactRef,
        has_mcp_note: isPlaud && hasArtifactRef,
        has_provider_artifact: hasProviderArtifact,
        has_primary_mcp_source: hasPrimaryMcpSource,
        has_slack_attachment: hasSlackAttachment,
        slack_role: sourceSystem === 'slack' || hasSlackAttachment ? SOURCE_ROUTING_POLICY.slack : null,
        has_transcript_hash: hasTranscriptHash,
        has_message_ref: Boolean(sourceEvent.message_ts || sourceEvent.messageTs),
        has_evidence_refs: hasEvidenceRefs,
        status: hasPrimaryMcpSource ? 'primary_mcp_source_present' : (hasFallbackEvidence ? 'fallback_source_present' : 'source_evidence_missing')
    };
}

function buildGraphPlaybook({ orgId, projectId, caseScope, packageId, sourceEvent, evidenceRefs, projectResolution, graphContext = null, graphStatus, graphError = null }) {
    const intake = sourceStatus(sourceEvent, evidenceRefs);
    const entityCount = graphEntities(graphContext).length;
    const typeCounts = graphTypeCounts(graphContext);
    const termCount = glossaryCount(graphContext);
    const activeExceptions = [];
    if (intake.status === 'source_evidence_missing') activeExceptions.push({ node: 'source_intake', code: 'missing_tactiq_or_plaud_transcript' });
    else if (!intake.has_primary_mcp_source) activeExceptions.push({ node: 'source_intake', code: 'primary_mcp_source_missing' });
    if (!intake.has_transcript_hash) activeExceptions.push({ node: 'source_intake', code: 'source_artifact_hash_missing' });
    if (projectResolution?.active_exception?.node === 'project_resolution_gate') activeExceptions.push(jsonClone(projectResolution.active_exception));
    if (graphStatus === 'unavailable') activeExceptions.push({ node: 'project_scoped_graph_context', code: 'graph_ssot_unavailable', message: graphError || null });
    else if (graphStatus !== 'not_requested' && entityCount === 0) activeExceptions.push({ node: 'project_scoped_graph_context', code: 'empty_project_context' });
    if (graphStatus === 'resolved' && termCount === 0) activeExceptions.push({ node: 'glossary_resolution', code: 'empty_project_glossary' });
    const nodeStatus = (nodeId) => {
        if (activeExceptions.some((exception) => exception.node === nodeId)) return 'exception_recorded';
        if (nodeId === 'project_scoped_graph_context') return graphStatus === 'resolved' ? 'completed' : (graphStatus === 'not_requested' ? 'blocked' : 'fallback_recorded');
        if (nodeId === 'glossary_resolution') return graphStatus === 'not_requested' ? 'blocked' : (termCount > 0 ? 'completed' : 'fallback_recorded');
        return 'completed';
    };
    return {
        version: 'meeting_pack_graph_ssot_playbook.v1',
        package_id: packageId,
        org_id: orgId,
        project_id: projectId,
        case_scope: caseScope || null,
        dag: {
            nodes: PLAYBOOK_NODES.map((id) => ({ id, status: nodeStatus(id) })),
            edges: PLAYBOOK_EDGES.map(([from, to]) => ({ from, to }))
        },
        project_resolution: projectResolution,
        source_intake: intake,
        graph_context: {
            source: 'brainbase_graph_ssot',
            status: graphStatus,
            project_id: projectId,
            entity_types: GRAPH_ENTITY_TYPES,
            include_edges: true,
            entity_count: entityCount,
            type_counts: typeCounts,
            error: graphError || null
        },
        glossary_resolution: {
            status: graphStatus === 'resolved' ? (termCount > 0 ? 'resolved' : 'empty_project_glossary') : (graphStatus === 'not_requested' ? 'not_requested' : 'unavailable'),
            entity_count: termCount
        },
        generation_contract: {
            fact_source: 'tactiq_or_plaud_transcript_or_note',
            source_routing_policy: SOURCE_ROUTING_POLICY,
            graph_ssot_role: 'project_scoped_entity_identity_relationship_glossary_context',
            project_must_be_resolved_before_graph_lookup: true,
            graph_context_must_not_override_missing_transcript_facts: true,
            task_create_requires_human_gate: true,
            graph_write_requires_human_gate: true
        },
        exception_branches: jsonClone(EXCEPTION_BRANCHES),
        active_exceptions: activeExceptions
    };
}

function graphAccess(actor = {}, projectId = null) {
    const role = typeof actor.role === 'string' ? actor.role.toLowerCase() : '';
    const actorProjectCodes = Array.isArray(actor.projectCodes)
        ? actor.projectCodes.filter((code) => typeof code === 'string' && code.trim()).map((code) => code.trim())
        : [];
    return {
        role: ['member', 'gm', 'ceo'].includes(role) ? role : 'ceo',
        projectCodes: Array.from(new Set([
            ...actorProjectCodes,
            ...projectCodeLookupVariants(projectId)
        ].filter(Boolean))),
        clearance: Array.isArray(actor.clearance) && actor.clearance.length ? actor.clearance : ['internal'],
        personId: actor.person_id || actor.personId || actor.sub || null
    };
}

function projectCodeLookupVariants(projectId) {
    if (!projectId || typeof projectId !== 'string') return [];
    const trimmed = projectId.trim();
    if (!trimmed) return [];
    return Array.from(new Set([
        trimmed,
        trimmed.replace(/[-_]/g, ''),
        trimmed.replace(/_/g, '-'),
        trimmed.replace(/-/g, '_')
    ].filter(Boolean)));
}

function attachPlaybook(reviewPackage, graphPlaybook) {
    const cloned = jsonClone(reviewPackage);
    if (cloned.meeting_note_summary && typeof cloned.meeting_note_summary === 'object' && !Array.isArray(cloned.meeting_note_summary)) {
        cloned.meeting_note_summary = {
            ...cloned.meeting_note_summary,
            graph_ssot_playbook: jsonClone(graphPlaybook),
            project_resolution: jsonClone(graphPlaybook.project_resolution),
            graph_context_status: jsonClone(graphPlaybook.graph_context)
        };
    }
    return cloned;
}

function snapshotData({ meetingIdentity, graphContext, graphPlaybook }) {
    const candidate = meetingIdentity.graph_context && typeof meetingIdentity.graph_context === 'object' ? meetingIdentity.graph_context : {};
    const resolved = graphPlaybook.graph_context.status === 'resolved';
    return {
        ...jsonClone(candidate),
        verification_status: resolved ? 'verified_from_graph_ssot' : 'candidate_from_review_package',
        promoted_to_graph_ssot: false,
        graph_context_source: resolved ? 'brainbase_graph_ssot' : 'review_package_candidate',
        graph_ssot_context: graphContext ? jsonClone(graphContext) : null,
        graph_ssot_playbook: jsonClone(graphPlaybook)
    };
}

export class MeetingReviewContextResolver {
    constructor({ prepareProjectAccess, assertProjectSelectable, assertOrgReferenceAllowed, assertProjectAccess, infoSSOTService = null, verifyReviewPackage, resolveReviewTaskOwners = null }) {
        this.prepareProjectAccess = prepareProjectAccess;
        this.assertProjectSelectable = assertProjectSelectable;
        this.assertOrgReferenceAllowed = assertOrgReferenceAllowed;
        this.assertProjectAccess = assertProjectAccess;
        this.infoSSOTService = infoSSOTService;
        this.verifyReviewPackage = verifyReviewPackage;
        this.resolveReviewTaskOwners = resolveReviewTaskOwners;
    }

    _blockedScope({ input, reviewPackage, meetingIdentity, orgId, projectId, caseScope, packageId, sourceEvent, evidenceRefs, code, message, field }) {
        const projectResolution = blockedProject({ input, reviewPackage, meetingIdentity, orgId, projectId, caseScope, code, message });
        const graphPlaybook = buildGraphPlaybook({ orgId, projectId, caseScope, packageId, sourceEvent, evidenceRefs, projectResolution, graphStatus: 'not_requested', graphError: message });
        throw validationError(field === 'org_id' ? 'org_id is required' : (field === 'project_id' ? 'project_id is required' : message), 'blocked_invalid_scope', {
            field,
            ...(orgId ? { org_id: orgId } : {}),
            ...(projectId ? { project_id: projectId } : {}),
            project_resolution: projectResolution,
            graph_ssot_playbook: graphPlaybook
        });
    }

    async resolveScope(input = {}, actor = {}) {
        await this.prepareProjectAccess(actor);
        const reviewPackage = readReviewPackage(input);
        const packageId = readOptionalString(reviewPackage, 'package_id', 'packageId');
        const meetingIdentity = reviewPackage.meeting_identity && typeof reviewPackage.meeting_identity === 'object' ? reviewPackage.meeting_identity : {};
        const sourceEvent = reviewPackage.source_event && typeof reviewPackage.source_event === 'object' ? reviewPackage.source_event : {};
        const evidenceRefs = normalizeStringList(reviewPackage.evidence_refs || reviewPackage.evidenceRefs);
        const orgId = readOptionalString(input, 'org_id', 'orgId') || readOptionalString(reviewPackage, 'org_id', 'orgId') || readOptionalString(meetingIdentity, 'candidate_org_id', 'candidateOrgId');
        const projectId = readOptionalString(input, 'project_id', 'projectId') || readOptionalString(reviewPackage, 'project_id', 'projectId') || readOptionalString(meetingIdentity, 'candidate_project_id', 'candidateProjectId');
        const caseScope = readOptionalString(input, 'case_scope', 'caseScope') || readOptionalString(reviewPackage, 'case_scope', 'caseScope') || readOptionalString(meetingIdentity, 'case_scope', 'caseScope');
        if (!packageId) throw validationError('review_package.package_id is required', 'blocked_invalid_review_package', { missing_package_keys: ['package_id'] });
        if (!orgId) this._blockedScope({ input, reviewPackage, meetingIdentity, orgId, projectId, caseScope, packageId, sourceEvent, evidenceRefs, code: 'missing_project_candidate', message: 'org_id is required before project scoped Graph SSOT lookup', field: 'org_id' });
        if (!projectId) {
            const code = projectCandidateIds(meetingIdentity).length > 1 ? 'multiple_project_candidates' : 'missing_project_candidate';
            this._blockedScope({ input, reviewPackage, meetingIdentity, orgId, projectId, caseScope, packageId, sourceEvent, evidenceRefs, code, message: code === 'multiple_project_candidates' ? 'multiple project candidates require human project selection before Graph SSOT lookup' : 'project_id is required before project scoped Graph SSOT lookup', field: 'project_id' });
        }
        try {
            await this.assertProjectSelectable(projectId, actor);
            await this.assertOrgReferenceAllowed(orgId, actor);
            await this.assertProjectAccess(projectId, actor);
        } catch (error) {
            if (error?.statusCode !== 400) throw error;
            this._blockedScope({ input, reviewPackage, meetingIdentity, orgId, projectId, caseScope, packageId, sourceEvent, evidenceRefs, code: 'project_access_denied', message: error.message, field: 'project_id' });
        }

        const { loopIntents, loopIntentByKey } = this.verifyReviewPackage({ reviewPackage, orgId, projectId });
        const projectResolution = resolvedProject({ input, reviewPackage, meetingIdentity, orgId, projectId, caseScope });
        return {
            reviewPackage,
            packageId,
            meetingIdentity,
            sourceEvent,
            evidenceRefs,
            orgId,
            projectId,
            caseScope,
            projectResolution,
            loopIntents,
            loopIntentByKey
        };
    }

    async resolveGraph(scope, actor = {}) {
        const {
            reviewPackage,
            packageId,
            meetingIdentity,
            sourceEvent,
            evidenceRefs,
            orgId,
            projectId,
            caseScope,
            projectResolution
        } = scope;
        let graphContext = null;
        let graphStatus = 'unavailable';
        let graphError = null;
        if (this.infoSSOTService?.getContext) {
            try {
                graphContext = await this.infoSSOTService.getContext(graphAccess(actor, projectId), {
                    projectCode: projectId,
                    entityTypes: GRAPH_ENTITY_TYPES.join(','),
                    limit: 80,
                    humanReadable: false,
                    includeEdges: true,
                    includePhilosophy: false,
                    scope: caseScope || 'meeting_pack'
                });
                graphStatus = 'resolved';
            } catch (error) {
                graphError = error?.message || 'graph_ssot_context_lookup_failed';
            }
        } else {
            graphError = 'info_ssot_get_context_not_available';
        }
        const graphPlaybook = buildGraphPlaybook({ orgId, projectId, caseScope, packageId, sourceEvent, evidenceRefs, projectResolution, graphContext, graphStatus, graphError });
        const reviewPackageWithPlaybook = attachPlaybook(reviewPackage, graphPlaybook);
        const resolvedReviewPackage = this.resolveReviewTaskOwners
            ? await this.resolveReviewTaskOwners(reviewPackageWithPlaybook, { actor, projectId, graphContext })
            : reviewPackageWithPlaybook;
        return {
            ...scope,
            resolvedReviewPackage,
            graphPlaybookContext: {
                graph_context: graphContext,
                graph_playbook: graphPlaybook,
                snapshot_data: snapshotData({ meetingIdentity, graphContext, graphPlaybook }),
                item_count: graphStatus === 'resolved'
                    ? graphEntities(graphContext).length
                    : [...(meetingIdentity.graph_context?.org_entity_ids || []), ...(meetingIdentity.graph_context?.person_entity_ids || [])].length
            }
        };
    }

    async resolve(input = {}, actor = {}) {
        const scope = await this.resolveScope(input, actor);
        return this.resolveGraph(scope, actor);
    }
}
