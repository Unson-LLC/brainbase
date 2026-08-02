import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { OntologyError, OntologyKernel } from './ontology-kernel.js';

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
    constructor({ rootDir = process.cwd(), configDir = 'config/ontology' } = {}) {
        this.configDir = path.resolve(rootDir, configDir);
        this.releasesDir = path.resolve(this.configDir, 'releases');
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
        } else {
            if (!this.hasCurrent()) {
                throw new OntologyError('ONTOLOGY_CURRENT_UNAVAILABLE', 'No current ontology release has been published');
            }
        }
        if (!version && asOf) {
            const target = parseTime(asOf, 'asOf');
            entry = this.index.releases
                .filter((release) => (release.receipt_path || release.version === this.index.current || release.status === 'retired')
                    && parseTime(release.effective_at, 'release effective_at') <= target)
                .sort((left, right) => parseTime(right.effective_at, 'release effective_at') - parseTime(left.effective_at, 'release effective_at'))[0];
        } else if (!version) {
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

        const effectiveStatus = this.index.current === entry.version
            ? 'active'
            : entry.status === 'retired'
                ? 'retired'
                : entry.receipt_path
                    ? 'approved'
                    : 'proposed';
        return {
            kernel: new OntologyKernel({ manifest, status: effectiveStatus }),
            digest,
            entry: structuredClone(entry)
        };
    }
}
