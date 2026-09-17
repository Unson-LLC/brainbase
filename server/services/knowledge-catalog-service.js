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
    const rawStatus = text(payload.status)?.toLowerCase() || 'unknown';
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
        content_state: pointer ? 'pointer_only' : 'unknown'
    };
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
        owner: text(payload.owner_id) || text(payload.owner) || null,
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

export class KnowledgeCatalogService {
    constructor({
        infoSSOTService,
        contentRetriever = null,
        previewAnswerer = null
    }) {
        if (!infoSSOTService) throw new TypeError('infoSSOTService is required');
        this.infoSSOTService = infoSSOTService;
        this.contentRetriever = contentRetriever;
        this.previewAnswerer = previewAnswerer;
    }

    async list(access, input = {}) {
        const projectCode = text(input.project_code);
        requireProjectAccess(access, projectCode);
        const scope = ['project', 'organization', 'all'].includes(input.scope) ? input.scope : 'all';
        const status = ['active', 'inactive', 'all'].includes(input.status) ? input.status : 'active';
        const allowedProjects = new Set([projectCode]);
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
            .filter((entity) => allowedProjects.has(entity.project_code))
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
        const rows = await this.infoSSOTService.listGraphEntities(access, { id, projectCode, limit: 1 });
        const entity = rows.find((row) => row.id === id && ['decision', 'document'].includes(row.entity_type));
        if (!entity || entity.project_code !== projectCode) {
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
            relations: edges.filter((edge) => visibleIds.has(edge.from_id) && visibleIds.has(edge.to_id)).map((edge) => ({
                relation: edge.rel_type,
                from_id: edge.from_id,
                to_id: edge.to_id,
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
        const results = [];
        for (const ref of input.refs.slice(0, 50)) {
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
                results.push({
                    ...record,
                    requested_version: requestedVersion,
                    resolved_version: record.version,
                    status: retrieved?.content ? 'resolved' : 'source_unavailable',
                    content: retrieved?.content || null,
                    retrieval_receipt_id: retrieved?.receipt_id || null
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
        const catalog = await this.list(access, {
            project_code: projectCode,
            q: question,
            status: 'active',
            limit: input.limit
        });
        const draftCandidate = {
            id: text(draft.id) || 'isolated-draft',
            version: draftVersion,
            title: text(draft.title),
            summary: text(draft.summary),
            source: { kind: 'isolated_draft', content_state: 'fetched', pointer: null },
            applicability: { state: 'unconfirmed', conditions: draft.applicability_conditions ?? null }
        };
        const candidates = [draftCandidate, ...catalog.records];
        const answer = typeof this.previewAnswerer === 'function'
            ? await this.previewAnswerer({ question, scenario: input.scenario || null, candidates, access })
            : null;
        return {
            isolation: 'draft_only',
            project_code: projectCode,
            draft_version: draftVersion,
            sample_answer: text(input.sample_answer),
            executed_result: answer ? { state: 'completed', ...answer } : { state: 'unavailable', reason: 'preview_answerer_not_configured' },
            candidates,
            exclusions: [],
            evidence: candidates.map((candidate) => ({ id: candidate.id, version: candidate.version || null, source: candidate.source })),
            applicability_guaranteed: false
        };
    }
}

export const knowledgeCatalogInternals = { mapRecord, lifecycle, source, requireProjectAccess };
