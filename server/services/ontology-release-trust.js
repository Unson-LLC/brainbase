import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import {
    canonicalJson,
    publicationReceiptContractErrors,
    sha256,
    verifyPublicationReceipt
} from './ontology-publication.js';

const SHA256_DIGEST = /^[a-f0-9]{64}$/;
const RECEIPT_FIELDS = ['receipt_path', 'receipt_digest_algorithm', 'receipt_digest'];

export function hasReceiptMetadata(entry = {}) {
    return RECEIPT_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(entry, field));
}

export function hasCompleteReceiptMetadata(entry = {}) {
    return typeof entry.receipt_path === 'string'
        && entry.receipt_path.trim().length > 0
        && entry.receipt_digest_algorithm === 'sha256'
        && typeof entry.receipt_digest === 'string'
        && SHA256_DIGEST.test(entry.receipt_digest);
}

function invalid(reason, details = {}) {
    return { verified: false, reason, details };
}

function isContained(parent, child) {
    const relative = path.relative(parent, child);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function loadTrustedPublicKeys(configDir) {
    const trustStorePath = path.join(configDir, 'trusted-public-keys.json');
    if (!existsSync(trustStorePath)) return {};

    const trustStore = JSON.parse(readFileSync(trustStorePath, 'utf8'));
    if (trustStore.schema_version !== '1.0.0'
        || !trustStore.keys
        || Array.isArray(trustStore.keys)
        || typeof trustStore.keys !== 'object') {
        throw new Error('Ontology trusted public keys must use the 1.0.0 key map schema');
    }
    for (const [keyId, key] of Object.entries(trustStore.keys)) {
        if (!keyId
            || key?.algorithm !== 'ed25519'
            || typeof key.public_key_pem !== 'string'
            || !key.public_key_pem.includes('-----BEGIN PUBLIC KEY-----')) {
            throw new Error(`Invalid ontology trusted public key: ${keyId || '<empty>'}`);
        }
    }
    return trustStore.keys;
}

export function verifyPublishedReceipt({
    configDir,
    entry = {},
    manifest,
    publicKeyPem = '',
    trustedPublicKeys = {}
}) {
    if (!hasCompleteReceiptMetadata(entry)) {
        return invalid(hasReceiptMetadata(entry) ? 'incomplete_metadata' : 'missing_metadata');
    }

    const publicationsDir = path.resolve(configDir, 'publications');
    const receiptPath = path.resolve(configDir, entry.receipt_path);
    if (!isContained(publicationsDir, receiptPath)) {
        return invalid('path_escape');
    }

    let realPublicationsDir;
    let realReceiptPath;
    let receiptBytes;
    try {
        realPublicationsDir = realpathSync(publicationsDir);
        realReceiptPath = realpathSync(receiptPath);
        if (!isContained(realPublicationsDir, realReceiptPath) || !statSync(realReceiptPath).isFile()) {
            return invalid('path_escape_or_not_file');
        }
        receiptBytes = readFileSync(realReceiptPath);
    } catch {
        return invalid('receipt_unavailable');
    }

    const actualDigest = sha256(receiptBytes);
    if (actualDigest !== entry.receipt_digest) {
        return invalid('digest_mismatch', { expected: entry.receipt_digest, actual: actualDigest });
    }

    let receipt;
    try {
        receipt = JSON.parse(receiptBytes.toString('utf8'));
    } catch {
        return invalid('invalid_json');
    }
    const contractErrors = publicationReceiptContractErrors(receipt);
    if (contractErrors.length) {
        return invalid('contract_mismatch', { fields: contractErrors });
    }
    const trustedPublicKeyPem = publicKeyPem || trustedPublicKeys[receipt.key_id]?.public_key_pem || '';
    if (!trustedPublicKeyPem) {
        return invalid('public_key_unavailable');
    }
    try {
        if (!verifyPublicationReceipt(receipt, trustedPublicKeyPem)) {
            return invalid('signature_invalid');
        }
    } catch {
        return invalid('signature_invalid');
    }

    const governance = manifest?.governance || {};
    const expectedBindings = {
        release_version: entry.version,
        release_digest: entry.content_digest,
        source_commit_sha: entry.source_commit_sha,
        decision_id: governance.decision_id,
        scope_entity_id: governance.scope_entity_id,
        proposer_entity_id: governance.proposer_entity_id,
        decider_entity_id: governance.decider_entity_id,
        applier_entity_id: governance.applier_entity_id,
        actor_entity_id: governance.applier_entity_id
    };
    const mismatches = Object.entries(expectedBindings)
        .filter(([key, value]) => !value || receipt.payload?.[key] !== value)
        .map(([key]) => key);
    const manifestImpactScope = canonicalJson(manifest?.impact_scope);
    if (canonicalJson(receipt.payload?.impact_scope) !== manifestImpactScope
        || (entry.impact_scope && canonicalJson(entry.impact_scope) !== manifestImpactScope)) {
        mismatches.push('impact_scope');
    }
    if (mismatches.length) {
        return invalid('binding_mismatch', { fields: mismatches });
    }
    return { verified: true, receipt, receipt_path: realReceiptPath, receipt_digest: actualDigest };
}
