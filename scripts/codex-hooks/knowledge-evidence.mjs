// The model judges relevance; the Host checks that its assessment refers to
// actual, successful retrievals in this episode, after the selected route.
export function normalizeRetrievalEvidence(value) {
    if (!value || !['retrieved', 'empty', 'unavailable', 'unknown'].includes(value.status)
        || !['complete', 'partial', 'unknown'].includes(value.coverage)
        || !['needs_model_verification', 'insufficient'].includes(value.sufficiency)
        || value.absence_confirmed !== false || !Array.isArray(value.references)
        || value.references.length > 100) return null;
    if (!value.references.every((ref) => ref && typeof ref.id === 'string' && ref.id.trim()
        && typeof ref.entity_type === 'string'
        && ['present', 'missing'].includes(ref.evidence_status)
        && Array.isArray(ref.evidence_fields)
        && ref.evidence_fields.every((field) => typeof field === 'string'))) return null;
    return {
        status: value.status, coverage: value.coverage, sufficiency: value.sufficiency,
        references: value.references.map(({ id, entity_type, evidence_status, evidence_fields }) => ({
            id, entity_type, evidence_status, evidence_fields
        })), absence_confirmed: false
    };
}

export function normalizeEvidenceAssessment(value) {
    if (value?.schema_version !== 'brainbase-knowledge-evidence-assessment-v1'
        || !['sufficient', 'insufficient'].includes(value.status)
        || typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 4000
        || !Array.isArray(value.reference_ids) || value.reference_ids.length > 100
        || !value.reference_ids.every((id) => typeof id === 'string' && id.trim())
        || new Set(value.reference_ids).size !== value.reference_ids.length
        || (value.status === 'sufficient' && value.reference_ids.length === 0)) return null;
    return { schema_version: value.schema_version, status: value.status,
        reference_ids: value.reference_ids, reason: value.reason };
}

export function evaluateKnowledgeEvidence(events, requiredKnowledge) {
    const routeIndex = events.findLastIndex((event) => event.event_kind === 'route' && event.success);
    const route = events[routeIndex];
    if (!requiredKnowledge || route?.safe_metadata?.source_class !== 'graph') {
        return { required: false, ready: true, status: 'not_evaluated' };
    }
    const later = events.slice(routeIndex + 1);
    const attempts = later.filter((event) => ['mcp__brainbase__search', 'mcp__brainbase__get_entity'].includes(event.tool_name));
    const assessmentIndex = later.findLastIndex((event) => event.event_kind === 'evidence' && event.success);
    const assessment = normalizeEvidenceAssessment(later[assessmentIndex]?.safe_metadata?.evidence_assessment);
    const incomplete = { required: true, ready: false, status: 'unverified' };
    if (!attempts.length || !assessment) return incomplete;
    // An assessment is stale after any further retrieval attempt, including a failure.
    if (later.slice(assessmentIndex + 1).some((event) => attempts.includes(event))) return incomplete;
    const references = new Map();
    for (const event of attempts) {
        const evidence = normalizeRetrievalEvidence(event.safe_metadata?.retrieval_evidence);
        if (!event.success || evidence?.status !== 'retrieved') continue;
        for (const ref of evidence.references) references.set(ref.id, ref);
    }
    if (!assessment.reference_ids.every((id) => references.has(id))) return incomplete;
    if (assessment.status === 'sufficient' && !assessment.reference_ids.every((id) => {
        const ref = references.get(id);
        return ref.evidence_status === 'present' && ref.evidence_fields.length > 0;
    })) return incomplete;
    return { required: true, ready: true,
        status: assessment.status === 'sufficient' ? 'model_assessed_with_retrieval' : 'insufficient',
        reference_ids: assessment.reference_ids, absence_confirmed: false };
}
