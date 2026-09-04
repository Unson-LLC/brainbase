function requireClient(options) {
    if (!options?.client?.query) throw new Error('personal_knowledge_transaction_required');
    return options.client;
}

function actorPersonId(options) {
    return options?.access?.actorPersonId || options?.access?.personId || null;
}

export async function decideOwnerPromotionRequest(repository, requestId, decision, options = {}) {
    if (typeof repository.decideOwnerPromotionRequest === 'function') {
        return repository.decideOwnerPromotionRequest(requestId, decision, options);
    }
    const client = requireClient(options);
    const { rows } = await client.query(
        `UPDATE knowledge_promotion_requests
         SET status = $2,
             owner_decided_by = $3,
             owner_decided_at = $4,
             owner_consent_receipt_id = $5,
             decided_at = $4,
             owner_decision_revision = owner_decision_revision + 1
         WHERE request_id = $1
           AND status = 'pending_owner_approval'
           AND owner_decision_revision = $6
         RETURNING *`,
        [requestId, decision.status, actorPersonId(options), decision.decided_at,
            decision.owner_consent_receipt_id || null, decision.expected_owner_decision_revision]
    );
    return rows[0] || null;
}

export async function saveNormalizedPromotionPayload(repository, requestId, normalization, options = {}) {
    if (typeof repository.saveNormalizedPromotionPayload === 'function') {
        return repository.saveNormalizedPromotionPayload(requestId, normalization, options);
    }
    const client = requireClient(options);
    const { rows } = await client.query(
        `UPDATE knowledge_promotion_requests
         SET normalized_payload = $2::jsonb,
             normalized_payload_hash = $3,
             normalized_by_person_id = $4,
             normalized_at = $5,
             owner_consent_receipt_id = $6,
             normalization_contract_version = $7
         WHERE request_id = $1
           AND status = 'pending_org_review'
         RETURNING *`,
        [
            requestId,
            JSON.stringify(normalization.normalized_payload),
            normalization.normalized_payload_hash,
            actorPersonId(options),
            normalization.normalized_at,
            normalization.owner_consent_receipt_id,
            normalization.contract_version
        ]
    );
    return rows[0] || null;
}

export async function reviewOrganizationPromotionRequest(repository, requestId, decision, options = {}) {
    if (typeof repository.reviewOrganizationPromotionRequest === 'function') {
        return repository.reviewOrganizationPromotionRequest(requestId, decision, options);
    }
    const client = requireClient(options);
    const { rows } = await client.query(
        `UPDATE knowledge_promotion_requests
         SET status = $2,
             organization_reviewed_by = $3,
             organization_reviewed_at = $4,
             organization_review_reason = $5,
             organization_event_id = COALESCE($6, organization_event_id),
             graph_entity_id = COALESCE($7, graph_entity_id),
             organization_review_receipt_id = COALESCE($8, organization_review_receipt_id),
             decided_at = $4,
             organization_review_revision = organization_review_revision + 1
         WHERE request_id = $1
           AND status = 'pending_org_review'
           AND organization_review_revision = $9
         RETURNING *`,
        [
            requestId,
            decision.status,
            actorPersonId(options),
            decision.reviewed_at,
            decision.reason || null,
            decision.organization_event_id || null,
            decision.graph_entity_id || null,
            decision.organization_review_receipt_id || null,
            decision.expected_organization_review_revision
        ]
    );
    return rows[0] || null;
}

export async function listOrganizationPromotionReviews(repository, input = {}, options = {}) {
    if (typeof repository.listOrganizationPromotionReviews === 'function') {
        return repository.listOrganizationPromotionReviews(input, options);
    }
    const client = requireClient(options);
    const limit = Math.max(1, Math.min(Number(input.limit || 50), 100));
    const { rows } = await client.query(
        `SELECT request_id, personal_event_id, owner_person_id, organization_id,
                project_code, status, sanitized_preview, subject, body_hash,
                owner_decided_by, owner_decided_at, owner_consent_receipt_id,
                owner_decision_revision, organization_review_revision,
                normalized_payload, normalized_payload_hash, normalized_by_person_id,
                normalized_at, normalization_contract_version, created_at
         FROM knowledge_promotion_requests
         WHERE status = 'pending_org_review'
         ORDER BY created_at ASC, request_id ASC
         LIMIT $1`,
        [limit]
    );
    return rows;
}
