// Moved from brainbase-unson server/services/memory-scope-policy.js without changing behavior.
// Only type annotations were added; memory records stay open JSON objects as in the original.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type MemoryRecordInput = Record<string, any> | null | undefined;
export type MemoryAccessContextInput = Record<string, any>;

export type MemoryAccessContext = {
    person_id: string | null;
    workspace: string | null;
    channel_id: string | null;
    session_id: string | null;
    roles: string[];
    role_rank: number;
    project_codes: string[];
    clearance: string[];
};

export type NormalizedMemoryRecord = {
    id: string | null;
    visibility: string;
    owner_person_id: string | null;
    workspace: string | null;
    channel_id: string | null;
    project_code: string | null;
    role_min: string;
    sensitivity: string;
};

export type MemoryScopeEvaluation = {
    id: string | null;
    visibility: string;
    reason: string | null;
    allowed: boolean;
};

export type ScopedMemoryResult<T> = {
    mode: 'deny_by_default';
    records: T[];
    denied: MemoryScopeEvaluation[];
    meta: { evaluated_count: number; returned_count: number; denied_count: number };
};

const ROLE_RANK: Record<string, number> = {
    member: 1,
    gm: 2,
    ceo: 3
};

function toList(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map(item => String(item).trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
        return value.split(',').map(item => item.trim()).filter(Boolean);
    }
    return [];
}

function firstString(...values: unknown[]): string | null {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
}

function parsePayload(record: MemoryRecordInput): Record<string, any> {
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

function normalizeRole(role: unknown): string {
    return typeof role === 'string' ? role.trim().toLowerCase() : '';
}

function maxRoleRank(roles: string[]): number {
    return roles.reduce((rank, role) => Math.max(rank, ROLE_RANK[normalizeRole(role)] || 0), 0);
}

export function normalizeMemoryAccessContext(input: MemoryAccessContextInput = {}): MemoryAccessContext {
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

export function normalizeMemoryRecord(record: MemoryRecordInput): NormalizedMemoryRecord {
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

function hasRequiredPolicy(context: MemoryAccessContext): boolean {
    return Boolean(
        context.person_id
        && context.roles.length > 0
        && context.project_codes.length > 0
        && context.clearance.length > 0
    );
}

export function evaluateMemoryScope(record: MemoryRecordInput, rawContext: MemoryAccessContextInput = {}): MemoryScopeEvaluation {
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

export function buildScopedMemoryResult<T extends MemoryRecordInput>(records: T[] = [], context: MemoryAccessContextInput = {}): ScopedMemoryResult<T> {
    const allowed: T[] = [];
    const denied: MemoryScopeEvaluation[] = [];
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

export function filterScopedMemoryRecords<T extends MemoryRecordInput>(records: T[] = [], context: MemoryAccessContextInput = {}): T[] {
    return buildScopedMemoryResult(records, context).records;
}
