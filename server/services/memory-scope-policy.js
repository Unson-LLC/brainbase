const ROLE_RANK = {
    member: 1,
    gm: 2,
    ceo: 3
};

function toList(value) {
    if (Array.isArray(value)) {
        return value.map(item => String(item).trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
        return value.split(',').map(item => item.trim()).filter(Boolean);
    }
    return [];
}

function firstString(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
}

function parsePayload(record) {
    if (!record || typeof record !== 'object') return {};
    const payload = record.payload;
    if (typeof payload === 'string') {
        try {
            return JSON.parse(payload);
        } catch {
            return {};
        }
    }
    if (payload && typeof payload === 'object') {
        return payload;
    }
    return record;
}

function normalizeRole(role) {
    return typeof role === 'string' ? role.trim().toLowerCase() : '';
}

function maxRoleRank(roles) {
    return roles.reduce((rank, role) => Math.max(rank, ROLE_RANK[normalizeRole(role)] || 0), 0);
}

export function normalizeMemoryAccessContext(input = {}) {
    const roles = [
        ...toList(input.roles),
        ...toList(input.role)
    ].map(normalizeRole).filter(Boolean);
    const projectCodes = [
        ...toList(input.project_codes),
        ...toList(input.projectCodes)
    ];
    const clearance = [
        ...toList(input.clearance),
        ...toList(input.sensitivities),
        ...toList(input.sensitivity)
    ].map(item => item.toLowerCase());

    return {
        person_id: firstString(input.person_id, input.personId),
        workspace: firstString(input.workspace),
        channel_id: firstString(input.channel_id, input.channelId),
        session_id: firstString(input.session_id, input.sessionId),
        roles,
        role_rank: maxRoleRank(roles),
        project_codes: Array.from(new Set(projectCodes)),
        clearance: Array.from(new Set(clearance))
    };
}

export function normalizeMemoryRecord(record) {
    const payload = parsePayload(record);
    return {
        id: firstString(payload.memory_candidate_id, payload.candidate_id, record?.id),
        visibility: firstString(payload.visibility) || 'unknown',
        owner_person_id: firstString(payload.owner_person_id, payload.ownerPersonId),
        workspace: firstString(payload.workspace, record?.workspace),
        channel_id: firstString(payload.channel_id, payload.channelId, record?.channel_id, record?.channelId),
        project_code: firstString(payload.project_code, payload.projectCode, record?.project_code, record?.projectCode),
        role_min: normalizeRole(firstString(payload.role_min, payload.roleMin, record?.role_min, record?.roleMin) || 'member'),
        sensitivity: firstString(payload.sensitivity, record?.sensitivity) || 'internal'
    };
}

function hasRequiredPolicy(context) {
    return Boolean(
        context.person_id
        && context.roles.length > 0
        && context.project_codes.length > 0
        && context.clearance.length > 0
    );
}

export function evaluateMemoryScope(record, rawContext = {}) {
    const context = normalizeMemoryAccessContext(rawContext);
    const memory = normalizeMemoryRecord(record);
    const resultBase = {
        id: memory.id,
        visibility: memory.visibility,
        reason: null
    };

    if (!hasRequiredPolicy(context)) {
        return { ...resultBase, allowed: false, reason: 'missing_access_policy' };
    }
    if (!memory.id || memory.visibility === 'unknown') {
        return { ...resultBase, allowed: false, reason: 'invalid_memory_record' };
    }
    if (memory.workspace && context.workspace && memory.workspace !== context.workspace) {
        return { ...resultBase, allowed: false, reason: 'workspace_mismatch' };
    }
    if (memory.project_code && !context.project_codes.includes(memory.project_code)) {
        return { ...resultBase, allowed: false, reason: 'project_mismatch' };
    }
    if (memory.channel_id && context.channel_id && memory.channel_id !== context.channel_id) {
        return { ...resultBase, allowed: false, reason: 'channel_mismatch' };
    }

    const sensitivity = memory.sensitivity.toLowerCase();
    if (!context.clearance.includes(sensitivity)) {
        return { ...resultBase, allowed: false, reason: 'sensitivity_denied' };
    }
    if (context.role_rank < (ROLE_RANK[memory.role_min] || ROLE_RANK.member)) {
        return { ...resultBase, allowed: false, reason: 'role_denied' };
    }

    if (memory.visibility === 'private' || memory.visibility === 'owner') {
        const elevatedContext = context.roles.includes('gm') || context.roles.includes('ceo');
        if (memory.owner_person_id !== context.person_id || elevatedContext) {
            return { ...resultBase, allowed: false, reason: 'private_scope_denied' };
        }
        return { ...resultBase, allowed: true };
    }

    if (memory.visibility === 'project' || memory.visibility === 'role' || memory.visibility === 'team' || memory.visibility === 'org' || memory.visibility === 'public') {
        return { ...resultBase, allowed: true };
    }

    return { ...resultBase, allowed: false, reason: 'visibility_denied' };
}

export function buildScopedMemoryResult(records = [], context = {}) {
    const allowed = [];
    const denied = [];
    for (const record of records) {
        const evaluation = evaluateMemoryScope(record, context);
        if (evaluation.allowed) {
            allowed.push(record);
        } else {
            denied.push(evaluation);
        }
    }

    return {
        mode: 'deny_by_default',
        records: allowed,
        denied,
        meta: {
            evaluated_count: records.length,
            returned_count: allowed.length,
            denied_count: denied.length
        }
    };
}

export function filterScopedMemoryRecords(records = [], context = {}) {
    return buildScopedMemoryResult(records, context).records;
}
