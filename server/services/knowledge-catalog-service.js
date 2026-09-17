import { createHash } from 'node:crypto';

import {
    KnowledgeAIAdapterContractError,
    referenceKey,
    resolveKnowledgeAdapter,
    validateCaptureProposal,
    validatePreviewAnswer
} from './knowledge-capture-preview-adapter.js';
import { KnowledgeResolutionService } from './knowledge-resolution-service.js';

const ACTIVE_STATUSES = new Set(['active', 'decided', 'current', 'published']);
const INACTIVE_STATUSES = new Set(['draft', 'superseded', 'expired', 'retired', 'deprecated', 'inactive']);

export class KnowledgeCatalogError extends Error {
    constructor(code, message, status = 400, details = {}) {
        super(message);
        this.name = 'KnowledgeCatalogError';
        this.code = code;
        this.status = status;
        this.details = details;
    }
}

function text(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function scalar(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return text(value);
}

function safeLimit(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 50;
    return Math.min(Math.max(Math.trunc(number), 1), 100);
}

function lifecycle(entity) {
    const payload = entity.payload || {};
    const semanticState = text(payload.semantic_state)?.toLowerCase();
    const forbiddenSemanticState = ['retracted', 'quarantined', 'contradicted'].includes(semanticState)
        ? semanticState
        : null;
    const rawStatus = forbiddenSemanticState
        || (payload.searchable === false ? 'inactive' : null)
        || text(payload.status)?.toLowerCase()
        || semanticState
        || 'unknown';
    const effectiveAt = text(payload.effective_at) || text(payload.decided_at);
    const expiresAt = text(payload.expires_at) || text(payload.valid_until);
    const now = Date.now();
    const scheduled = effectiveAt && Number.isFinite(Date.parse(effectiveAt)) && Date.parse(effectiveAt) > now;
    const expired = expiresAt && Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) <= now;
    const applicable = ACTIVE_STATUSES.has(rawStatus) && !scheduled && !expired;
    return {
        status: expired ? 'expired' : rawStatus,
        applicable,
        effective_at: effectiveAt,
        expires_at: expiresAt
    };
}

function source(entity) {
    const payload = entity.payload || {};
    const pointer = text(payload.source_url)
        || text(payload.canonical_url)
        || text(payload.url)
        || text(payload.repository_path)
        || text(payload.repo_path)
        || text(payload.source_pointer);
    return {
        pointer,
        kind: pointer?.startsWith('http') ? 'url' : pointer ? 'repository_path' : 'unknown',
        content_state: pointer ? 'pointer_only' : 'unknown',
        content_hash: text(payload.content_hash) || text(payload.source_hash) || null
    };
}

function contentHash(content) {
    return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function projectScope(entity, projectCode) {
    const declared = text(entity.payload?.applicability_scope?.scope) || text(entity.payload?.scope);
    return declared === 'organization' ? 'organization' : entity.project_code === projectCode ? 'project' : 'unknown';
}

function mapRecord(entity, projectCode) {
    const payload = entity.payload || {};
    const state = lifecycle(entity);
    return {
        id: entity.id,
        type: entity.entity_type,
        title: text(payload.title) || text(payload.name),
        summary: text(payload.summary) || text(payload.description),
        scope: projectScope(entity, projectCode),
        owner: text(payload.owner_person_id) || text(payload.owner_id) || text(payload.owner) || null,
        applicability: {
            state: state.applicable ? 'applicable' : state.status === 'unknown' ? 'unknown' : 'not_applicable',
            conditions: payload.applicability_conditions ?? null
        },
        source: source(entity),
        lifecycle: state,
        version: scalar(payload.version) || scalar(payload.revision) || null,
        updated_at: entity.updated_at || null
    };
}

function includeStatus(record, filter) {
    if (filter === 'all') return true;
    if (filter === 'inactive') return !record.lifecycle.applicable;
    return record.lifecycle.applicable;
}

function requireProjectAccess(access, projectCode) {
    if (!projectCode) {
        throw new KnowledgeCatalogError('knowledge_project_required', 'project_code is required', 400);
    }
    if (!Array.isArray(access?.projectCodes) || !access.projectCodes.includes(projectCode)) {
        throw new KnowledgeCatalogError('knowledge_project_not_accessible', 'project is not accessible', 403);
    }
}

function referenceVersion(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function candidateReference(candidate) {
    const id = text(candidate?.id);
    const version = referenceVersion(candidate?.version);
    return id && version ? { id, version, key: referenceKey(id, version) } : null;
}

function adapterError(error, { invalidCode, unavailableCode, invalidMessage, unavailableMessage }) {
    if (error instanceof KnowledgeAIAdapterContractError) {
        return new KnowledgeCatalogError(
            invalidCode,
            invalidMessage,
            502,
            error.details || {}
        );
    }
    return new KnowledgeCatalogError(unavailableCode, unavailableMessage, 503);
}

function relationReferences(value, path = 'relations', references = []) {
    if (Array.isArray(value)) {
        value.forEach((entry, index) => relationReferences(entry, `${path}[${index}]`, references));
        return references;
    }
    if (!value || typeof value !== 'object') return references;
    const id = text(value.id)
        || text(value.candidate_id)
        || text(value.target_id)
        || text(value.from_id)
        || text(value.to_id);
    if (id) {
        const version = referenceVersion(value.version)
            || referenceVersion(value.target_version)
            || referenceVersion(value.from_version)
            || referenceVersion(value.to_version);
        references.push({ id, version, path });
    }
    Object.entries(value).forEach(([key, child]) => {
        if (!['id', 'candidate_id', 'target_id', 'from_id', 'to_id', 'version',
            'target_version', 'from_version', 'to_version'].includes(key)) {
            relationReferences(child, `${path}.${key}`, references);
        }
    });
    return references;
}

function publicCandidate(candidate) {
    const { content: _content, ...metadata } = candidate;
    return metadata;
}

export class KnowledgeCatalogService {
    constructor({
        infoSSOTService,
        contentRetriever = null,
        captureProposalAdapter = null,
        previewAnswerer = null,
        knowledgeAIAdapter = null,
        documentWriter = null,
        knowledgeResolutionService = null
    }) {
        if (!infoSSOTService) throw new TypeError('infoSSOTService is required');
        this.infoSSOTService = infoSSOTService;
        this.contentRetriever = contentRetriever;
        const captureAdapter = captureProposalAdapter || knowledgeAIAdapter;
        const previewAdapter = previewAnswerer || knowledgeAIAdapter;
        this.captureProposalAdapter = resolveKnowledgeAdapter(captureAdapter, 'proposeCapture')
            || resolveKnowledgeAdapter(captureAdapter, 'capture');
        this.previewAnswerer = resolveKnowledgeAdapter(previewAdapter, 'preview')
            || resolveKnowledgeAdapter(previewAdapter, 'answerPreview');
        this.documentWriter = documentWriter;
        this.knowledgeResolutionService = knowledgeResolutionService || new KnowledgeResolutionService();
    }

    async list(access, input = {}) {
        const projectCode = text(input.project_code);
        requireProjectAccess(access, projectCode);
        const scope = ['project', 'organization', 'all'].includes(input.scope) ? input.scope : 'all';
        const status = ['active', 'inactive', 'all'].includes(input.status) ? input.status : 'active';
        const allowedProjects = new Set(access.projectCodes);
        const queries = [...allowedProjects].flatMap((visibleProject) => ['decision', 'document'].map((entityType) => (
            this.infoSSOTService.listGraphEntities(access, {
                projectCode: visibleProject,
                entityType,
                query: text(input.q),
                limit: safeLimit(input.limit)
            })
        )));
        const groups = await Promise.all(queries);
        const records = groups.flat()
            .filter((entity) => entity.project_code === projectCode
                || text(entity.payload?.applicability_scope?.scope) === 'organization')
            .map((entity) => mapRecord(entity, projectCode))
            .filter((record) => scope === 'all' || record.scope === scope)
            .filter((record) => includeStatus(record, status));
        const deduplicated = [...new Map(records.map((record) => [record.id, record])).values()]
            .sort((left, right) => String(right.updated_at || '').localeCompare(String(left.updated_at || '')))
            .slice(0, safeLimit(input.limit));
        return {
            state: deduplicated.length ? 'results' : 'empty',
            project_code: projectCode,
            records: deduplicated,
            searched_scope: [...allowedProjects],
            absence_confirmed: false
        };
    }

    async get(access, input = {}) {
        const projectCode = text(input.project_code);
        const id = text(input.id);
        requireProjectAccess(access, projectCode);
        if (!id) throw new KnowledgeCatalogError('knowledge_id_required', 'knowledge id is required', 400);
        const groups = await Promise.all(access.projectCodes.map((visibleProject) => (
            this.infoSSOTService.listGraphEntities(access, { id, projectCode: visibleProject, limit: 1 })
        )));
        const entity = groups.flat().find((row) => row.id === id
            && ['decision', 'document'].includes(row.entity_type)
            && (row.project_code === projectCode
                || text(row.payload?.applicability_scope?.scope) === 'organization'));
        if (!entity) {
            throw new KnowledgeCatalogError('knowledge_not_found', 'knowledge was not found', 404);
        }
        const edges = await this.infoSSOTService.listGraphEdges(access, {
            projectCode: entity.project_code, fromId: id
        });
        const endpointIds = [...new Set(edges.flatMap((edge) => [edge.from_id, edge.to_id]))];
        const visibleEndpoints = endpointIds.length
            ? await this.infoSSOTService.listGraphEntities(access, { ids: endpointIds, projectCode: entity.project_code, limit: endpointIds.length })
            : [];
        const visibleIds = new Set(visibleEndpoints.map((endpoint) => endpoint.id));
        const mapped = mapRecord(entity, projectCode);
        const graphContent = entity.entity_type === 'decision'
            ? text(entity.payload?.statement) || text(entity.payload?.decision)
            : null;
        return {
            ...mapped,
            source: graphContent ? {
                pointer: `brainbase://graph/${entity.id}`,
                kind: 'graph_entity',
                content_state: 'fetched'
            } : mapped.source,
            canonical_content: graphContent,
            canonical_content_hash: graphContent ? contentHash(graphContent) : null,
            relations: edges.filter((edge) => visibleIds.has(edge.from_id) && visibleIds.has(edge.to_id)).map((edge) => ({
                relation: edge.rel_type,
                from_id: edge.from_id,
                to_id: edge.to_id,
                effective_at: edge.payload?.effective_at || null,
                provenance: edge.payload?.provenance || null
            }))
        };
    }

    async retrieve(access, input = {}) {
        const projectCode = text(input.project_code);
        requireProjectAccess(access, projectCode);
        if (!Array.isArray(input.refs) || input.refs.length === 0) {
            throw new KnowledgeCatalogError('knowledge_refs_required', 'refs are required', 400);
        }
        if (input.refs.length > 50) {
            throw new KnowledgeCatalogError('knowledge_refs_limit_exceeded', 'refs must contain at most 50 items', 400, {
                maximum: 50,
                received: input.refs.length
            });
        }
        const results = [];
        for (const ref of input.refs) {
            const id = text(ref?.id);
            const requestedVersion = text(ref?.version);
            if (!id || !requestedVersion) {
                results.push({ id, requested_version: requestedVersion, status: 'insufficient' });
                continue;
            }
            try {
                const record = await this.get(access, { project_code: projectCode, id });
                if (record.applicability.state !== 'applicable') {
                    results.push({ id, requested_version: requestedVersion, resolved_version: record.version, status: 'not_applicable' });
                    continue;
                }
                if (!record.version || record.version !== requestedVersion) {
                    results.push({ id, requested_version: requestedVersion, resolved_version: record.version, status: 'version_conflict' });
                    continue;
                }
                if (record.canonical_content) {
                    results.push({
                        ...record,
                        requested_version: requestedVersion,
                        resolved_version: record.version,
                        status: 'resolved',
                        content: record.canonical_content,
                        retrieval_receipt_id: `graph:${record.id}:${record.version}`
                    });
                    continue;
                }
                const retriever = this.contentRetriever;
                const authorized = record.source.pointer
                    && typeof retriever?.authorize === 'function'
                    && await retriever.authorize(record.source, { access, record }) === true;
                if (!authorized || typeof retriever?.retrieve !== 'function') {
                    results.push({ ...record, requested_version: requestedVersion, resolved_version: record.version, status: 'source_unavailable' });
                    continue;
                }
                const retrieved = await retriever.retrieve(record.source, { access, record });
                if (!retrieved?.content || !retrieved?.receipt_id) {
                    results.push({ ...record, requested_version: requestedVersion, resolved_version: null, status: 'source_unavailable' });
                    continue;
                }
                if (!text(retrieved.version)) {
                    results.push({ ...record, requested_version: requestedVersion, resolved_version: null, status: 'source_version_unknown' });
                    continue;
                }
                if (text(retrieved.version) !== requestedVersion) {
                    results.push({ ...record, requested_version: requestedVersion, resolved_version: text(retrieved.version), status: 'source_version_conflict' });
                    continue;
                }
                const observedHash = contentHash(retrieved.content);
                const declaredHash = text(retrieved.content_hash);
                if ((declaredHash && declaredHash !== observedHash)
                    || (record.source.content_hash && record.source.content_hash !== observedHash)) {
                    results.push({
                        ...record,
                        requested_version: requestedVersion,
                        resolved_version: text(retrieved.version),
                        status: 'source_hash_conflict',
                        expected_content_hash: record.source.content_hash || declaredHash,
                        observed_content_hash: observedHash,
                        ...(declaredHash ? { declared_content_hash: declaredHash } : {})
                    });
                    continue;
                }
                results.push({
                    ...record,
                    requested_version: requestedVersion,
                    resolved_version: record.version,
                    status: 'resolved',
                    content: retrieved.content,
                    content_hash: observedHash,
                    retrieval_receipt_id: retrieved.receipt_id
                });
            } catch (error) {
                if (error instanceof KnowledgeCatalogError && error.status === 404) {
                    results.push({ id, requested_version: requestedVersion, status: 'not_found' });
                    continue;
                }
                throw error;
            }
        }
        return { project_code: projectCode, results };
    }

    async captureProposal(access, input = {}) {
        const projectCode = text(input.project_code);
        requireProjectAccess(access, projectCode);
        const content = text(input.content) || text(input.source_text) || text(input.text);
        if (!content) {
            throw new KnowledgeCatalogError(
                'knowledge_capture_content_required',
                'capture content is required',
                400
            );
        }
        if (!this.captureProposalAdapter) {
            throw new KnowledgeCatalogError(
                'knowledge_capture_proposal_unavailable',
                'knowledge capture proposal adapter is not configured',
                503
            );
        }

        const rawRefs = input.source_refs ?? input.refs ?? [];
        if (!Array.isArray(rawRefs)) {
            throw new KnowledgeCatalogError(
                'knowledge_capture_refs_invalid',
                'source_refs must be an array',
                400
            );
        }
        const retrieval = rawRefs.length
            ? await this.retrieve(access, { project_code: projectCode, refs: rawRefs })
            : { project_code: projectCode, results: [] };
        const resolved = retrieval.results.filter((result) => result.status === 'resolved'
            && text(result.content)
            && referenceVersion(result.resolved_version || result.version));
        const exclusions = retrieval.results
            .filter((result) => result.status !== 'resolved')
            .map((result) => ({
                id: result.id || null,
                version: result.requested_version || null,
                reason: result.status || 'unknown'
            }));
        const authorizedReferences = new Set(resolved.map((result) => referenceKey(
            result.id,
            referenceVersion(result.resolved_version || result.version)
        )));
        const materials = resolved.map((result) => ({
            id: result.id,
            version: referenceVersion(result.resolved_version || result.version),
            title: result.title || null,
            summary: result.summary || null,
            content: result.content,
            source: result.source || null,
            retrieval_receipt_id: result.retrieval_receipt_id || null
        }));

        let rawProposal;
        try {
            rawProposal = await this.captureProposalAdapter({
                project_code: projectCode,
                content,
                source_text: content,
                source_refs: materials.map((material) => ({
                    id: material.id,
                    version: material.version
                })),
                materials,
                exclusions,
                access
            });
        } catch (error) {
            throw adapterError(error, {
                invalidCode: 'knowledge_capture_adapter_invalid',
                unavailableCode: 'knowledge_capture_provider_failed',
                invalidMessage: 'Knowledge capture adapter contract is invalid',
                unavailableMessage: 'Knowledge capture provider is unavailable'
            });
        }

        let proposal;
        try {
            proposal = validateCaptureProposal(rawProposal, {
                allowedReferences: authorizedReferences
            });
        } catch (error) {
            throw adapterError(error, {
                invalidCode: 'knowledge_capture_adapter_invalid',
                unavailableCode: 'knowledge_capture_provider_failed',
                invalidMessage: 'Knowledge capture adapter contract is invalid',
                unavailableMessage: 'Knowledge capture provider is unavailable'
            });
        }
        const relationRefs = relationReferences(proposal.proposal.relations, 'proposal.relations');
        const unauthorizedRelation = relationRefs.find((reference) => (
            !reference.version
            || !authorizedReferences.has(referenceKey(reference.id, reference.version))
        ));
        if (unauthorizedRelation) {
            throw new KnowledgeCatalogError(
                'knowledge_capture_adapter_invalid',
                'capture proposal relation references an unavailable catalog item',
                502,
                unauthorizedRelation
            );
        }

        const unknown = [
            ...proposal.unknown,
            {
                kind: 'canonical_persistence',
                state: 'unknown',
                reason: 'capture_proposal_not_persisted'
            },
            ...exclusions.map((exclusion) => ({
                kind: 'catalog_reference',
                state: 'unknown',
                ...exclusion
            }))
        ];
        const readback = {
            state: 'proposal_only',
            verified: false,
            source: 'knowledge.capture.proposal',
            authorized_references: materials.map((material) => ({
                id: material.id,
                version: material.version,
                retrieval_receipt_id: material.retrieval_receipt_id
            })),
            provider_claim: { ...proposal.readback, verified: false }
        };
        const version = {
            adapter: proposal.version,
            authorized_references: materials.map((material) => ({
                id: material.id,
                version: material.version
            }))
        };
        return {
            state: 'proposed',
            canonical: false,
            persisted: false,
            project_code: projectCode,
            source: {
                kind: 'capture_input',
                content_state: 'provided',
                content_hash: contentHash(content)
            },
            proposal: proposal.proposal,
            evidence: [
                {
                    id: 'capture-input',
                    version: contentHash(content),
                    source_ref: `capture-input:${contentHash(content)}`,
                    state: 'provided'
                },
                ...proposal.evidence.map((entry) => {
                    const material = materials.find((candidate) => candidate.id === entry.id
                        && candidate.version === entry.version);
                    return {
                        ...entry,
                        source_ref: material?.retrieval_receipt_id || null,
                        state: material?.retrieval_receipt_id ? 'retrieved' : 'unknown'
                    };
                })
            ],
            unknown,
            version,
            readback,
            exclusions
        };
    }

    async capture(access, input = {}) {
        return this.captureProposal(access, input);
    }

    async preview(access, input = {}) {
        const projectCode = text(input.project_code);
        const question = text(input.question);
        const draft = input.draft && typeof input.draft === 'object' ? input.draft : null;
        requireProjectAccess(access, projectCode);
        if (!question || !draft) {
            throw new KnowledgeCatalogError('knowledge_preview_input_required', 'question and draft are required', 400);
        }
        const draftVersion = text(input.draft_version) || text(draft.version);
        if (!draftVersion) {
            throw new KnowledgeCatalogError('knowledge_preview_version_required', 'draft_version is required', 400);
        }
        const draftContent = text(draft.content) || text(draft.body) || text(draft.text);
        if (!draftContent) {
            throw new KnowledgeCatalogError(
                'knowledge_preview_draft_content_required',
                'draft content is required for preview',
                400
            );
        }
        if (!this.previewAnswerer) {
            throw new KnowledgeCatalogError(
                'knowledge_preview_answerer_unavailable',
                'knowledge preview answerer is not configured',
                503
            );
        }

        const catalog = await this.list(access, {
            project_code: projectCode,
            q: question,
            status: 'active',
            limit: Math.min(safeLimit(input.limit), 50)
        });
        const draftCandidate = {
            id: text(draft.id) || 'isolated-draft',
            version: draftVersion,
            title: text(draft.title),
            summary: text(draft.summary),
            content: draftContent,
            source: { kind: 'isolated_draft', content_state: 'fetched', pointer: null },
            applicability: { state: 'unconfirmed', conditions: draft.applicability_conditions ?? null }
        };
        if (catalog.records.some((record) => record.id === draftCandidate.id)) {
            throw new KnowledgeCatalogError(
                'knowledge_preview_draft_reference_conflict',
                'draft id conflicts with a catalog candidate',
                400,
                { id: draftCandidate.id }
            );
        }

        const catalogRefs = catalog.records
            .map(candidateReference)
            .filter(Boolean);
        const retrieval = catalogRefs.length
            ? await this.retrieve(access, { project_code: projectCode, refs: catalogRefs })
            : { project_code: projectCode, results: [] };
        const retrievalByReference = new Map(retrieval.results.map((result) => [
            referenceKey(result.id, referenceVersion(result.requested_version || result.resolved_version)),
            result
        ]));
        const resolvedCandidates = [];
        const exclusions = [];
        const unknownCandidates = [];
        for (const record of catalog.records) {
            const reference = candidateReference(record);
            const result = reference ? retrievalByReference.get(reference.key) : null;
            if (result?.status === 'resolved' && text(result.content)) {
                resolvedCandidates.push({
                    ...record,
                    content: result.content,
                    content_hash: result.content_hash || result.canonical_content_hash || null,
                    source: result.source,
                    retrieval_receipt_id: result.retrieval_receipt_id || null
                });
                continue;
            }
            const reason = result?.status || 'candidate_version_unknown';
            const exclusion = {
                id: record.id,
                version: record.version || null,
                reason
            };
            exclusions.push(exclusion);
            unknownCandidates.push({ kind: 'catalog_candidate', state: 'unknown', ...exclusion });
        }

        const answerCandidates = [draftCandidate, ...resolvedCandidates];
        const allowedReferences = new Set(answerCandidates
            .map(candidateReference)
            .filter(Boolean)
            .map((reference) => reference.key));
        let rawAnswer;
        try {
            rawAnswer = await this.previewAnswerer({
                project_code: projectCode,
                question,
                scenario: input.scenario || null,
                draft: draftCandidate,
                candidates: answerCandidates,
                exclusions,
                access
            });
        } catch (error) {
            throw adapterError(error, {
                invalidCode: 'knowledge_preview_adapter_invalid',
                unavailableCode: 'knowledge_preview_provider_failed',
                invalidMessage: 'Knowledge preview adapter contract is invalid',
                unavailableMessage: 'Knowledge preview provider is unavailable'
            });
        }
        let answer;
        try {
            answer = validatePreviewAnswer(rawAnswer, { allowedReferences });
        } catch (error) {
            throw adapterError(error, {
                invalidCode: 'knowledge_preview_adapter_invalid',
                unavailableCode: 'knowledge_preview_provider_failed',
                invalidMessage: 'Knowledge preview adapter contract is invalid',
                unavailableMessage: 'Knowledge preview provider is unavailable'
            });
        }

        const draftReferenceKey = referenceKey(draftCandidate.id, draftCandidate.version);
        const citedCatalogReferences = answer.citations
            .filter((citation) => referenceKey(citation.id, citation.version) !== draftReferenceKey);
        const canonicalReadback = citedCatalogReferences.map((citation) => {
            const result = retrievalByReference.get(referenceKey(citation.id, citation.version));
            return {
                id: citation.id,
                version: citation.version,
                status: result?.status || 'unknown',
                retrieval_receipt_id: result?.retrieval_receipt_id || null
            };
        });
        const canonicalVerified = canonicalReadback.length > 0
            && canonicalReadback.every((reference) => reference.status === 'resolved'
                && reference.retrieval_receipt_id);
        const readback = {
            state: canonicalVerified ? 'verified' : 'isolated_draft',
            verified: canonicalVerified,
            source: 'knowledge.catalog.retrieve',
            refs: canonicalReadback,
            provider_claim: { ...answer.readback, verified: false }
        };
        const evidence = [
            ...answer.evidence.map((entry) => {
                const isDraft = referenceKey(entry.id, entry.version) === draftReferenceKey;
                const canonical = retrievalByReference.get(referenceKey(entry.id, entry.version));
                return {
                    ...entry,
                    source_ref: isDraft
                        ? `isolated-draft:${draftCandidate.id}:${draftCandidate.version}`
                        : canonical?.retrieval_receipt_id || null,
                    state: isDraft ? 'isolated' : canonical?.retrieval_receipt_id ? 'retrieved' : 'unknown'
                };
            })
        ];
        const unknown = [
            ...answer.unknown,
            ...unknownCandidates,
            ...(canonicalVerified ? [] : [{
                kind: 'canonical_readback',
                state: 'unknown',
                reason: 'preview_is_not_canonical'
            }])
        ];
        const version = {
            adapter: answer.version,
            draft: { id: draftCandidate.id, version: draftCandidate.version },
            candidates: resolvedCandidates.map((candidate) => ({
                id: candidate.id,
                version: candidate.version
            }))
        };
        const mergedExclusions = [...exclusions, ...answer.exclusions];
        const executedResult = {
            state: 'completed',
            answer: answer.answer,
            citations: answer.citations,
            evidence,
            unknown,
            version,
            readback,
            exclusions: mergedExclusions
        };
        return {
            isolation: 'draft_only',
            project_code: projectCode,
            draft_version: draftVersion,
            sample_answer: text(input.sample_answer),
            answer: answer.answer,
            citations: answer.citations,
            executed_result: executedResult,
            candidates: answerCandidates.map(publicCandidate),
            exclusions: mergedExclusions,
            evidence,
            unknown,
            version,
            readback,
            applicability_guaranteed: false
        };
    }

    async save(access, input = {}) {
        const projectCode = text(input.project_code);
        requireProjectAccess(access, projectCode);

        let resolution;
        try {
            resolution = this.knowledgeResolutionService.resolve({
                intent: input.intent,
                audience: input.audience,
                project_code: projectCode,
                content_type: input.content_type
            });
        } catch (error) {
            if (error instanceof TypeError) {
                throw new KnowledgeCatalogError('knowledge_document_resolution_invalid', error.message, 400);
            }
            throw error;
        }

        if (resolution.source_class !== 'owning_repo' || resolution.content_type !== 'team_document') {
            throw new KnowledgeCatalogError(
                'knowledge_document_route_invalid',
                'team_document must resolve to the owning repository before it can be saved',
                422
            );
        }
        if (!this.documentWriter || typeof this.documentWriter.save !== 'function') {
            throw new KnowledgeCatalogError(
                'knowledge_document_writer_not_configured',
                'canonical document writer is not configured',
                503
            );
        }

        try {
            return await this.documentWriter.save({
                ...input,
                project_code: projectCode,
                access,
                resolution
            });
        } catch (error) {
            if (error?.name === 'CanonicalDocumentWriterError' && error.code) {
                throw new KnowledgeCatalogError(error.code, error.message, error.status || 503, error.details || {});
            }
            throw error;
        }
    }
}

export const knowledgeCatalogInternals = { mapRecord, lifecycle, source, requireProjectAccess };
