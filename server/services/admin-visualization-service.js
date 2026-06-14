// @ts-check

const SOURCE_CLASSES = Object.freeze({
    GRAPH: 'graph_ssot',
    CANDIDATE: 'candidate_store',
    CONTEXT: 'ai_context',
    DERIVED: 'derived_index',
    RUNTIME: 'runtime_config'
});

const RUNTIME_KEYS = ['INFO_SSOT_DATABASE_URL', 'INFO_SSOT_DB_URL', 'AUTH_SESSION_SECRET', 'CANDIDATE_STORE_ALLOWED_SOURCES', 'BRAINBASE_PORT', 'BRAINBASE_VAR_DIR'];
const DERIVED_INDEX_KEYS = ['LIGHTRAG_URL', 'LIGHTRAG_BASE_URL', 'LIGHTRAG_API_URL'];
const SECRET_PATTERNS = [
    /postgres(?:ql)?:\/\/[^\s"'<>]+/ig,
    /Bearer\s+[A-Za-z0-9._~+/-]+=*/ig,
    /bbsvc_[A-Za-z0-9._-]+/ig,
    /\b(?:xox[abprs]-|ghp_|github_pat_|sk-(?:proj-)?)[A-Za-z0-9._-]{12,}\b/g,
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    /(["'](?:access_token|refresh_token|id_token|client_secret|clientSecret|api_key|apiKey|hmac_secret|hmacSecret|oauth_token|oauthToken|jwt|password|secret|private_key|privateKey)["']\s*:\s*)["'][^"']+["']/ig,
    /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g
];
const ROLE_RANK = Object.freeze({ public: 0, member: 1, gm: 2, ceo: 3 });

function hasMethod(service, method) {
    return service && typeof service[method] === 'function';
}

function limit(value, fallback = 100, max = 500) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), max) : fallback;
}

function parsePayload(payload) {
    if (!payload) return {};
    if (typeof payload === 'string') {
        try { return JSON.parse(payload); } catch { return {}; }
    }
    return typeof payload === 'object' ? payload : {};
}

export function scrubSecretValue(value) {
    let text = String(value ?? '');
    for (const pattern of SECRET_PATTERNS) {
        text = text.replace(pattern, (match, keyPrefix) => typeof keyPrefix === 'string' ? `${keyPrefix}"[masked]"` : '[masked]');
    }
    return text;
}

function preview(value, max = 280) {
    const text = scrubSecretValue(typeof value === 'string' ? value : JSON.stringify(value ?? ''));
    return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function accessSafe(access = {}) {
    return {
        role: access.role || 'member',
        projectCodes: Array.isArray(access.projectCodes) ? access.projectCodes : [],
        teamIds: Array.isArray(access.teamIds) ? access.teamIds : Array.isArray(access.team_ids) ? access.team_ids : [],
        orgIds: Array.isArray(access.orgIds) ? access.orgIds : Array.isArray(access.org_ids) ? access.org_ids : [],
        clearance: Array.isArray(access.clearance) && access.clearance.length ? access.clearance : ['internal'],
        personId: access.personId || null
    };
}

function roleRank(role) {
    return ROLE_RANK[String(role || 'member').toLowerCase()] ?? ROLE_RANK.member;
}

function toList(value) {
    if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
    if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
    return [];
}

function candidateProjectCodes(record) {
    return Array.from(new Set([
        record?.project_code,
        record?.projectCode,
        ...toList(record?.project_codes),
        ...toList(record?.projectCodes),
        ...toList(record?.project_ids),
        ...toList(record?.projectIds)
    ].filter(Boolean)));
}

function hasProjectAccess(record, access) {
    const candidateProjects = candidateProjectCodes(record);
    if (!candidateProjects.length) return true;
    return candidateProjects.some((project) => access.projectCodes.includes(project));
}

function canReadCandidate(record, access) {
    if (!record) return false;
    const visibility = String(record.visibility || 'owner').toLowerCase();
    const ownerPersonId = record.owner_person_id || record.ownerPersonId || null;
    const recommendedOwnerPersonId = record.recommended_owner_person_id || record.recommendedOwnerPersonId || null;
    const roleAllowed = roleRank(access.role) >= roleRank(record.role_min || 'member');
    const sensitivityAllowed = !record.sensitivity || access.clearance.includes(record.sensitivity);
    if (!roleAllowed || !sensitivityAllowed) return false;
    if (ownerPersonId && ownerPersonId === access.personId) return true;
    if (recommendedOwnerPersonId && recommendedOwnerPersonId === access.personId) return true;
    if (visibility === 'public') return true;
    if (visibility === 'team' && record.team_id && access.teamIds.includes(record.team_id)) return true;
    if (visibility === 'org') {
        const orgIds = toList(record.org_ids || record.orgIds);
        if (orgIds.length && orgIds.some((orgId) => access.orgIds.includes(orgId))) return true;
    }
    if (['project', 'team', 'org', 'role'].includes(visibility)) return hasProjectAccess(record, access);
    return false;
}

function candidateQueryFilter(access, filters) {
    return {
        promotion_status: filters.status || null,
        cognitive_type: filters.type || null
    };
}

function boolInput(value, defaultValue = false) {
    if (value === undefined || value === null || value === '') return defaultValue;
    if (typeof value === 'boolean') return value;
    return !['false', '0', 'no', 'off'].includes(String(value).toLowerCase());
}

function graphLabel(record) {
    const payload = parsePayload(record?.payload);
    return payload.name || payload.title || payload.code || payload.role_code || payload.summary || record?.id || 'unknown';
}

function countBy(records, key) {
    return records.reduce((acc, record) => {
        const value = record?.[key] || 'unknown';
        acc[value] = (acc[value] || 0) + 1;
        return acc;
    }, {});
}

export class AdminVisualizationService {
    constructor({ infoSSOTService = null, candidateRepository = null, env = process.env, clock = () => new Date() } = {}) {
        this.infoSSOTService = infoSSOTService;
        this.candidateRepository = candidateRepository;
        this.env = env;
        this.clock = clock;
    }

    async getOverview(access = {}) {
        const [graph, candidates, health] = await Promise.all([
            this.listGraphEntities(access, { limit: 500 }),
            this.listCandidates(access, { limit: 500 }),
            this.getHealth(access)
        ]);
        return {
            generated_at: this.clock().toISOString(),
            locale: { default: 'ja', fallback: 'ja' },
            sources: health.sources,
            graph: { source_class: SOURCE_CLASSES.GRAPH, status: graph.status, total: graph.records.length, counts_by_type: countBy(graph.records, 'entity_type') },
            candidates: { source_class: SOURCE_CLASSES.CANDIDATE, status: candidates.status, total: candidates.records.length, counts_by_promotion_status: countBy(candidates.records, 'promotion_status'), counts_by_redaction_status: countBy(candidates.records, 'redaction_status') },
            derived_indexes: health.derived_indexes,
            runtime_config: health.runtime_config
        };
    }

    async listGraphEntities(access = {}, filters = {}) {
        if (!hasMethod(this.infoSSOTService, 'listGraphEntities')) return { source_class: SOURCE_CLASSES.GRAPH, status: 'unavailable', reason: 'InfoSSOTService is not configured', records: [] };
        try {
            const rows = await this.infoSSOTService.listGraphEntities(accessSafe(access), { projectCode: filters.project || null, entityType: filters.type || null, limit: limit(filters.limit) });
            const q = String(filters.q || '').toLowerCase();
            const records = rows
                .filter((record) => !filters.id || record.id === filters.id)
                .filter((record) => !q || [record.id, record.entity_type, record.project_code, graphLabel(record), JSON.stringify(parsePayload(record.payload))].join(' ').toLowerCase().includes(q))
                .slice(0, limit(filters.limit))
                .map((record) => this.normalizeGraphRecord(record));
            return { source_class: SOURCE_CLASSES.GRAPH, status: 'available', records };
        } catch (error) {
            return { source_class: SOURCE_CLASSES.GRAPH, status: 'unavailable', reason: error?.message || 'Graph unavailable', records: [] };
        }
    }

    async listCandidates(access = {}, filters = {}) {
        if (!hasMethod(this.candidateRepository, 'list')) return { source_class: SOURCE_CLASSES.CANDIDATE, status: 'unavailable', reason: 'candidateRepository is not configured', records: [] };
        const safeAccess = accessSafe(access);
        if (!safeAccess.personId) {
            return { source_class: SOURCE_CLASSES.CANDIDATE, status: 'available', records: [], warnings: ['personIdがないため候補ストアは表示しません'] };
        }
        try {
            const rows = await this.candidateRepository.list(candidateQueryFilter(safeAccess, filters));
            const records = rows
                .filter((record) => canReadCandidate(record, safeAccess))
                .filter((record) => !filters.id || record.id === filters.id)
                .filter((record) => !filters.project || candidateProjectCodes(record).includes(filters.project))
                .filter((record) => !filters.redaction || record.redaction_status === filters.redaction)
                .slice(0, limit(filters.limit))
                .map((record) => this.normalizeCandidateRecord(record));
            return { source_class: SOURCE_CLASSES.CANDIDATE, status: 'available', records, warnings: [] };
        } catch (error) {
            return { source_class: SOURCE_CLASSES.CANDIDATE, status: 'unavailable', reason: error?.message || 'candidate-store unavailable', records: [] };
        }
    }

    async previewContext(access = {}, input = {}) {
        if (!hasMethod(this.infoSSOTService, 'getContext')) return { source_class: SOURCE_CLASSES.CONTEXT, status: 'unavailable', preview: null, warnings: ['InfoSSOTService is not configured'] };
        const safeAccess = accessSafe(access);
        const projectCode = input.project || safeAccess.projectCodes[0] || 'brainbase';
        const includeEdges = boolInput(input.includeEdges, true);
        const includeMemory = boolInput(input.includeMemory, false);
        const includePhilosophy = boolInput(input.includePhilosophy, true);
        try {
            const contextOptions = {
                projectCode,
                entityTypes: input.entityTypes || 'project,person,org,decision,raci_assignment',
                limit: limit(input.limit, 50, 200),
                humanReadable: true,
                includeEdges,
                includeMemory,
                includePhilosophy,
                scope: input.scope || 'graph',
                objectType: input.objectType || null,
                operation: input.operation || 'read',
                memoryAccessContext: {
                    person_id: safeAccess.personId,
                    roles: [safeAccess.role],
                    project_codes: safeAccess.projectCodes,
                    clearance: safeAccess.clearance
                }
            };
            const warnings = [];
            let effectiveIncludePhilosophy = includePhilosophy;
            let result;
            try {
                result = await this.infoSSOTService.getContext(safeAccess, contextOptions);
            } catch (error) {
                if (!includePhilosophy || !String(error?.message || '').includes('Core philosophy context is not configured')) throw error;
                warnings.push('Graph哲学文脈は未設定のため含めません');
                effectiveIncludePhilosophy = false;
                result = await this.infoSSOTService.getContext(safeAccess, { ...contextOptions, includePhilosophy: false });
            }
            const entityCounts = result?.meta?.entity_count || {};
            const entityTotal = typeof entityCounts === 'number'
                ? entityCounts
                : Object.values(entityCounts).reduce((sum, value) => sum + (Number(value) || 0), 0);
            const denied = result?.scoped_memory?.denied || [];
            const philosophyContext = result?.philosophy_context || null;
            return {
                source_class: SOURCE_CLASSES.CONTEXT,
                status: 'available',
                preview: {
                    project_code: projectCode,
                    entity_count: entityTotal,
                    edge_count: Array.isArray(result?.edges) ? result.edges.length : 0,
                    report_preview: preview(result?.report || '', 1200),
                    included: Object.entries(result?.entities || {}).map(([type, records]) => ({ source_class: SOURCE_CLASSES.CONTEXT, type, count: Array.isArray(records) ? records.length : 0 })),
                    philosophy_context: {
                        included_in_agent_context: Boolean(includePhilosophy && philosophyContext),
                        displayed: false,
                        scope: philosophyContext?.scope || input.scope || 'graph',
                        applied_count: Array.isArray(philosophyContext?.applied_ids) ? philosophyContext.applied_ids.length : 0
                    },
                    memory: {
                        requested: includeMemory,
                        included_count: Array.isArray(result?.scoped_memory?.records) ? result.scoped_memory.records.length : 0,
                        denied_count: denied.length,
                        denied_reasons: countBy(denied, 'reason')
                    },
                    options: { include_edges: includeEdges, include_memory: includeMemory, include_philosophy: includePhilosophy, effective_include_philosophy: effectiveIncludePhilosophy }
                },
                warnings: [...warnings, ...(denied.length ? [`${denied.length}件のmemoryは除外されました`] : [])]
            };
        } catch (error) {
            return { source_class: SOURCE_CLASSES.CONTEXT, status: 'unavailable', preview: null, warnings: [error?.message || 'Context preview is unavailable'] };
        }
    }

    async getDataFlow(access = {}, filters = {}) {
        const [candidateResult, entityResult] = await Promise.all([
            filters.candidate ? this.listCandidates(access, { id: filters.candidate, project: filters.project || null, limit: 1 }) : Promise.resolve(null),
            filters.entity ? this.listGraphEntities(access, { id: filters.entity, project: filters.project || null, limit: 1 }) : Promise.resolve(null)
        ]);
        const steps = [
            {
                source_class: SOURCE_CLASSES.CANDIDATE,
                label: '候補ストア',
                status: filters.candidate ? (candidateResult?.records?.length ? 'available' : 'not_found') : 'not_requested',
                reason: filters.candidate ? (candidateResult?.records?.length ? '候補IDは現在の権限で参照できます' : '候補IDは存在しないか現在の権限では参照できません') : '候補ID未指定'
            },
            {
                source_class: SOURCE_CLASSES.GRAPH,
                label: 'Graph正本',
                status: filters.entity ? (entityResult?.records?.length ? 'available' : 'not_found') : 'not_requested',
                reason: filters.entity ? (entityResult?.records?.length ? '正本IDは現在の権限で参照できます' : '正本IDは存在しないか現在の権限では参照できません') : '正本ID未指定'
            }
        ];
        steps.push({ source_class: SOURCE_CLASSES.CONTEXT, label: 'AI文脈リゾルバ', status: hasMethod(this.infoSSOTService, 'getContext') ? 'available' : 'unavailable' });
        steps.push({ source_class: SOURCE_CLASSES.DERIVED, label: '派生index', status: this.getDerivedIndexHealth().status });
        return { source_class: SOURCE_CLASSES.CONTEXT, generated_at: this.clock().toISOString(), steps };
    }

    async getHealth() {
        const derived = this.getDerivedIndexHealth();
        const runtimeKeys = RUNTIME_KEYS.map((key) => ({ source_class: SOURCE_CLASSES.RUNTIME, key, status: this.env?.[key] ? 'present' : 'missing', value: null, value_redacted: true }));
        return {
            generated_at: this.clock().toISOString(),
            sources: [
                { source_class: SOURCE_CLASSES.GRAPH, label: 'Graph正本', status: hasMethod(this.infoSSOTService, 'listGraphEntities') ? 'available' : 'unavailable' },
                { source_class: SOURCE_CLASSES.CANDIDATE, label: '候補ストア', status: hasMethod(this.candidateRepository, 'list') ? 'available' : 'unavailable' },
                { source_class: SOURCE_CLASSES.CONTEXT, label: 'AI文脈リゾルバ', status: hasMethod(this.infoSSOTService, 'getContext') ? 'available' : 'unavailable' },
                { source_class: SOURCE_CLASSES.DERIVED, label: 'LightRAG / 派生index', status: derived.status },
                { source_class: SOURCE_CLASSES.RUNTIME, label: '設定/実行環境', status: runtimeKeys.some((item) => item.status === 'present') ? 'available' : 'unavailable' }
            ],
            derived_indexes: [derived],
            runtime_config: { source_class: SOURCE_CLASSES.RUNTIME, keys: runtimeKeys }
        };
    }

    getDerivedIndexHealth() {
        const configured_keys = DERIVED_INDEX_KEYS.filter((key) => Boolean(this.env?.[key]));
        return { source_class: SOURCE_CLASSES.DERIVED, id: 'lightrag', label: 'LightRAG', status: configured_keys.length ? 'configured' : 'not_configured', configured_keys, value_redacted: true, note: 'LightRAGは派生indexであり、Brainbaseの正本ではありません。' };
    }

    normalizeGraphRecord(record) {
        return { source_class: SOURCE_CLASSES.GRAPH, id: record?.id || null, entity_type: record?.entity_type || 'unknown', label: graphLabel(record), project_code: record?.project_code || null, sensitivity: record?.sensitivity || null, role_min: record?.role_min || null, created_at: record?.created_at || null, updated_at: record?.updated_at || null, payload_preview: preview(parsePayload(record?.payload), 320) };
    }

    normalizeCandidateRecord(record) {
        return { source_class: SOURCE_CLASSES.CANDIDATE, id: record?.id || null, cognitive_type: record?.cognitive_type || null, source_system: record?.source_system || null, project_code: record?.project_code || null, promotion_status: record?.promotion_status || null, promoted_graph_entity_id: record?.promoted_graph_entity_id || null, redaction_status: record?.redaction_status || null, visibility: record?.visibility || null, sensitivity: record?.sensitivity || null, role_min: record?.role_min || null, confidence: record?.confidence ?? null, requires_approval: Boolean(record?.requires_approval), body_preview: preview(record?.body || '', 360), created_at: record?.created_at || null, updated_at: record?.updated_at || null };
    }
}

export { SOURCE_CLASSES };
