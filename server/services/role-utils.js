const ROLE_RANK = {
    member: 1,
    gm: 2,
    ceo: 3
};

const ROLE_VALUES = Object.keys(ROLE_RANK);
const DEFAULT_ROLE = 'member';

function normalizeRole(role) {
    return typeof role === 'string' ? role.toLowerCase() : '';
}

function ensureRole(role, fallback = DEFAULT_ROLE) {
    const normalized = normalizeRole(role);
    return ROLE_VALUES.includes(normalized) ? normalized : fallback;
}

function getRoleRank(role) {
    return ROLE_RANK[normalizeRole(role)] || 0;
}

function assertValidRole(role) {
    if (!ROLE_VALUES.includes(normalizeRole(role))) {
        throw new Error(`Invalid role: ${role}`);
    }
}

export {
    ROLE_RANK,
    ROLE_VALUES,
    DEFAULT_ROLE,
    normalizeRole,
    ensureRole,
    getRoleRank,
    assertValidRole
};
