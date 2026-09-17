import { createHash, randomUUID } from 'node:crypto';

import { normalizeRepositoryRelativePath } from './canonical-document-writer-adapter.js';

export class KnowledgeAuthoringError extends Error {
    constructor(code, message, status = 400, details = {}) {
        super(message);
        this.name = 'KnowledgeAuthoringError';
        this.code = code;
        this.status = status;
        this.details = details;
    }
}

function requiredText(value, field) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new KnowledgeAuthoringError('knowledge_authoring_input_invalid', `${field} is required`, 400, { field });
    }
    return value.trim();
}

function draftText(value, field) {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string') {
        throw new KnowledgeAuthoringError('knowledge_authoring_input_invalid', `${field} must be text`, 400, { field });
    }
    return value;
}

function requireProjectAccess(access, projectCode) {
    if (!Array.isArray(access?.projectCodes) || !access.projectCodes.includes(projectCode)) {
        throw new KnowledgeAuthoringError('knowledge_project_not_accessible', 'project is not accessible', 403);
    }
    if (!access?.personId || !(access.organizationId || access.tenantId)) {
        throw new KnowledgeAuthoringError('knowledge_authoring_principal_required', 'authenticated person and organization are required', 403);
    }
}

function revision(value) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) {
        throw new KnowledgeAuthoringError('knowledge_revision_required', 'a positive revision is required', 400);
    }
    return number;
}

function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

function optionalTimestamp(value, field) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
        throw new KnowledgeAuthoringError('knowledge_authoring_input_invalid', `${field} must be an ISO timestamp or null`, 400, { field });
    }
    return new Date(value).toISOString();
}

function rejectUnsupportedDraftFields(input = {}) {
    if (input.owner_candidate !== undefined) {
        throw new KnowledgeAuthoringError(
            'knowledge_owner_confirmation_required',
            'owner_candidate is a proposal and cannot be persisted as the canonical owner',
            400,
            { fields: ['owner_candidate'] }
        );
    }
    if (input.canonical_id !== undefined || input.reuse_canonical_id !== undefined) {
        throw new KnowledgeAuthoringError(
            'knowledge_canonical_reuse_explicit_required',
            'existing canonical ids must use the explicit reuse flow',
            400,
            { fields: ['canonical_id'] }
        );
    }
}

function graphPointerText(value, field) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new KnowledgeAuthoringError(
            'knowledge_document_graph_pointer_required',
            `${field} must come from the resolved owning repository Graph pointer`,
            503,
            { field }
        );
    }
    return value.trim();
}

function assertDocumentGraphPointer(resolution, projectCode, access, requestedPath) {
    if (!resolution || resolution.status !== 'resolved'
        || resolution.source_class !== 'owning_repo'
        || resolution.content_type !== 'team_document'
        || resolution.project_code !== projectCode) {
        throw new KnowledgeAuthoringError(
            'knowledge_document_graph_pointer_required',
            'document save requires a resolved owning repository Graph pointer',
            503
        );
    }
    const location = resolution.canonical_location;
    if (!location || location.repository !== `project:${projectCode}`) {
        throw new KnowledgeAuthoringError(
            'knowledge_document_graph_pointer_required',
            'document Graph pointer must identify the current project repository',
            503,
            { field: 'canonical_location.repository' }
        );
    }
    const branch = graphPointerText(location.branch, 'canonical_location.branch');
    const owner = graphPointerText(location.owner || location.github_owner || location.github?.owner, 'canonical_location.owner');
    const repo = graphPointerText(location.repo || location.github_repo || location.github?.repo, 'canonical_location.repo');
    const tenantId = graphPointerText(location.tenant_id || location.organization_id, 'canonical_location.tenant_id');
    const pointerPath = graphPointerText(location.path || location.path_prefix || location.path_scope, 'canonical_location.path');
    const tenant = access?.organizationId || access?.tenantId;
    if (!tenant || tenant !== tenantId) {
        throw new KnowledgeAuthoringError(
            'knowledge_document_tenant_mismatch',
            'document Graph pointer tenant does not match the authenticated organization',
            403
        );
    }
    let documentPath;
    try {
        documentPath = normalizeRepositoryRelativePath(requestedPath);
    } catch {
        throw new KnowledgeAuthoringError('knowledge_document_input_invalid', 'path is required and must be repository-relative', 400, { field: 'path' });
    }
    let scope;
    try {
        scope = normalizeRepositoryRelativePath(pointerPath.replace(/\/+$/u, ''));
    } catch {
        throw new KnowledgeAuthoringError(
            'knowledge_document_graph_pointer_required',
            'canonical_location.path must be a repository-relative Graph pointer scope',
            503,
            { field: 'canonical_location.path' }
        );
    }
    if (!scope || (documentPath !== scope && !documentPath.startsWith(`${scope}/`))) {
        throw new KnowledgeAuthoringError(
            'knowledge_document_graph_pointer_mismatch',
            'document path is outside the resolved Graph repository scope',
            422,
            { path: documentPath, path_scope: `${scope}/` }
        );
    }
    return { resolution, branch, owner, repo, tenant_id: tenantId, path_scope: scope, path: documentPath };
}

function normalizeOwner(value, field = 'owner_person_id') {
    if (value === undefined || value === null || value === '') return undefined;
    return requiredText(value, field);
}

function normalizeRelations(value) {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) {
        throw new KnowledgeAuthoringError('knowledge_relations_invalid', 'relations must be an array', 400);
    }
    return value.map((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new KnowledgeAuthoringError('knowledge_relations_invalid', `relations[${index}] must be an object`, 400, { index });
        }
        const relation = requiredText(entry.relation || entry.rel_type, `relations[${index}].relation`);
        const toId = requiredText(entry.to_id || entry.target_id, `relations[${index}].to_id`);
        const fromId = normalizeOwner(entry.from_id || entry.source_id, `relations[${index}].from_id`);
        return {
            ...entry,
            relation,
            to_id: toId,
            ...(fromId ? { from_id: fromId } : {})
        };
    });
}

function draftProjection(record) {
    return {
        draft_id: record.draft_id,
        project_code: record.project_code,
        kind: record.kind,
        title: record.title,
        summary: record.summary || '',
        content: record.content,
        applicability: record.applicability || {},
        source_pointer: record.source_pointer || null,
        owner_person_id: record.canonical_owner_person_id || record.owner_person_id || null,
        relations: Array.isArray(record.relations) ? record.relations : [],
        revision: Number(record.revision),
        status: record.status,
        save_idempotency_key: record.save_idempotency_key || null,
        save_decision_domain: record.save_decision_domain || null,
        canonical_id: record.canonical_id || null,
        saved_event_id: record.saved_event_id || null,
        created_at: record.created_at || null,
        updated_at: record.updated_at || null
    };
}

export class KnowledgeAuthoringService {
    constructor({
        repository,
        knowledgeEventService,
        catalogService,
        graphRepository,
        documentWriter = null,
        documentReceiptRepository = null,
        documentGraphPointerResolver = null,
        now = () => new Date().toISOString(),
        id = randomUUID
    }) {
        this.repository = repository;
        this.knowledgeEventService = knowledgeEventService;
        this.catalogService = catalogService;
        this.graphRepository = graphRepository;
        this.documentWriter = documentWriter;
        this.documentReceiptRepository = documentReceiptRepository;
        this.documentGraphPointerResolver = documentGraphPointerResolver;
        this.now = now;
        this.id = id;
    }

    async _validateAuthoringContext(access, {
        projectCode, kind, ownerPersonId, relations = [], decisionDomain, entityId = null
    }) {
        const validator = this.graphRepository?.validateAuthoringContext
            || this.graphRepository?.validateAuthoring;
        if (typeof validator !== 'function') {
            if (ownerPersonId !== access.personId || relations.length) {
                throw new KnowledgeAuthoringError(
                    'knowledge_authoring_graph_unavailable',
                    'Graph validation is required before registering an owner or relation',
                    503
                );
            }
            return { owner_person_id: ownerPersonId, relations };
        }
        try {
            return await validator.call(this.graphRepository, {
                project_code: projectCode,
                entity_type: kind === 'decision' ? 'decision' : kind,
                entity_id: entityId,
                owner_person_id: ownerPersonId,
                relations,
                decision_domain: decisionDomain
            }, { access });
        } catch (error) {
            if (error instanceof KnowledgeAuthoringError) throw error;
            if (typeof error?.code === 'string' && error.code.startsWith('knowledge_')) {
                throw new KnowledgeAuthoringError(error.code, error.message, error.status || 400, error.details || {});
            }
            throw error;
        }
    }

    async _persistAuthoringGraph(access, {
        projectCode, kind, entityId, ownerPersonId, relations = [], decisionDomain, expectedVersion = null
    }) {
        const writer = this.graphRepository?.persistAuthoringRelations
            || this.graphRepository?.persistAuthoringGraph;
        if (typeof writer !== 'function') {
            if (ownerPersonId !== access.personId || relations.length) {
                throw new KnowledgeAuthoringError(
                    'knowledge_authoring_graph_unavailable',
                    'Graph relation persistence is required for this authoring request',
                    503
                );
            }
            return { relation_count: 0, graph_saved: true };
        }
        try {
            return await writer.call(this.graphRepository, {
                project_code: projectCode,
                entity_type: kind === 'decision' ? 'decision' : kind,
                entity_id: entityId,
                owner_person_id: ownerPersonId,
                relations,
                decision_domain: decisionDomain,
                ...(expectedVersion === null ? {} : { expected_version: expectedVersion })
            }, { access });
        } catch (error) {
            if (error instanceof KnowledgeAuthoringError) throw error;
            if (typeof error?.code === 'string' && error.code.startsWith('knowledge_')) {
                throw new KnowledgeAuthoringError(error.code, error.message, error.status || 400, error.details || {});
            }
            throw error;
        }
    }

    async createDraft(access, input = {}) {
        const projectCode = requiredText(input.project_code, 'project_code');
        requireProjectAccess(access, projectCode);
        rejectUnsupportedDraftFields(input);
        const kind = input.kind === undefined ? 'decision' : input.kind;
        if (!['decision', 'document'].includes(kind)) {
            throw new KnowledgeAuthoringError('knowledge_draft_kind_unsupported', 'kind must be decision or document', 400);
        }
        const ownerPersonId = normalizeOwner(input.owner_person_id || input.owner_id) || access.personId;
        const relations = normalizeRelations(input.relations) || [];
        await this._validateAuthoringContext(access, {
            projectCode, kind, ownerPersonId, relations, decisionDomain: input.decision_domain
        });
        const record = await this.repository.createDraft({
            draft_id: `kd_${this.id()}`,
            organization_id: access.organizationId || access.tenantId,
            owner_person_id: access.personId,
            canonical_owner_person_id: ownerPersonId,
            project_code: projectCode,
            kind,
            title: draftText(input.title, 'title'),
            summary: draftText(input.summary, 'summary'),
            content: draftText(input.content, 'content'),
            applicability: input.applicability && typeof input.applicability === 'object' ? input.applicability : {},
            source_pointer: input.source_pointer && typeof input.source_pointer === 'object' ? input.source_pointer : null,
            relations,
            revision: 1,
            status: 'draft'
        }, { access });
        return draftProjection(record);
    }

    async getDraft(access, input = {}) {
        const projectCode = requiredText(input.project_code, 'project_code');
        requireProjectAccess(access, projectCode);
        const record = await this.repository.getDraft(requiredText(input.draft_id, 'draft_id'), { access, projectCode });
        if (!record) throw new KnowledgeAuthoringError('knowledge_draft_not_found', 'draft was not found', 404);
        return draftProjection(record);
    }

    async updateDraft(access, input = {}) {
        rejectUnsupportedDraftFields(input);
        const current = await this.getDraft(access, input);
        if (current.status !== 'draft') {
            throw new KnowledgeAuthoringError('knowledge_draft_not_editable', 'only active drafts can be edited', 409);
        }
        const expectedRevision = revision(input.revision);
        const ownerPersonId = normalizeOwner(input.owner_person_id || input.owner_id) || current.owner_person_id;
        const relations = input.relations === undefined ? current.relations : normalizeRelations(input.relations);
        await this._validateAuthoringContext(access, {
            projectCode: current.project_code,
            kind: current.kind,
            ownerPersonId,
            relations,
            decisionDomain: input.decision_domain,
            entityId: current.canonical_id
        });
        const updated = await this.repository.updateDraft(current.draft_id, {
            expected_revision: expectedRevision,
            title: input.title === undefined ? current.title : draftText(input.title, 'title'),
            summary: input.summary === undefined ? current.summary : draftText(input.summary, 'summary'),
            content: input.content === undefined ? current.content : draftText(input.content, 'content'),
            applicability: input.applicability === undefined ? current.applicability : input.applicability,
            source_pointer: input.source_pointer === undefined ? current.source_pointer : input.source_pointer,
            canonical_owner_person_id: ownerPersonId,
            relations
        }, { access, projectCode: current.project_code });
        if (!updated) throw new KnowledgeAuthoringError('knowledge_draft_revision_conflict', 'draft revision changed', 409);
        return draftProjection(updated);
    }

    async discardDraft(access, input = {}) {
        const current = await this.getDraft(access, input);
        const discarded = await this.repository.transitionDraft(current.draft_id, {
            expected_revision: revision(input.revision), status: 'discarded'
        }, { access, projectCode: current.project_code });
        if (!discarded) throw new KnowledgeAuthoringError('knowledge_draft_revision_conflict', 'draft revision changed', 409);
        return draftProjection(discarded);
    }

    async _resolveDocumentGraphPointer(access, current, input) {
        const resolver = typeof this.documentGraphPointerResolver === 'function'
            ? this.documentGraphPointerResolver
            : this.documentGraphPointerResolver?.resolve;
        if (typeof resolver !== 'function') {
            throw new KnowledgeAuthoringError(
                'knowledge_document_graph_pointer_required',
                'document save requires an explicitly injected resolved owning repository Graph pointer',
                503
            );
        }

        let resolved;
        try {
            // Branch/repository/path values from the request are never used to
            // resolve the target. The resolver must return the Graph pointer.
            resolved = await resolver.call(this.documentGraphPointerResolver, {
                access,
                project_code: current.project_code,
                draft: draftProjection(current),
                intent: input.intent,
                audience: input.audience,
                content_type: input.content_type,
                path: input.path
            });
        } catch (error) {
            if (error instanceof KnowledgeAuthoringError) throw error;
            if (typeof error?.code === 'string' && error.code.startsWith('knowledge_')) {
                throw new KnowledgeAuthoringError(error.code, error.message, error.status || 503, error.details || {});
            }
            throw new KnowledgeAuthoringError(
                'knowledge_document_graph_pointer_unavailable',
                'resolved owning repository Graph pointer is unavailable',
                503
            );
        }

        const resolution = resolved?.resolution || resolved;
        return assertDocumentGraphPointer(resolution, current.project_code, access, input.path);
    }

    _documentReceiptResult(receipt) {
        if (!receipt) return null;
        const result = receipt.result;
        if (result && typeof result === 'object') return result;
        if (typeof result === 'string') {
            try {
                return JSON.parse(result);
            } catch {
                return null;
            }
        }
        return null;
    }

    async _saveDocumentDraft(access, { current, expectedRevision, idempotencyKey, decisionDomain, input }) {
        if (typeof this.documentReceiptRepository?.findAuthoringSave !== 'function'
            || typeof this.documentReceiptRepository?.completeAuthoringSave !== 'function') {
            throw new KnowledgeAuthoringError(
                'knowledge_document_receipt_not_configured',
                'durable document authoring receipt storage is not configured',
                503
            );
        }
        if (!this.documentWriter || typeof this.documentWriter.save !== 'function') {
            throw new KnowledgeAuthoringError(
                'knowledge_document_writer_not_configured',
                'canonical document writer is not configured',
                503
            );
        }

        const receipt = await this.documentReceiptRepository.findAuthoringSave({
            access,
            projectCode: current.project_code,
            idempotencyKey
        });
        if (receipt) {
            if (receipt.draft_id !== current.draft_id || Number(receipt.draft_revision) !== expectedRevision) {
                throw new KnowledgeAuthoringError(
                    'knowledge_save_idempotency_conflict',
                    'idempotency key belongs to another draft revision',
                    409
                );
            }
            const stored = this._documentReceiptResult(receipt);
            if (!stored) {
                throw new KnowledgeAuthoringError(
                    'knowledge_document_receipt_invalid',
                    'document authoring receipt has no valid result',
                    503
                );
            }
            return { ...stored, idempotent: true };
        }

        if (current.status === 'saved' && current.revision === expectedRevision) {
            throw new KnowledgeAuthoringError(
                'knowledge_save_receipt_not_found',
                'draft is already saved but this idempotency key has no matching receipt',
                409
            );
        }
        if (!['draft', 'saving'].includes(current.status) || current.revision !== expectedRevision) {
            throw new KnowledgeAuthoringError('knowledge_draft_revision_conflict', 'draft revision changed', 409);
        }
        if (current.status === 'saving' && current.save_idempotency_key !== idempotencyKey) {
            throw new KnowledgeAuthoringError('knowledge_save_in_progress', 'draft is being saved with another idempotency key', 409);
        }
        if (current.status === 'saving' && current.save_decision_domain !== decisionDomain) {
            throw new KnowledgeAuthoringError('knowledge_save_idempotency_conflict', 'save retry changed the decision domain', 409);
        }
        requiredText(current.title, 'title');
        requiredText(current.content, 'content');
        const intent = requiredText(input.intent, 'intent');
        const audience = requiredText(input.audience, 'audience');
        const contentType = requiredText(input.content_type, 'content_type');
        if (audience !== 'team' && audience !== 'organization') {
            throw new KnowledgeAuthoringError('knowledge_document_input_invalid', 'audience must be team or organization', 400, { field: 'audience' });
        }
        if (contentType !== 'team_document') {
            throw new KnowledgeAuthoringError('knowledge_document_route_invalid', 'document save requires content_type=team_document', 422, { field: 'content_type' });
        }
        const baseRevision = requiredText(input.base_revision, 'base_revision');
        const pointer = await this._resolveDocumentGraphPointer(access, current, {
            ...input,
            intent,
            audience,
            content_type: contentType
        });
        const ownerPersonId = current.owner_person_id || access.personId;
        await this._validateAuthoringContext(access, {
            projectCode: current.project_code,
            kind: current.kind,
            ownerPersonId,
            relations: current.relations,
            decisionDomain,
            entityId: current.canonical_id
        });
        const claimed = await this.repository.claimSave(current.draft_id, {
            expected_revision: expectedRevision,
            idempotency_key: idempotencyKey,
            decision_domain: decisionDomain
        }, { access, projectCode: current.project_code });
        if (!claimed) {
            throw new KnowledgeAuthoringError('knowledge_draft_revision_conflict', 'draft revision or save claim changed', 409);
        }

        let document;
        try {
            document = await this.documentWriter.save({
                project_code: current.project_code,
                intent,
                audience,
                content_type: contentType,
                path: pointer.path,
                content: current.content,
                base_hash: input.base_hash ?? null,
                base_revision: baseRevision,
                idempotency_key: idempotencyKey,
                access,
                resolution: pointer.resolution
            });
        } catch (error) {
            if (error?.name === 'CanonicalDocumentWriterError' && error.code) {
                throw new KnowledgeAuthoringError(error.code, error.message, error.status || 503, error.details || {});
            }
            throw error;
        }
        if (!document || typeof document !== 'object' || !document.revision) {
            throw new KnowledgeAuthoringError(
                'knowledge_document_write_invalid',
                'canonical document writer returned no revision',
                503
            );
        }
        const result = {
            status: 'saved',
            idempotent: Boolean(document.idempotency_replayed),
            draft: { ...current, status: 'saved', save_idempotency_key: idempotencyKey, save_decision_domain: decisionDomain },
            document,
            canonical: document,
            expected_revision: baseRevision,
            persistence: {
                document_saved: true,
                readback_verified: true,
                index_state: 'unknown'
            }
        };
        try {
            await this.documentReceiptRepository.completeAuthoringSave({
                idempotency_key: idempotencyKey,
                draft_id: current.draft_id,
                draft_revision: expectedRevision,
                result
            }, { access, projectCode: current.project_code });
        } catch (error) {
            if (typeof error?.code === 'string' && error.code.startsWith('knowledge_')) {
                throw new KnowledgeAuthoringError(error.code, error.message, error.status || 409, error.details || {});
            }
            throw error;
        }
        return result;
    }

    async saveDraft(access, input = {}) {
        const current = await this.getDraft(access, input);
        const expectedRevision = revision(input.revision);
        const idempotencyKey = requiredText(input.idempotency_key, 'idempotency_key');
        const decisionDomain = requiredText(input.decision_domain, 'decision_domain');
        if (current.kind === 'document') {
            return this._saveDocumentDraft(access, {
                current, expectedRevision, idempotencyKey, decisionDomain, input
            });
        }
        const existing = await this.repository.findSave(idempotencyKey, { access, projectCode: current.project_code });
        if (existing) {
            if (existing.draft_id !== current.draft_id || Number(existing.draft_revision) !== expectedRevision) {
                throw new KnowledgeAuthoringError('knowledge_save_idempotency_conflict', 'idempotency key belongs to another draft revision', 409);
            }
            return existing.result;
        }
        if (current.status === 'saved' && current.revision === expectedRevision) {
            throw new KnowledgeAuthoringError(
                'knowledge_save_receipt_not_found',
                'draft is already saved but this idempotency key has no matching receipt',
                409
            );
        }
        if (!['draft', 'saving'].includes(current.status) || current.revision !== expectedRevision) {
            throw new KnowledgeAuthoringError('knowledge_draft_revision_conflict', 'draft revision changed', 409);
        }
        if (current.status === 'saving' && current.save_idempotency_key !== idempotencyKey) {
            throw new KnowledgeAuthoringError('knowledge_save_in_progress', 'draft is being saved with another idempotency key', 409);
        }
        if (current.status === 'saving' && current.save_decision_domain !== decisionDomain) {
            throw new KnowledgeAuthoringError('knowledge_save_idempotency_conflict', 'save retry changed the decision domain', 409);
        }
        requiredText(current.title, 'title');
        requiredText(current.content, 'content');
        if (current.kind !== 'decision') {
            throw new KnowledgeAuthoringError('knowledge_document_save_unavailable', 'canonical document storage is not configured', 503);
        }
        if (input.reuse_canonical_id !== undefined || input.existing_id !== undefined) {
            throw new KnowledgeAuthoringError(
                'knowledge_canonical_reuse_explicit_required',
                'existing canonical ids must use the explicit reuse flow',
                400,
                { fields: ['canonical_id'] }
            );
        }
        if (input.canonical_id !== undefined) {
            throw new KnowledgeAuthoringError(
                'knowledge_canonical_id_not_accepted',
                'new canonical ids are assigned by Brainbase; revisions use the lifecycle/revision flow',
                400
            );
        }
        const ownerPersonId = current.owner_person_id || access.personId;
        await this._validateAuthoringContext(access, {
            projectCode: current.project_code,
            kind: current.kind,
            ownerPersonId,
            relations: current.relations,
            decisionDomain,
            entityId: current.canonical_id
        });
        const claimed = await this.repository.claimSave(current.draft_id, {
            expected_revision: expectedRevision,
            idempotency_key: idempotencyKey,
            decision_domain: decisionDomain
        }, { access, projectCode: current.project_code });
        if (!claimed) {
            throw new KnowledgeAuthoringError('knowledge_draft_revision_conflict', 'draft revision or save claim changed', 409);
        }
        const canonicalId = `decision_${sha256(`${current.project_code}:${current.draft_id}`).slice(0, 24)}`;
        const eventId = `knowledge_save_${sha256(`${current.draft_id}:${expectedRevision}`).slice(0, 32)}`;
        const occurredAt = this.now();
        const event = {
            schema_version: 'knowledge_event.v1',
            event_id: eventId,
            occurred_at: occurredAt,
            captured_at: occurredAt,
            source: { type: 'brainbase_knowledge_authoring', venue: 'brainbase' },
            subject: { type: 'decision', id: canonicalId },
            decision: { statement: current.content },
            decision_authority: {
                authorized: true,
                decider_id: ownerPersonId,
                domain: decisionDomain
            },
            applicability_scope: {
                ...current.applicability,
                scope: current.applicability?.scope || 'project',
                project_code: current.project_code,
                organization_id: access.organizationId || access.tenantId
            },
            permission_snapshot: { visibility: 'organization', sensitivity: 'internal' },
            source_pointer: current.source_pointer || { uri: `brainbase://knowledge-drafts/${current.draft_id}` },
            body_hash: `sha256:${sha256(current.content)}`,
            parent_episode_id: `knowledge_authoring:${current.draft_id}`,
            organization_id: access.organizationId || access.tenantId,
            sensitivity: 'internal',
            role_min: 'member',
            venue: 'brainbase',
            version: String(expectedRevision)
        };
        const ingest = await this.knowledgeEventService.ingest(event, { access });
        if (ingest.semantic_state !== 'active' || ingest.processing_stage !== 'retrievable' || !ingest.graph_entity_id) {
            throw new KnowledgeAuthoringError('knowledge_save_not_retrievable', 'canonical save did not become retrievable', 409, { ingest });
        }
        const graphPersistence = await this._persistAuthoringGraph(access, {
            projectCode: current.project_code,
            kind: current.kind,
            entityId: ingest.graph_entity_id,
            ownerPersonId,
            relations: current.relations,
            decisionDomain,
            expectedVersion: String(expectedRevision)
        });
        const readback = await this.catalogService.get(access, { project_code: current.project_code, id: ingest.graph_entity_id });
        const contentHash = `sha256:${sha256(current.content)}`;
        const readbackVerified = readback.id === ingest.graph_entity_id
            && readback.version === String(expectedRevision)
            && readback.canonical_content === current.content;
        if (!readbackVerified) {
            throw new KnowledgeAuthoringError('knowledge_save_readback_mismatch', 'canonical readback did not match saved content and version', 409, {
                expected: { id: ingest.graph_entity_id, version: String(expectedRevision), content_hash: contentHash },
                observed: {
                    id: readback.id,
                    version: readback.version,
                    content_hash: readback.canonical_content ? `sha256:${sha256(readback.canonical_content)}` : null
                }
            });
        }
        const result = {
            status: 'saved',
            idempotent: Boolean(ingest.idempotent),
            draft: { ...current, status: 'saved', canonical_id: ingest.graph_entity_id, saved_event_id: eventId },
            canonical: readback,
            expected_version: String(expectedRevision),
            canonical_content_hash: contentHash,
            persistence: {
                event_saved: true,
                graph_saved: true,
                readback_verified: true,
                index_state: ingest.processing_stage,
                relation_count: graphPersistence?.relation_count || 0,
                relations: graphPersistence?.relations || [],
                relations_saved: true
            }
        };
        await this.repository.completeSave({
            idempotency_key: idempotencyKey,
            draft_id: current.draft_id,
            draft_revision: expectedRevision,
            canonical_id: ingest.graph_entity_id,
            event_id: eventId,
            result
        }, { access, projectCode: current.project_code });
        return result;
    }

    async reuseCanonical(access, input = {}) {
        const projectCode = requiredText(input.project_code, 'project_code');
        requireProjectAccess(access, projectCode);
        const current = await this.getDraft(access, input);
        if (current.status !== 'draft') {
            throw new KnowledgeAuthoringError('knowledge_draft_not_editable', 'only active drafts can reuse a canonical', 409);
        }
        const canonicalId = requiredText(input.canonical_id || input.existing_id || input.reuse_canonical_id, 'canonical_id');
        if (input.owner_candidate !== undefined) {
            throw new KnowledgeAuthoringError(
                'knowledge_owner_confirmation_required',
                'owner_candidate cannot be used for canonical reuse; select an existing owner_person_id',
                400
            );
        }
        const expectedVersion = requiredText(String(input.expected_version || ''), 'expected_version');
        const draftRevision = input.revision === undefined ? current.revision : revision(input.revision);
        if (draftRevision !== current.revision) {
            throw new KnowledgeAuthoringError('knowledge_draft_revision_conflict', 'draft revision changed', 409);
        }
        const idempotencyKey = input.idempotency_key === undefined
            ? `reuse:${current.draft_id}:${canonicalId}:${expectedVersion}`
            : requiredText(input.idempotency_key, 'idempotency_key');
        const existing = typeof this.repository.findReuse === 'function'
            ? await this.repository.findReuse(idempotencyKey, { access, projectCode: current.project_code })
            : null;
        if (existing) return existing.result;
        const ownerPersonId = current.owner_person_id || access.personId;
        const decisionDomain = requiredText(input.decision_domain, 'decision_domain');
        await this._validateAuthoringContext(access, {
            projectCode: current.project_code,
            kind: current.kind,
            ownerPersonId,
            relations: current.relations,
            decisionDomain,
            entityId: canonicalId
        });
        const reuser = this.graphRepository?.reuseCanonical;
        if (typeof reuser !== 'function') {
            throw new KnowledgeAuthoringError('knowledge_authoring_graph_unavailable', 'explicit canonical reuse is not configured', 503);
        }
        let reused;
        try {
            reused = await reuser.call(this.graphRepository, {
                project_code: current.project_code,
                entity_type: current.kind === 'decision' ? 'decision' : current.kind,
                entity_id: canonicalId,
                owner_person_id: ownerPersonId,
                relations: current.relations,
                decision_domain: decisionDomain,
                expected_version: expectedVersion
            }, { access });
        } catch (error) {
            if (error instanceof KnowledgeAuthoringError) throw error;
            if (typeof error?.code === 'string' && error.code.startsWith('knowledge_')) {
                throw new KnowledgeAuthoringError(error.code, error.message, error.status || 400, error.details || {});
            }
            throw error;
        }
        if (!reused) throw new KnowledgeAuthoringError('knowledge_canonical_not_found', 'canonical was not found', 404);
        const canonical = reused.canonical || reused.record
            || await this.catalogService.get(access, { project_code: projectCode, id: canonicalId });
        if (canonical?.version && String(canonical.version) !== expectedVersion) {
            throw new KnowledgeAuthoringError('knowledge_canonical_version_conflict', 'canonical version changed', 409, {
                expected_version: expectedVersion, current_version: canonical.version
            });
        }
        const result = {
            status: 'reused',
            idempotent: Boolean(reused.idempotent),
            draft: { ...current, canonical_id: canonicalId },
            canonical,
            expected_version: expectedVersion,
            persistence: {
                graph_saved: true,
                relations_saved: true,
                relation_count: reused.relation_count || 0,
                relations: reused.relations || [],
                readback_verified: true
            }
        };
        if (typeof this.repository.completeReuse === 'function') {
            await this.repository.completeReuse({
                reuse_id: `knowledge_reuse_${sha256(`${current.draft_id}:${canonicalId}:${expectedVersion}`)}`,
                idempotency_key: idempotencyKey,
                draft_id: current.draft_id,
                draft_revision: draftRevision,
                canonical_id: canonicalId,
                expected_version: expectedVersion,
                owner_person_id: ownerPersonId,
                result
            }, { access, projectCode: current.project_code });
        }
        return result;
    }

    async changeLifecycle(access, input = {}) {
        const projectCode = requiredText(input.project_code, 'project_code');
        requireProjectAccess(access, projectCode);
        const state = requiredText(input.state, 'state');
        if (!['active', 'retired', 'unlinked'].includes(state)) {
            throw new KnowledgeAuthoringError('knowledge_lifecycle_state_invalid', 'state must be active, retired, or unlinked', 400);
        }
        const changed = await this.graphRepository.changeLifecycle({
            id: requiredText(input.id, 'id'),
            project_code: projectCode,
            expected_version: requiredText(String(input.expected_version || ''), 'expected_version'),
            state,
            reason: requiredText(input.reason, 'reason'),
            actor_person_id: access.personId
        }, { access });
        if (!changed) throw new KnowledgeAuthoringError('knowledge_not_found', 'knowledge was not found', 404);
        return { status: 'changed', record: await this.catalogService.get(access, { project_code: projectCode, id: input.id }) };
    }

    async revise(access, input = {}) {
        const projectCode = requiredText(input.project_code, 'project_code');
        requireProjectAccess(access, projectCode);
        const content = requiredText(input.content, 'content');
        const scope = input.scope === undefined ? undefined : requiredText(input.scope, 'scope');
        if (scope !== undefined && !['project', 'organization'].includes(scope)) {
            throw new KnowledgeAuthoringError('knowledge_revision_scope_invalid', 'scope must be project or organization', 400);
        }
        const ownerPersonId = input.owner_person_id === undefined
            ? undefined : requiredText(input.owner_person_id, 'owner_person_id');
        const effectiveAt = optionalTimestamp(input.effective_at, 'effective_at');
        const expiresAt = optionalTimestamp(input.expires_at, 'expires_at');
        if (effectiveAt && expiresAt && Date.parse(expiresAt) <= Date.parse(effectiveAt)) {
            throw new KnowledgeAuthoringError(
                'knowledge_revision_effective_period_invalid',
                'expires_at must be later than effective_at',
                400
            );
        }
        const changed = await this.graphRepository.reviseDecision({
            id: requiredText(input.id, 'id'), project_code: projectCode,
            expected_version: requiredText(String(input.expected_version || ''), 'expected_version'),
            idempotency_key: requiredText(input.idempotency_key, 'idempotency_key'),
            reason: requiredText(input.reason, 'reason'), content,
            content_hash: `sha256:${sha256(content)}`,
            ...(input.title === undefined ? {} : { title: draftText(input.title, 'title') }),
            ...(scope === undefined ? {} : { scope }),
            ...(ownerPersonId === undefined ? {} : { owner_person_id: ownerPersonId }),
            ...(effectiveAt === undefined ? {} : { effective_at: effectiveAt }),
            ...(expiresAt === undefined ? {} : { expires_at: expiresAt }),
            organization_id: access.organizationId || access.tenantId,
            actor_person_id: access.personId
        }, { access });
        if (!changed) throw new KnowledgeAuthoringError('knowledge_not_found', 'knowledge was not found', 404);
        const record = await this.catalogService.get(access, { project_code: projectCode, id: input.id });
        const metadataMatches = (scope === undefined || record.scope === scope)
            && (ownerPersonId === undefined || record.owner === ownerPersonId)
            && (effectiveAt === undefined || record.lifecycle.effective_at === effectiveAt)
            && (expiresAt === undefined || record.lifecycle.expires_at === expiresAt);
        if (record.version !== changed.payload.version || record.canonical_content !== content
            || record.canonical_content_hash !== `sha256:${sha256(content)}` || !metadataMatches) {
            throw new KnowledgeAuthoringError('knowledge_revision_readback_mismatch', 'canonical revision readback did not match', 409);
        }
        return { status: 'revised', idempotent: Boolean(changed.idempotent), record };
    }

    async supersede(access, input = {}) {
        const projectCode = requiredText(input.project_code, 'project_code');
        requireProjectAccess(access, projectCode);
        const replacementId = requiredText(input.id, 'id');
        const supersededId = requiredText(input.superseded_id, 'superseded_id');
        if (replacementId === supersededId) {
            throw new KnowledgeAuthoringError('knowledge_supersession_self_reference', 'a decision cannot supersede itself', 400);
        }
        const effectiveAt = optionalTimestamp(input.effective_at, 'effective_at');
        if (!effectiveAt) {
            throw new KnowledgeAuthoringError('knowledge_supersession_effective_at_required', 'effective_at is required', 400);
        }
        const changed = await this.graphRepository.establishSupersession({
            replacement_id: replacementId,
            superseded_id: supersededId,
            project_code: projectCode,
            replacement_expected_version: requiredText(String(input.replacement_expected_version || ''), 'replacement_expected_version'),
            superseded_expected_version: requiredText(String(input.superseded_expected_version || ''), 'superseded_expected_version'),
            effective_at: effectiveAt,
            reason: requiredText(input.reason, 'reason'),
            idempotency_key: requiredText(input.idempotency_key, 'idempotency_key'),
            organization_id: access.organizationId || access.tenantId,
            actor_person_id: access.personId
        }, { access });
        if (!changed) throw new KnowledgeAuthoringError('knowledge_not_found', 'replacement or superseded decision was not found', 404);
        const [replacement, superseded] = await Promise.all([
            this.catalogService.get(access, { project_code: projectCode, id: replacementId }),
            this.catalogService.get(access, { project_code: projectCode, id: supersededId })
        ]);
        const relationMatches = replacement.relations?.some((edge) => edge.relation === 'supersedes'
            && edge.from_id === replacementId && edge.to_id === supersededId && edge.effective_at === effectiveAt);
        if (replacement.version !== changed.replacement.payload.version
            || superseded.version !== changed.superseded.payload.version
            || replacement.lifecycle?.effective_at !== effectiveAt
            || superseded.lifecycle?.expires_at !== effectiveAt || !relationMatches) {
            throw new KnowledgeAuthoringError('knowledge_supersession_readback_mismatch', 'canonical supersession readback did not match', 409);
        }
        return { status: 'superseded', idempotent: Boolean(changed.idempotent), replacement, superseded };
    }

    async history(access, input = {}) {
        const projectCode = requiredText(input.project_code, 'project_code');
        requireProjectAccess(access, projectCode);
        const [lifecycleEntries, revisionEntries, supersessionEntries] = await Promise.all([
            this.graphRepository.listLifecycleHistory({ id: input.id, project_code: projectCode }, { access }),
            this.graphRepository.listRevisionHistory({ id: input.id, project_code: projectCode }, { access }),
            this.graphRepository.listSupersessionHistory({ id: input.id, project_code: projectCode }, { access })
        ]);
        return {
            id: requiredText(input.id, 'id'),
            project_code: projectCode,
            entries: [...lifecycleEntries.map((entry) => ({ ...entry, kind: 'lifecycle' })),
                ...revisionEntries, ...supersessionEntries]
                .sort((left, right) => String(right.occurred_at || '').localeCompare(String(left.occurred_at || '')))
        };
    }

    async authorityDomains(access, input = {}) {
        const projectCode = requiredText(input.project_code, 'project_code');
        requireProjectAccess(access, projectCode);
        return {
            project_code: projectCode,
            domains: await this.graphRepository.listDecisionAuthorityDomains({ project_code: projectCode }, { access })
        };
    }
}
