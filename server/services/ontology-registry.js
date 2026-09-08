import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { OntologyError, OntologyKernel } from './ontology-kernel.js';
import {
    hasCompleteReceiptMetadata,
    hasReceiptMetadata,
    loadTrustedPublicKeys,
    verifyPublishedReceipt
} from './ontology-release-trust.js';

function parseJson(bytes, label) {
    try {
        return JSON.parse(bytes.toString('utf8'));
    } catch (error) {
        throw new OntologyError('ONTOLOGY_MANIFEST_INVALID', `Invalid JSON in ${label}`, {
            cause: error.message
        });
    }
}

function parseTime(value, label) {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
        throw new OntologyError('ONTOLOGY_MANIFEST_INVALID', `Invalid ${label}: ${value}`);
    }
    return timestamp;
}

export class OntologyRegistry {
    constructor({
        rootDir = process.cwd(),
        configDir = 'config/ontology',
        publicKeyPem = process.env.ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY || ''
    } = {}) {
        this.configDir = path.resolve(rootDir, configDir);
        this.releasesDir = path.resolve(this.configDir, 'releases');
        this.publicKeyPem = publicKeyPem;
        try {
            this.trustedPublicKeys = loadTrustedPublicKeys(this.configDir);
        } catch (error) {
            throw new OntologyError('ONTOLOGY_MANIFEST_INVALID', error.message);
        }
        this.index = parseJson(readFileSync(path.join(this.configDir, 'index.json')), 'ontology index');
        if (!Array.isArray(this.index.releases)) {
            throw new OntologyError('ONTOLOGY_MANIFEST_INVALID', 'Ontology index releases must be an array');
        }
    }

    hasCurrent() {
        return typeof this.index.current === 'string' && this.index.current.length > 0;
    }

    resolve({ version, asOf } = {}) {
        let entry;
        if (version) {
            entry = this.index.releases.find((release) => release.version === version);
        } else if (asOf) {
            const target = parseTime(asOf, 'asOf');
            entry = this.index.releases
                .filter((release) => (hasCompleteReceiptMetadata(release) || release.version === this.index.current)
                    && parseTime(release.effective_at, 'release effective_at') <= target)
                .sort((left, right) => parseTime(right.effective_at, 'release effective_at') - parseTime(left.effective_at, 'release effective_at'))[0];
        } else {
            if (!this.hasCurrent()) {
                throw new OntologyError('ONTOLOGY_CURRENT_UNAVAILABLE', 'No current ontology release has been published');
            }
            entry = this.index.releases.find((release) => release.version === this.index.current);
        }

        if (!entry) {
            throw new OntologyError('ONTOLOGY_VERSION_UNKNOWN', `Ontology release was not found: ${version || asOf}`, {
                version: version || null,
                as_of: asOf || null
            });
        }

        const releasePath = path.resolve(this.configDir, entry.path);
        const relativePath = path.relative(this.releasesDir, releasePath);
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            throw new OntologyError('ONTOLOGY_MANIFEST_INVALID', 'Ontology release path must stay inside releases/', {
                path: entry.path
            });
        }

        const bytes = readFileSync(releasePath);
        const digest = createHash('sha256').update(bytes).digest('hex');
        if (entry.content_digest_algorithm !== 'sha256' || digest !== entry.content_digest) {
            throw new OntologyError('ONTOLOGY_DIGEST_MISMATCH', `Ontology release digest mismatch: ${entry.version}`, {
                version: entry.version,
                expected: entry.content_digest,
                actual: digest
            });
        }

        const manifest = parseJson(bytes, `ontology release ${entry.version}`);
        if (manifest.version !== entry.version || manifest.effective_at !== entry.effective_at) {
            throw new OntologyError('ONTOLOGY_MANIFEST_INVALID', 'Ontology index metadata does not match release manifest', {
                index_version: entry.version,
                manifest_version: manifest.version,
                index_effective_at: entry.effective_at,
                manifest_effective_at: manifest.effective_at
            });
        }

        const receiptTrust = verifyPublishedReceipt({
            configDir: this.configDir,
            entry,
            manifest,
            publicKeyPem: this.publicKeyPem,
            trustedPublicKeys: this.trustedPublicKeys
        });
        const claimsPublication = this.index.current === entry.version
            || entry.status === 'retired'
            || hasReceiptMetadata(entry);
        if (claimsPublication && !receiptTrust.verified) {
            throw new OntologyError('ONTOLOGY_PUBLICATION_UNVERIFIED', `Ontology publication receipt is not trusted: ${entry.version}`, {
                http_status: 503,
                version: entry.version,
                reason: receiptTrust.reason,
                ...receiptTrust.details
            });
        }

        const effectiveStatus = receiptTrust.verified && this.index.current === entry.version
            ? 'active'
            : receiptTrust.verified && entry.status === 'retired'
                ? 'retired'
                : receiptTrust.verified
                    ? 'approved'
                    : 'proposed';
        return {
            kernel: new OntologyKernel({ manifest, status: effectiveStatus }),
            digest,
            entry: structuredClone(entry),
            publicationVerification: receiptTrust.verified
                ? {
                    status: 'verified',
                    key_id: receiptTrust.receipt.key_id,
                    signature_algorithm: receiptTrust.receipt.signature_algorithm,
                    trust_source: this.publicKeyPem ? 'environment_override' : 'git_trust_store',
                    receipt_digest: receiptTrust.receipt_digest
                }
                : { status: 'unverified', reason: receiptTrust.reason }
        };
    }

    interpretHistory(snapshot = {}, { version, asOf } = {}) {
        const recordedVersion = snapshot.ontology_version || null;
        if (version && recordedVersion && version !== recordedVersion) {
            throw new OntologyError('ONTOLOGY_HISTORY_VERSION_MISMATCH', 'Requested ontology version does not match the recorded fact version', {
                requested_version: version,
                recorded_version: recordedVersion
            });
        }
        let release;
        try {
            if (version || recordedVersion) {
                release = this.resolve({ version: version || recordedVersion });
            } else if (asOf) {
                release = this.resolve({ asOf });
            } else {
                return this.unverifiedHistory(snapshot, asOf, {
                    code: 'ONTOLOGY_HISTORY_VERSION_UNRESOLVED',
                    message: 'Historical interpretation requires a recorded ontology version or resolvable as-of time'
                });
            }
        } catch (error) {
            if (!version && !recordedVersion && error instanceof OntologyError
                && ['ONTOLOGY_VERSION_UNKNOWN', 'ONTOLOGY_CURRENT_UNAVAILABLE', 'ONTOLOGY_PUBLICATION_UNVERIFIED'].includes(error.code)) {
                return this.unverifiedHistory(snapshot, asOf, {
                    code: error.code,
                    message: error.message
                });
            }
            throw error;
        }
        if (release.kernel.status === 'proposed') {
            return this.unverifiedHistory(snapshot, asOf, {
                code: 'ONTOLOGY_PUBLICATION_UNVERIFIED',
                message: `Ontology release has not been published: ${release.entry.version}`
            });
        }
        const resolvedVersion = release.entry.version;
        const mismatchedEvents = (snapshot.evolution_events || [])
            .filter((event) => event.ontology_version && event.ontology_version !== resolvedVersion)
            .map((event) => event.event_id);
        if (mismatchedEvents.length) {
            throw new OntologyError('ONTOLOGY_HISTORY_VERSION_MISMATCH', 'Evolution events must use the recorded fact ontology version', {
                recorded_version: recordedVersion,
                resolved_version: resolvedVersion,
                event_ids: mismatchedEvents
            });
        }
        return {
            ...release.kernel.interpretHistory(snapshot, { asOf }),
            recorded_ontology_version: recordedVersion,
            resolved_ontology_version: resolvedVersion,
            verification: 'verified'
        };
    }

    unverifiedHistory(snapshot, asOf, reason) {
        return {
            ...structuredClone(snapshot),
            ontology_version: null,
            recorded_ontology_version: snapshot.ontology_version || null,
            resolved_ontology_version: null,
            interpretation_as_of: asOf || null,
            verification: 'unverified',
            unverified_reason: reason
        };
    }
}
