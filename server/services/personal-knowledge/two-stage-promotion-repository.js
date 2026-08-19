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
             decided_at = $4
         WHERE request_id = $1
           AND status = 'pending_owner_approval'
         RETURNING *`,
        [requestId, decision.status, actorPersonId(options), decision.decided_at]
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
             decided_at = $4
         WHERE request_id = $1
           AND status = 'pending_org_review'
         RETURNING *`,
        [
            requestId,
            decision.status,
            actorPersonId(options),
            decision.reviewed_at,
            decision.reason || null,
            decision.organization_event_id || null
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
                owner_decided_by, owner_decided_at, created_at
         FROM knowledge_promotion_requests
         WHERE status = 'pending_org_review'
         ORDER BY created_at ASC, request_id ASC
         LIMIT $1`,
        [limit]
    );
    return rows;
}