const ROLE_RANK = {
    member: 1,
    gm: 2,
    ceo: 3
};

const ROLE_VALUES = Object.keys(ROLE_RANK);

function normalizeRole(role) {
    return typeof role === 'string' ? role.toLowerCase() : '';
}

function getRoleRank(role) {
    return ROLE_RANK[normalizeRole(role)] || 0;
}

function isValidRole(role) {
    return ROLE_VALUES.includes(normalizeRole(role));
}

function assertValidRole(role) {
    if (!isValidRole(role)) {
        throw new Error(`Invalid role: ${role}`);
    }
}

function resolveRole(role, fallback = null) {
    const normalized = normalizeRole(role);
    return ROLE_VALUES.includes(normalized) ? normalized : fallback;
}

export {
    ROLE_RANK,
    ROLE_VALUES,
    normalizeRole,
    getRoleRank,
    assertValidRole,
    resolveRole
};
