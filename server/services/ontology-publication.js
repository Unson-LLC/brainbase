import { createHash, verify } from 'node:crypto';

export function sha256(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}

export function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
    }
    return value;
}

export function canonicalJson(value) {
    return JSON.stringify(canonicalize(value));
}

export function verifyPublicationReceipt(receipt, publicKeyPem) {
    if (receipt?.signature_algorithm !== 'ed25519' || !receipt?.payload || !receipt?.signature || !receipt?.key_id) {
        return false;
    }
    return verify(
        null,
        Buffer.from(canonicalJson(receipt.payload)),
        publicKeyPem,
        Buffer.from(receipt.signature, 'base64')
    );
}
