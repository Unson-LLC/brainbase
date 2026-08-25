// @ts-check

import {
    canonicalPersonalKgOwner,
    isConfiguredPersonalKgOwner,
    personalKgOwnerConfig
} from './personal-kg-owner.js';

const SOURCE_CLASSES = Object.freeze({
    GRAPH: 'graph_ssot',
    CANDIDATE: 'candidate_store',
    PERSONAL_KG: 'personal_kg',
    CONTEXT: 'ai_context',
    RUNTIME: 'runtime_config'
});

const RUNTIME_KEYS = ['BRAINBASE_ENV_PATH', 'INFO_SSOT_DATABASE_URL', 'INFO_SSOT_DB_URL', 'AUTH_SESSION_SECRET', 'CANDIDATE_STORE_ALLOWED_SOURCES', 'BRAINBASE_PORT', 'BRAINBASE_VAR_DIR'];
const HEALTH_CHECK_TIMEOUT_MS = 1500;
const CANDIDATE_SCAN_LIMIT = 500;
const PERSONAL_KG_INCLUDED_TYPES = new Set(['observation', 'insight', 'claim', 'preference', 'hypothesis', 'experiment', 'result']);
const PERSONAL_KG_EXCLUDED_STATUSES = new Set(['rejected', 'expired']);
const SECRET_PATTERNS = [
    /postgres(?:ql)?:\/\/[^\s"'<>]+/ig,
    /Bearer\s+[A-Za-z0-9._~+/-]+=*/ig,
    /bbsvc_[A-Za-z0-9._-]+/ig,
    /\b(?:(?:xox[a-z]|xapp)-|ghp_|github_pat_|sk-(?:proj-)?)[A-Za-z0-9._-]{12,}\b/ig,
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    /(["'](?:access_token|refresh_token|id_token|client_secret|clientSecret|api_key|apiKey|hmac_secret|hmacSecret|oauth_token|oauthToken|jwt|password|secret|private_key|privateKey)["']\s*:\s*)["'][^"']+["']/ig,
    /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g
];
const ROLE_RANK = Object.freeze({ public: 0, member: 1, gm: 2, ceo: 3 });

function hasMethod(service, method) {
    return service && typeof service[method] === 'function';
}

function limit(value, fallback = 100, max = 500) {
    if (value === undefined || value === null || value === '') return fallback;
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
        personId: access.personId || access.person_id || null,
        organizationId: access.organizationId || access.organization_id || access.tenantId || null
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
        cognitive_type: filters.type || null,
        order_by: 'created_at',
        order_direction: 'desc',
        limit: CANDIDATE_SCAN_LIMIT
    };
}

function personalKgRepositoryFilter(access, ownerPersonId, filters, safeLimit, env = {}) {
    return {
        owner_person_id: ownerPersonId,
        limit: safeLimit,
        memory_layer: filters.layer || null,
        promotion_status: filters.status || null,
        cognitive_type: filters.type || null,
        redaction_status: filters.redaction || null,
        role: access.role,
        clearance: access.clearance,
        bypass_acl: access.personId === 'internal_api',
        owner_read: canInspectPersonalKgOwner(access, ownerPersonId, env),
        cognitive_types: Array.from(PERSONAL_KG_INCLUDED_TYPES)
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

function canInspectPersonalKgOwner(access, ownerPersonId, env = {}) {
    if (!ownerPersonId) return false;
    const canonicalOwner = canonicalPersonalKgOwner(ownerPersonId, env);
    if (access.personId === 'internal_api') return true;
    const config = personalKgOwnerConfig(env);
    return canonicalOwner === config.ownerPersonId
        && (access.personId === config.ownerPersonId || config.aliasIds.has(access.personId));
}

function canSelectPersonalKgOwner(access, ownerPersonId, env = {}) {
    if (!ownerPersonId) return false;
    if (canInspectPersonalKgOwner(access, ownerPersonId, env)) return true;
    return !isConfiguredPersonalKgOwner(ownerPersonId, env) && access.personId === ownerPersonId;
}

function inspectableOwner(access, requestedOwner, env = {}) {
    const config = personalKgOwnerConfig(env);
    if (requestedOwner) return canSelectPersonalKgOwner(access, requestedOwner, env) ? canonicalPersonalKgOwner(requestedOwner, env) : null;
    if (access.personId === 'internal_api') return config.ownerPersonId;
    if (canInspectPersonalKgOwner(access, config.ownerPersonId, env)) return config.ownerPersonId;
    if (access.personId) return access.personId;
    return null;
}

function readPermissionSnapshot(record) {
    return parsePayload(record?.permission_snapshot);
}

function personalKgPolicy(record) {
    const snapshot = readPermissionSnapshot(record);
    return snapshot?.oyasumi_meeting_personal_kg || snapshot?.personal_kg || null;
}

function memoryLayer(record) {
    if (record?.memory_layer) return record.memory_layer;
    const policy = personalKgPolicy(record);
    const snapshot = readPermissionSnapshot(record);
    return policy?.memory_layer || snapshot?.seed?.memory_layer || snapshot?.memory_layer || 'personal_kg_core';
}

function isSnsReady(record) {
    if (typeof record?.sns_ready === 'boolean') return record.sns_ready;
    const snapshot = readPermissionSnapshot(record);
    if (record?.sns_ready === true || snapshot?.sns_ready === true) return true;
    if (memoryLayer(record) === 'sns_ready') return projectionAllowed(snapshot);
    return false;
}

function projectionAllowed(snapshot = {}) {
    for (const source of [
        snapshot?.oyasumi_meeting_personal_kg,
        snapshot?.personal_kg,
        snapshot?.seed,
        snapshot
    ]) {
        if (!source || source.projection_allowed === undefined) continue;
        return !['false', '0', 'no', 'off'].includes(String(source.projection_allowed).toLowerCase());
    }
    return true;
}

function isPersonalKgReadable(record, ownerPersonId, access, env = {}) {
    if (!record || record.owner_person_id !== ownerPersonId) return false;
    if (!['owner', 'private'].includes(record.visibility)) return false;
    if (!PERSONAL_KG_INCLUDED_TYPES.has(record.cognitive_type)) return false;
    if (access.personId === 'internal_api') return true;
    if (canInspectPersonalKgOwner(access, ownerPersonId, env)) return true;
    const roleAllowed = roleRank(access.role) >= roleRank(record.role_min || 'member');
    const sensitivityAllowed = !record.sensitivity || access.clearance.includes(record.sensitivity);
    if (!roleAllowed || !sensitivityAllowed) return false;
    return canReadCandidate(record, access);
}

function applyPersonalKgFilters(records, ownerPersonId, access, filters, env = {}) {
    return records
        .filter((record) => isPersonalKgReadable(record, ownerPersonId, access, env))
        .filter((record) => !filters.layer || memoryLayer(record) === filters.layer)
        .filter((record) => !filters.status || record.promotion_status === filters.status)
        .filter((record) => !filters.type || record.cognitive_type === filters.type)
        .filter((record) => !filters.redaction || record.redaction_status === filters.redaction);
}

function personalKgSummary(records) {
    const reviewRecords = records.filter((record) => record.requires_approval || record.promotion_status === 'pending_approval');
    const agencyNoneRecords = records.filter((record) => record.agency_level === 'none');
    const redactionRecords = records.filter((record) => record.redaction_status === 'needs_redaction');
    const activeRecords = records.filter((record) => !PERSONAL_KG_EXCLUDED_STATUSES.has(record.promotion_status));
        const sortedDates = records
        .flatMap((record) => [record.created_at, record.updated_at])
        .filter(Boolean)
        .sort();
    return {
        total: records.length,
        returned_count: records.length,
        limit: records.length,
        truncated: false,
        active_count: activeRecords.length,
        core_count: records.filter((record) => memoryLayer(record) === 'personal_kg_core').length,
        sns_ready_count: records.filter(isSnsReady).length,
        review_count: reviewRecords.length,
        needs_redaction_count: redactionRecords.length,
        agency_none_count: agencyNoneRecords.length,
        counts_by_cognitive_type: countBy(records, 'cognitive_type'),
        counts_by_promotion_status: countBy(records, 'promotion_status'),
        counts_by_redaction_status: countBy(records, 'redaction_status'),
        counts_by_source_system: countBy(records, 'source_system'),
        counts_by_memory_layer: records.reduce((acc, record) => {
            const layer = memoryLayer(record);
            acc[layer] = (acc[layer] || 0) + 1;
            return acc;
        }, {}),
        latest_seen_at: sortedDates[sortedDates.length - 1] || null
    };
}

function emptyPersonalKgSummary({ limit: summaryLimit = 0 } = {}) {
    return {
        ...personalKgSummary([]),
        limit: summaryLimit
    };
}

function normalizeSummaryObject(summary = {}, { returnedCount = 0, summaryLimit = 0, truncated = false } = {}) {
    const empty = emptyPersonalKgSummary();
    return {
        ...empty,
        ...summary,
        total: Number(summary.total ?? empty.total) || 0,
        returned_count: returnedCount,
        limit: summaryLimit,
        truncated
    };
}

function runtimeHealthStatus(runtimeConfig = {}) {
    const database = runtimeConfig.database || {};
    const keys = Array.isArray(runtimeConfig.keys) ? runtimeConfig.keys : [];
    const checks = Array.isArray(runtimeConfig.checks) ? runtimeConfig.checks : [];
    if (database.status === 'unavailable') return 'unavailable';
    if (checks.some((item) => item.status === 'unavailable')) return 'unavailable';
    if (database.connection_status === 'not_configured') return 'partial';
    if (checks.some((item) => item.status === 'partial')) return 'partial';
    if (keys.length && keys.some((item) => item.status === 'missing')) return 'partial';
    return keys.some((item) => item.status === 'present') || database.status === 'available' ? 'available' : 'unavailable';
}

function withHealthTimeout(promise, message) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(message)), HEALTH_CHECK_TIMEOUT_MS))
    ]);
}

export class AdminVisualizationService {
    constructor({ infoSSOTService = null, candidateRepository = null, env = process.env, clock = () => new Date() } = {}) {
        this.infoSSOTService = infoSSOTService;
        this.candidateRepository = candidateRepository;
        this.env = env;
        this.clock = clock;
    }

    async withPersonalKgRepository(access, ownerPersonId, work) {
        if (!hasMethod(this.candidateRepository, 'transaction')) {
            return work(this.candidateRepository);
        }
        return this.candidateRepository.transaction(work, {
            access: { ...access, personId: ownerPersonId }
        });
    }

    async getOverview(access = {}) {
        const [graph, candidates, personalKg, health] = await Promise.all([
            this.listGraphEntities(access, { limit: 500 }),
            this.listCandidates(access, { limit: 500 }),
            this.listPersonalKg(access, { records: false }),
            this.getHealth(access)
        ]);
        return {
            generated_at: this.clock().toISOString(),
            locale: { default: 'ja', fallback: 'ja' },
            sources: [
                { source_class: SOURCE_CLASSES.GRAPH, label: 'Graph正本', status: graph.status },
                { source_class: SOURCE_CLASSES.CANDIDATE, label: '候補ストア', status: candidates.status },
                { source_class: SOURCE_CLASSES.PERSONAL_KG, label: '個人KG', status: personalKg.status },
                { source_class: SOURCE_CLASSES.CONTEXT, label: 'AI文脈リゾルバ', status: hasMethod(this.infoSSOTService, 'getContext') ? 'available' : 'unavailable' },
                { source_class: SOURCE_CLASSES.RUNTIME, label: '設定/実行環境', status: runtimeHealthStatus(health.runtime_config) }
            ],
            graph: { source_class: SOURCE_CLASSES.GRAPH, status: graph.status, total: graph.records.length, counts_by_type: countBy(graph.records, 'entity_type') },
            candidates: { source_class: SOURCE_CLASSES.CANDIDATE, status: candidates.status, total: candidates.records.length, counts_by_promotion_status: countBy(candidates.records, 'promotion_status'), counts_by_redaction_status: countBy(candidates.records, 'redaction_status'), warnings: candidates.warnings || [], scan_limited: Boolean(candidates.scan_limited) },
            personal_kg: {
                source_class: SOURCE_CLASSES.PERSONAL_KG,
                status: personalKg.status,
                owner_person_id: personalKg.owner_person_id || null,
                total: personalKg.summary?.total || 0,
                summary: personalKg.summary || personalKgSummary([])
            },
            runtime_config: health.runtime_config
        };
    }

    async listGraphEntities(access = {}, filters = {}) {
        if (!hasMethod(this.infoSSOTService, 'listGraphEntities')) return { source_class: SOURCE_CLASSES.GRAPH, status: 'unavailable', reason: 'InfoSSOTService is not configured', records: [] };
        try {
            const rows = await this.infoSSOTService.listGraphEntities(accessSafe(access), { id: filters.id || null, projectCode: filters.project || null, entityType: filters.type || null, limit: filters.id ? 1 : limit(filters.limit) });
            const q = String(filters.q || '').toLowerCase();
            const records = rows
                .filter((record) => !filters.id || record.id === filters.id)
                .filter((record) => !q || [record.id, record.entity_type, record.project_code, graphLabel(record), JSON.stringify(parsePayload(record.payload))].join(' ').toLowerCase().includes(q))
                .slice(0, limit(filters.limit))
                .map((record) => this.normalizeGraphRecord(record));
            return { source_class: SOURCE_CLASSES.GRAPH, status: 'available', records };
        } catch {
            return { source_class: SOURCE_CLASSES.GRAPH, status: 'unavailable', reason: 'Graph正本を取得できません。接続または権限をサーバーログで確認してください', records: [] };
        }
    }

    async listCandidates(access = {}, filters = {}) {
        if (!hasMethod(this.candidateRepository, 'list')) return { source_class: SOURCE_CLASSES.CANDIDATE, status: 'unavailable', reason: 'candidateRepository is not configured', records: [] };
        const safeAccess = accessSafe(access);
        if (!safeAccess.personId) {
            return { source_class: SOURCE_CLASSES.CANDIDATE, status: 'available', records: [], warnings: ['personIdがないため候補ストアは表示しません'] };
        }
        try {
            const queryFilter = candidateQueryFilter(safeAccess, filters);
            const rows = await this.candidateRepository.list(queryFilter);
            const displayLimit = limit(filters.limit);
            const visibleRows = rows
                .filter((record) => canReadCandidate(record, safeAccess))
                .filter((record) => !filters.id || record.id === filters.id)
                .filter((record) => !filters.project || candidateProjectCodes(record).includes(filters.project))
                .filter((record) => !filters.redaction || record.redaction_status === filters.redaction);
            const records = visibleRows
                .slice(0, displayLimit)
                .map((record) => this.normalizeCandidateRecord(record));
            const scanLimited = rows.length >= queryFilter.limit;
            const warnings = [];
            if (scanLimited && visibleRows.length < displayLimit) {
                warnings.push(`候補ストアは最新${queryFilter.limit}件を先読みして権限確認しています。条件に合う古い候補がある可能性があります。状態、種別、projectで絞り込んでください`);
            }
            return {
                source_class: SOURCE_CLASSES.CANDIDATE,
                status: 'available',
                records,
                warnings,
                scan_limit: queryFilter.limit,
                scan_limited: scanLimited,
                pre_acl_count: rows.length,
                post_acl_count: visibleRows.length
            };
        } catch {
            return { source_class: SOURCE_CLASSES.CANDIDATE, status: 'unavailable', reason: '候補ストアを取得できません。接続または権限をサーバーログで確認してください', records: [] };
        }
    }

    async listPersonalKg(access = {}, filters = {}) {
        if (!hasMethod(this.candidateRepository, 'list')) {
            return { source_class: SOURCE_CLASSES.PERSONAL_KG, status: 'unavailable', reason: '候補ストアリポジトリが未設定のため個人KGを取得できません', owner_person_id: null, summary: emptyPersonalKgSummary(), records: [], warnings: [] };
        }
        const safeAccess = accessSafe(access);
        const requestedOwnerPersonId = filters.owner || null;
        const safeLimit = limit(filters.limit, 50, 500);
        if (requestedOwnerPersonId && !canSelectPersonalKgOwner(safeAccess, requestedOwnerPersonId, this.env)) {
            return {
                source_class: SOURCE_CLASSES.PERSONAL_KG,
                status: 'available',
                owner_person_id: null,
                requested_owner_person_id: requestedOwnerPersonId,
                summary: emptyPersonalKgSummary({ limit: safeLimit }),
                records: [],
                warnings: [`指定された所有者(${requestedOwnerPersonId})は現在の権限では表示できません`]
            };
        }
        const ownerPersonId = inspectableOwner(safeAccess, requestedOwnerPersonId, this.env);
        if (!ownerPersonId) {
            return { source_class: SOURCE_CLASSES.PERSONAL_KG, status: 'available', owner_person_id: null, summary: emptyPersonalKgSummary({ limit: safeLimit }), records: [], warnings: ['personIdがないため個人KGは表示しません'] };
        }
        try {
            const repoFilter = personalKgRepositoryFilter(safeAccess, ownerPersonId, filters, safeLimit, this.env);
            return await this.withPersonalKgRepository(safeAccess, ownerPersonId, async (repository) => {
                if (hasMethod(repository, 'summarizePersonalKg')) {
                    const summary = normalizeSummaryObject(await repository.summarizePersonalKg(repoFilter), {
                        returnedCount: 0,
                        summaryLimit: filters.records === false ? 0 : safeLimit,
                        truncated: false
                    });
                    if (filters.records === false) {
                        return {
                            source_class: SOURCE_CLASSES.PERSONAL_KG,
                            status: 'available',
                            owner_person_id: ownerPersonId,
                            summary: { ...summary, returned_count: 0, limit: 0, truncated: false },
                            records: [],
                            warnings: []
                        };
                    }
                    const rows = hasMethod(repository, 'listPersonalKg')
                        ? await repository.listPersonalKg(repoFilter)
                        : await repository.list({ owner_person_id: ownerPersonId, order_by: 'created_at', order_direction: 'desc', limit: 500 });
                    const records = applyPersonalKgFilters(rows, ownerPersonId, safeAccess, filters, this.env)
                        .slice(0, safeLimit)
                        .map((record) => this.normalizePersonalKgRecord(record));
                    summary.returned_count = records.length;
                    summary.limit = safeLimit;
                    summary.truncated = summary.total > records.length;
                    return {
                        source_class: SOURCE_CLASSES.PERSONAL_KG,
                        status: 'available',
                        owner_person_id: ownerPersonId,
                        summary,
                        records,
                        warnings: []
                    };
                }

                const rows = await repository.list({ owner_person_id: ownerPersonId, order_by: 'created_at', order_direction: 'desc', limit: 500 });
                const allRecords = applyPersonalKgFilters(rows, ownerPersonId, safeAccess, filters, this.env)
                    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
                    .map((record) => this.normalizePersonalKgRecord(record));
                const records = filters.records === false ? [] : allRecords.slice(0, safeLimit);
                const summary = personalKgSummary(allRecords);
                summary.returned_count = records.length;
                summary.limit = filters.records === false ? 0 : safeLimit;
                summary.truncated = filters.records === false ? false : allRecords.length > records.length;
                return {
                    source_class: SOURCE_CLASSES.PERSONAL_KG,
                    status: 'available',
                    owner_person_id: ownerPersonId,
                    summary,
                    records,
                    warnings: []
                };
            });
        } catch {
            return { source_class: SOURCE_CLASSES.PERSONAL_KG, status: 'unavailable', reason: '個人KGを取得できません。接続またはクエリをサーバーログで確認してください', owner_person_id: ownerPersonId, summary: emptyPersonalKgSummary({ limit: safeLimit }), records: [], warnings: [] };
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
        } catch {
            return { source_class: SOURCE_CLASSES.CONTEXT, status: 'unavailable', preview: null, warnings: ['AI文脈プレビューを取得できません。接続または権限をサーバーログで確認してください'] };
        }
    }

    async getDataFlow(access = {}, filters = {}) {
        const [candidateResult, entityResult] = await Promise.all([
            filters.candidate ? this.getCandidateByIdForFlow(access, filters.candidate, { project: filters.project || null }) : Promise.resolve(null),
            filters.entity ? this.listGraphEntities(access, { id: filters.entity, project: filters.project || null, limit: 1 }) : Promise.resolve(null)
        ]);
        const candidateUnavailable = candidateResult?.status && candidateResult.status !== 'available';
        const graphUnavailable = entityResult?.status && entityResult.status !== 'available';
        const personalKgReadiness = await this.getPersonalKgReadiness(access);
        const steps = [
            {
                source_class: SOURCE_CLASSES.CANDIDATE,
                label: '候補ストア',
                status: filters.candidate ? (candidateUnavailable ? candidateResult.status : candidateResult?.records?.length ? 'available' : 'not_found') : 'not_requested',
                reason: filters.candidate
                    ? candidateUnavailable
                        ? (candidateResult.reason || '候補ストアを取得できません')
                        : candidateResult?.records?.length ? '候補IDは現在の権限で参照できます' : '候補IDは存在しないか現在の権限では参照できません'
                    : '候補ID未指定'
            },
            {
                source_class: SOURCE_CLASSES.GRAPH,
                label: 'Graph正本',
                status: filters.entity ? (graphUnavailable ? entityResult.status : entityResult?.records?.length ? 'available' : 'not_found') : 'not_requested',
                reason: filters.entity
                    ? graphUnavailable
                        ? (entityResult.reason || 'Graph正本を取得できません')
                        : entityResult?.records?.length ? '正本IDは現在の権限で参照できます' : '正本IDは存在しないか現在の権限では参照できません'
                    : '正本ID未指定'
            }
        ];
        steps.push({ source_class: SOURCE_CLASSES.CONTEXT, label: 'AI文脈リゾルバ', status: hasMethod(this.infoSSOTService, 'getContext') ? 'available' : 'unavailable' });
        steps.push({ source_class: SOURCE_CLASSES.PERSONAL_KG, label: '個人KG', status: personalKgReadiness.status, reason: personalKgReadiness.reason || null });
        return { source_class: SOURCE_CLASSES.CONTEXT, generated_at: this.clock().toISOString(), steps };
    }

    async getCandidateByIdForFlow(access = {}, candidateId, filters = {}) {
        if (!hasMethod(this.candidateRepository, 'findById') && !hasMethod(this.candidateRepository, 'list')) {
            return { source_class: SOURCE_CLASSES.CANDIDATE, status: 'unavailable', reason: 'candidateRepository is not configured', records: [] };
        }
        const safeAccess = accessSafe(access);
        try {
            const row = hasMethod(this.candidateRepository, 'findById')
                ? await this.candidateRepository.findById(candidateId)
                : (await this.candidateRepository.list({ ...candidateQueryFilter(safeAccess, { limit: CANDIDATE_SCAN_LIMIT }), id: candidateId })).find((candidate) => candidate.id === candidateId);
            const visible = row
                && canReadCandidate(row, safeAccess)
                && (!filters.project || candidateProjectCodes(row).includes(filters.project));
            return {
                source_class: SOURCE_CLASSES.CANDIDATE,
                status: 'available',
                records: visible ? [this.normalizeCandidateRecord(row)] : [],
                warnings: []
            };
        } catch {
            return { source_class: SOURCE_CLASSES.CANDIDATE, status: 'unavailable', reason: '候補ストアを取得できません。接続または権限をサーバーログで確認してください', records: [] };
        }
    }

    async getHealth(access = {}) {
        const runtimeKeys = RUNTIME_KEYS.map((key) => ({ source_class: SOURCE_CLASSES.RUNTIME, key, status: this.env?.[key] ? 'present' : 'missing', value: null, value_redacted: true }));
        const [database, personalKgReadiness] = await Promise.all([
            this.getDatabaseHealth(),
            this.getPersonalKgReadiness(access)
        ]);
        const databaseBackedCandidateUnavailable = database.status === 'unavailable' && Boolean(this.candidateRepository?.pool || this.env?.INFO_SSOT_DATABASE_URL || this.env?.INFO_SSOT_DB_URL);
        const databaseConfiguredWithoutClient = database.connection_status === 'not_configured' && Boolean(this.env?.INFO_SSOT_DATABASE_URL || this.env?.INFO_SSOT_DB_URL);
        const candidateStatus = !hasMethod(this.candidateRepository, 'list')
            ? 'unavailable'
            : databaseBackedCandidateUnavailable
                ? 'unavailable'
                : databaseConfiguredWithoutClient
                    ? 'partial'
                    : 'available';
        return {
            generated_at: this.clock().toISOString(),
            sources: [
                { source_class: SOURCE_CLASSES.GRAPH, label: 'Graph正本', status: hasMethod(this.infoSSOTService, 'listGraphEntities') ? 'available' : 'unavailable' },
                { source_class: SOURCE_CLASSES.CANDIDATE, label: '候補ストア', status: candidateStatus },
                { source_class: SOURCE_CLASSES.PERSONAL_KG, label: '個人KG', status: personalKgReadiness.status, reason: personalKgReadiness.reason || null },
                { source_class: SOURCE_CLASSES.CONTEXT, label: 'AI文脈リゾルバ', status: hasMethod(this.infoSSOTService, 'getContext') ? 'available' : 'unavailable' },
                { source_class: SOURCE_CLASSES.RUNTIME, label: '設定/実行環境', status: runtimeHealthStatus({ database, keys: runtimeKeys, checks: [personalKgReadiness] }) }
            ],
            runtime_config: {
                source_class: SOURCE_CLASSES.RUNTIME,
                database,
                checks: [personalKgReadiness],
                keys: runtimeKeys
            }
        };
    }

    async getPersonalKgReadiness(access = {}) {
        if (!hasMethod(this.candidateRepository, 'list')) {
            return { source_class: SOURCE_CLASSES.PERSONAL_KG, label: '個人KG read path', status: 'unavailable', reason: '候補ストアリポジトリが未設定です' };
        }

        const safeAccess = accessSafe(access);
        const ownerPersonId = inspectableOwner(safeAccess, null, this.env);
        if (!ownerPersonId) {
            return { source_class: SOURCE_CLASSES.PERSONAL_KG, label: '個人KG read path', status: 'partial', reason: 'personIdがないため個人KG read pathは未確認です' };
        }

        const repoFilter = personalKgRepositoryFilter(safeAccess, ownerPersonId, {}, 1, this.env);
        try {
            await withHealthTimeout(this.withPersonalKgRepository(safeAccess, ownerPersonId, async (repository) => {
                if (hasMethod(repository, 'summarizePersonalKg')) {
                    await repository.summarizePersonalKg(repoFilter);
                    if (hasMethod(repository, 'listPersonalKg')) {
                        await repository.listPersonalKg(repoFilter);
                    } else {
                        await repository.list({ owner_person_id: ownerPersonId, order_by: 'created_at', order_direction: 'desc', limit: 1 });
                    }
                } else if (hasMethod(repository, 'listPersonalKg')) {
                    await repository.listPersonalKg(repoFilter);
                } else {
                    await repository.list({ owner_person_id: ownerPersonId, order_by: 'created_at', order_direction: 'desc', limit: 1 });
                }
            }), '個人KG read path確認がタイムアウトしました');
            return { source_class: SOURCE_CLASSES.PERSONAL_KG, label: '個人KG read path', status: 'available' };
        } catch {
            return { source_class: SOURCE_CLASSES.PERSONAL_KG, label: '個人KG read path', status: 'unavailable', reason: '個人KG read path確認に失敗しました。migrationまたは権限をサーバーログで確認してください' };
        }
    }

    async getDatabaseHealth() {
        const configured = Boolean(this.env?.INFO_SSOT_DATABASE_URL || this.env?.INFO_SSOT_DB_URL);
        const base = {
            source_class: SOURCE_CLASSES.RUNTIME,
            label: 'DB接続先',
            status: configured ? 'configured' : 'missing',
            connection_status: configured ? 'not_checked' : 'missing',
            keys: ['INFO_SSOT_DATABASE_URL', 'INFO_SSOT_DB_URL'],
            value: null,
            value_redacted: true
        };
        if (!configured) return base;

        const pool = this.candidateRepository?.pool || this.infoSSOTService?.pool || null;
        if (!pool || typeof pool.query !== 'function') {
            return { ...base, status: 'configured', connection_status: 'not_configured', reason: 'DB接続クライアントが未設定です' };
        }

        try {
            await Promise.race([
                pool.query('SELECT 1 AS ok'),
                new Promise((_, reject) => setTimeout(() => reject(new Error('DB接続確認がタイムアウトしました')), HEALTH_CHECK_TIMEOUT_MS))
            ]);
            return { ...base, status: 'available', connection_status: 'connected' };
        } catch {
            return { ...base, status: 'unavailable', connection_status: 'unavailable', reason: 'DB接続確認に失敗しました。接続先または認証情報をサーバーログで確認してください' };
        }
    }

    normalizeGraphRecord(record) {
        const payload = parsePayload(record?.payload);
        const lifecycleStatus = record?.lifecycle_status || record?.lifecycle_state || null;
        return { source_class: SOURCE_CLASSES.GRAPH, id: record?.id || null, entity_type: record?.entity_type || 'unknown', label: graphLabel(record), project_code: record?.project_code || null, sensitivity: record?.sensitivity || null, role_min: record?.role_min || null, lifecycle_status: lifecycleStatus, lifecycle_state: lifecycleStatus, semantic_state: record?.semantic_state || payload.semantic_state || null, version: Number.isInteger(record?.version) ? record.version : null, created_at: record?.created_at || null, updated_at: record?.updated_at || null, payload_preview: preview(payload, 320) };
    }

    normalizeCandidateRecord(record) {
        return { source_class: SOURCE_CLASSES.CANDIDATE, id: record?.id || null, cognitive_type: record?.cognitive_type || null, source_system: record?.source_system || null, project_code: record?.project_code || null, promotion_status: record?.promotion_status || null, promoted_graph_entity_id: record?.promoted_graph_entity_id || null, redaction_status: record?.redaction_status || null, visibility: record?.visibility || null, sensitivity: record?.sensitivity || null, role_min: record?.role_min || null, confidence: record?.confidence ?? null, requires_approval: Boolean(record?.requires_approval), body_preview: preview(record?.body || '', 360), created_at: record?.created_at || null, updated_at: record?.updated_at || null };
    }

    normalizePersonalKgRecord(record) {
        return {
            source_class: SOURCE_CLASSES.PERSONAL_KG,
            id: record?.id || null,
            cognitive_type: record?.cognitive_type || null,
            source_system: record?.source_system || null,
            project_code: record?.project_code || null,
            memory_layer: memoryLayer(record),
            sns_ready: isSnsReady(record),
            promotion_status: record?.promotion_status || null,
            redaction_status: record?.redaction_status || null,
            agency_level: record?.agency_level || null,
            visibility: record?.visibility || null,
            confidence: record?.confidence ?? null,
            requires_approval: Boolean(record?.requires_approval),
            source_event_count: Array.isArray(record?.source_event_ids) ? record.source_event_ids.length : 0,
            body_preview: preview(record?.body || '', 360),
            created_at: record?.created_at || null,
            updated_at: record?.updated_at || null
        };
    }
}

export { SOURCE_CLASSES };
