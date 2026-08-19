function toList(value) {
    if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
    if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
    return [];
}

function normalizePersonId(value, field = 'person_id') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || normalized.length > 200 || /[\u0000-\u001f]/u.test(normalized)) {
        throw new Error(`personal_kg_${field}_invalid`);
    }
    return normalized;
}

function addAlias(aliasToPersonId, canonicalPersonIds, alias, canonical) {
    const normalizedAlias = normalizePersonId(alias, 'alias_id');
    const normalizedCanonical = normalizePersonId(canonical, 'canonical_person_id');
    const existing = aliasToPersonId.get(normalizedAlias);
    if (existing && existing !== normalizedCanonical) {
        throw new Error(`personal_kg_owner_alias_conflict:${normalizedAlias}`);
    }
    aliasToPersonId.set(normalizedAlias, normalizedCanonical);
    aliasToPersonId.set(normalizedCanonical, normalizedCanonical);
    canonicalPersonIds.add(normalizedCanonical);
}

function parseAliasMap(value) {
    const aliasToPersonId = new Map();
    const canonicalPersonIds = new Set();
    if (value === undefined || value === null || value === '') {
        return { aliasToPersonId, canonicalPersonIds };
    }

    let parsed;
    try {
        parsed = typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
        throw new Error('personal_kg_owner_aliases_json_invalid');
    }

    if (Array.isArray(parsed)) {
        for (const entry of parsed) {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                throw new Error('personal_kg_owner_alias_entry_invalid');
            }
            const canonical = entry.canonical_person_id || entry.person_id || entry.personId;
            const aliases = toList(entry.alias_ids || entry.aliasIds || entry.aliases || entry.alias_id || entry.alias);
            if (!canonical || aliases.length === 0) {
                throw new Error('personal_kg_owner_alias_entry_invalid');
            }
            for (const alias of aliases) addAlias(aliasToPersonId, canonicalPersonIds, alias, canonical);
        }
        return { aliasToPersonId, canonicalPersonIds };
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new Error('personal_kg_owner_aliases_json_invalid');
    }

    for (const [key, mapping] of Object.entries(parsed)) {
        if (typeof mapping === 'string') {
            addAlias(aliasToPersonId, canonicalPersonIds, key, mapping);
            continue;
        }
        if (Array.isArray(mapping)) {
            for (const alias of mapping) addAlias(aliasToPersonId, canonicalPersonIds, alias, key);
            continue;
        }
        if (mapping && typeof mapping === 'object') {
            const canonical = mapping.canonical_person_id || mapping.person_id || mapping.personId || key;
            const aliases = toList(mapping.alias_ids || mapping.aliasIds || mapping.aliases || key);
            for (const alias of aliases) addAlias(aliasToPersonId, canonicalPersonIds, alias, canonical);
            continue;
        }
        throw new Error('personal_kg_owner_alias_entry_invalid');
    }
    return { aliasToPersonId, canonicalPersonIds };
}

export function personalKgOwnerConfig(env = {}) {
    const parsed = parseAliasMap(env.BRAINBASE_PERSONAL_KG_OWNER_ALIASES_JSON);
    const aliasToPersonId = new Map(parsed.aliasToPersonId);
    const canonicalPersonIds = new Set(parsed.canonicalPersonIds);

    // Explicit legacy values remain a migration input only. There is deliberately no default owner.
    const legacyOwnerPersonId = typeof env.BRAINBASE_PERSONAL_KG_OWNER_PERSON_ID === 'string'
        && env.BRAINBASE_PERSONAL_KG_OWNER_PERSON_ID.trim()
        ? normalizePersonId(env.BRAINBASE_PERSONAL_KG_OWNER_PERSON_ID, 'canonical_person_id')
        : null;
    const legacyAliasIds = new Set(toList(env.BRAINBASE_PERSONAL_KG_OWNER_ALIAS_IDS));
    if (legacyOwnerPersonId) {
        addAlias(aliasToPersonId, canonicalPersonIds, legacyOwnerPersonId, legacyOwnerPersonId);
        for (const alias of legacyAliasIds) {
            addAlias(aliasToPersonId, canonicalPersonIds, alias, legacyOwnerPersonId);
        }
    } else if (legacyAliasIds.size > 0) {
        throw new Error('personal_kg_legacy_owner_required_for_aliases');
    }

    return {
        ownerPersonId: legacyOwnerPersonId,
        aliasIds: legacyAliasIds,
        aliasToPersonId,
        canonicalPersonIds
    };
}

export function canonicalPersonalKgOwner(ownerPersonId, env = {}) {
    if (!ownerPersonId) return null;
    const normalized = normalizePersonId(ownerPersonId);
    return personalKgOwnerConfig(env).aliasToPersonId.get(normalized) || normalized;
}

export function isConfiguredPersonalKgOwner(ownerPersonId, env = {}) {
    if (!ownerPersonId) return false;
    const normalized = normalizePersonId(ownerPersonId);
    const config = personalKgOwnerConfig(env);
    return config.aliasToPersonId.has(normalized) || config.canonicalPersonIds.has(normalized);
}

export function canonicalPersonalKgAccess(access, env = {}) {
    if (!access) return access;
    const personId = access.personId || access.person_id || null;
    if (!personId) return access;
    const canonicalPersonId = canonicalPersonalKgOwner(personId, env);
    if (!canonicalPersonId || canonicalPersonId === personId) return access;
    return {
        ...access,
        personId: canonicalPersonId,
        ...(Object.hasOwn(access, 'person_id') ? { person_id: canonicalPersonId } : {})
    };
}