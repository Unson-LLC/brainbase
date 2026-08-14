const DEFAULT_PERSONAL_KG_OWNER_PERSON_ID = 'sato_keigo';

function toList(value) {
    if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
    if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
    return [];
}

export function personalKgOwnerConfig(env = {}) {
    const ownerPersonId = env.BRAINBASE_PERSONAL_KG_OWNER_PERSON_ID || DEFAULT_PERSONAL_KG_OWNER_PERSON_ID;
    return {
        ownerPersonId,
        aliasIds: new Set(toList(env.BRAINBASE_PERSONAL_KG_OWNER_ALIAS_IDS))
    };
}

export function canonicalPersonalKgOwner(ownerPersonId, env = {}) {
    if (!ownerPersonId) return ownerPersonId;
    const config = personalKgOwnerConfig(env);
    return ownerPersonId === config.ownerPersonId || config.aliasIds.has(ownerPersonId)
        ? config.ownerPersonId
        : ownerPersonId;
}

export function isConfiguredPersonalKgOwner(ownerPersonId, env = {}) {
    if (!ownerPersonId) return false;
    const config = personalKgOwnerConfig(env);
    return ownerPersonId === config.ownerPersonId || config.aliasIds.has(ownerPersonId);
}

export function canonicalPersonalKgAccess(access, env = {}) {
    if (!access) return access;
    const personId = access.personId || access.person_id || null;
    const canonicalPersonId = canonicalPersonalKgOwner(personId, env);
    if (!canonicalPersonId || canonicalPersonId === personId) return access;
    return {
        ...access,
        personId: canonicalPersonId,
        ...(Object.hasOwn(access, 'person_id') ? { person_id: canonicalPersonId } : {})
    };
}
