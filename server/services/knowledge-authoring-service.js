import { createHash, randomUUID } from 'node:crypto';

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

function draftProjection(record) {
    return {
        draft_id: record.draft_id,
        project_code: record.project_code,
        kind: record.kind,
        title: record.title,
        content: record.content,
        applicability: record.applicability || {},
        source_pointer: record.source_pointer || null,
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
    constructor({ repository, knowledgeEventService, catalogService, graphRepository, now = () => new Date().toISOString(), id = randomUUID }) {
        this.repository = repository;
        this.knowledgeEventService = knowledgeEventService;
        this.catalogService = catalogService;
        this.graphRepository = graphRepository;
        this.now = now;
        this.id = id;
    }

    async createDraft(access, input = {}) {
        const projectCode = requiredText(input.project_code, 'project_code');
        requireProjectAccess(access, projectCode);
        const kind = input.kind === undefined ? 'decision' : input.kind;
        if (!['decision', 'document'].includes(kind)) {
            throw new KnowledgeAuthoringError('knowledge_draft_kind_unsupported', 'kind must be decision or document', 400);
        }
        const record = await this.repository.createDraft({
            draft_id: `kd_${this.id()}`,
            organization_id: access.organizationId || access.tenantId,
            owner_person_id: access.personId,
            project_code: projectCode,
            kind,
            title: draftText(input.title, 'title'),
            content: draftText(input.content, 'content'),
            applicability: input.applicability && typeof input.applicability === 'object' ? input.applicability : {},
            source_pointer: input.source_pointer && typeof input.source_pointer === 'object' ? input.source_pointer : null,
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
        const current = await this.getDraft(access, input);
        if (current.status !== 'draft') {
            throw new KnowledgeAuthoringError('knowledge_draft_not_editable', 'only active drafts can be edited', 409);
        }
        const expectedRevision = revision(input.revision);
        const updated = await this.repository.updateDraft(current.draft_id, {
            expected_revision: expectedRevision,
            title: input.title === undefined ? current.title : draftText(input.title, 'title'),
            content: input.content === undefined ? current.content : draftText(input.content, 'content'),
            applicability: input.applicability === undefined ? current.applicability : input.applicability,
            source_pointer: input.source_pointer === undefined ? current.source_pointer : input.source_pointer
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

    async saveDraft(access, input = {}) {
        const current = await this.getDraft(access, input);
        const expectedRevision = revision(input.revision);
        const idempotencyKey = requiredText(input.idempotency_key, 'idempotency_key');
        const decisionDomain = requiredText(input.decision_domain, 'decision_domain');
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
        if (input.canonical_id !== undefined) {
            throw new KnowledgeAuthoringError(
                'knowledge_canonical_id_not_accepted',
                'new canonical ids are assigned by Brainbase; revisions use the lifecycle/revision flow',
                400
            );
        }
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
                decider_id: access.personId,
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
                index_state: ingest.processing_stage
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
