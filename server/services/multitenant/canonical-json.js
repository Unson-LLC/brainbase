function normalize(value) {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError('Canonical JSON does not allow non-finite numbers');
        return value;
    }
    if (Array.isArray(value)) return value.map((item) => normalize(item));
    if (typeof value === 'object') {
        return Object.keys(value)
            .sort()
            .reduce((result, key) => {
                const item = value[key];
                if (item === undefined || typeof item === 'function' || typeof item === 'symbol') {
                    throw new TypeError(`Canonical JSON does not allow ${typeof item} at ${key}`);
                }
                result[key] = normalize(item);
                return result;
            }, {});
    }
    throw new TypeError(`Canonical JSON does not allow ${typeof value}`);
}

export function canonicalJson(value) {
    return JSON.stringify(normalize(value));
}

export function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const item of Object.values(value)) deepFreeze(item);
    return Object.freeze(value);
}
