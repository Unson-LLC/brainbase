import { randomBytes } from 'node:crypto';
import { ContractError } from './errors.js';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PREFIXES = new Set(['ten', 'wsc', 'ctr', 'usage', 'receipt', 'cor', 'op', 'dep', 'lease', 'mig']);

function encodeUlid(timestampMs, randomness) {
    if (!Number.isSafeInteger(timestampMs) || timestampMs < 0 || timestampMs > 0xffffffffffff) {
        throw new ContractError('CANONICAL_ID_TIMESTAMP_INVALID', { status: 400 });
    }
    let value = BigInt(timestampMs);
    for (const byte of randomness) value = (value << 8n) | BigInt(byte);
    let encoded = '';
    for (let index = 0; index < 26; index += 1) {
        encoded = CROCKFORD[Number(value & 31n)] + encoded;
        value >>= 5n;
    }
    return encoded;
}

export function generateCanonicalId(prefix, { now = Date.now(), random = randomBytes(10) } = {}) {
    if (!PREFIXES.has(prefix)) throw new ContractError('CANONICAL_ID_PREFIX_INVALID', { status: 400 });
    if (!Buffer.isBuffer(random) || random.length !== 10) {
        throw new ContractError('CANONICAL_ID_RANDOMNESS_INVALID', { status: 400 });
    }
    return `${prefix}_${encodeUlid(now, random)}`;
}

export function isCanonicalId(value, prefix) {
    if (!PREFIXES.has(prefix)) return false;
    return new RegExp(`^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$`).test(String(value));
}
