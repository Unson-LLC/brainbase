import { createHash, verify } from 'node:crypto';

export const ONTOLOGY_PUBLICATION_RECEIPT_SCHEMA_VERSION = '1.0.0';

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

export function publicationReceiptContractErrors(receipt) {
    const errors = [];
    if (receipt?.payload?.schema_version !== ONTOLOGY_PUBLICATION_RECEIPT_SCHEMA_VERSION) {
        errors.push('schema_version');
    }
    if (typeof receipt?.payload?.actor_entity_id !== 'string' || !receipt.payload.actor_entity_id.trim()) {
        errors.push('actor_entity_id');
    }
    const issuedAt = receipt?.payload?.issued_at;
    if (typeof issuedAt !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(issuedAt)
        || Number.isNaN(Date.parse(issuedAt))
        || new Date(issuedAt).toISOString() !== issuedAt) {
        errors.push('issued_at');
    }
    return errors;
}

export function verifyPublicationReceipt(receipt, publicKeyPem) {
    if (receipt?.signature_algorithm !== 'ed25519' || !receipt?.payload || !receipt?.signature || !receipt?.key_id) {
        return false;
    }
    if (publicationReceiptContractErrors(receipt).length) return false;
    return verify(
        null,
        Buffer.from(canonicalJson(receipt.payload)),
        publicKeyPem,
        Buffer.from(receipt.signature, 'base64')
    );
}
