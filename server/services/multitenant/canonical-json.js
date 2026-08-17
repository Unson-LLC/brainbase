function assertNoLoneSurrogate(value) {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff)) {
                throw new TypeError('RFC 8785 forbids lone UTF-16 surrogates');
            }
            index += 1;
        } else if (code >= 0xdc00 && code <= 0xdfff) {
            throw new TypeError('RFC 8785 forbids lone UTF-16 surrogates');
        }
    }
}

/** RFC 8785 JSON Canonicalization Scheme for I-JSON values. */
export function canonicalJson(value) {
    const seen = new Set();

    function serialize(input) {
        if (input === null) return 'null';
        if (typeof input === 'boolean') return input ? 'true' : 'false';
        if (typeof input === 'number') {
            if (!Number.isFinite(input)) throw new TypeError('RFC 8785 requires finite numbers');
            return JSON.stringify(input);
        }
        if (typeof input === 'string') {
            assertNoLoneSurrogate(input);
            return JSON.stringify(input);
        }
        if (!input || typeof input !== 'object') {
            throw new TypeError(`RFC 8785 cannot encode ${typeof input}`);
        }
        if (seen.has(input)) throw new TypeError('RFC 8785 cannot encode cyclic values');
        seen.add(input);
        let result;
        if (Array.isArray(input)) {
            result = `[${input.map((item) => serialize(item)).join(',')}]`;
        } else {
            const entries = Object.keys(input).sort().map((key) => {
                assertNoLoneSurrogate(key);
                return `${JSON.stringify(key)}:${serialize(input[key])}`;
            });
            result = `{${entries.join(',')}}`;
        }
        seen.delete(input);
        return result;
    }

    return serialize(value);
}

export function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const item of Object.values(value)) deepFreeze(item);
    return Object.freeze(value);
}
