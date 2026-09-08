import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, sha256 } from '../../../server/services/ontology-publication.js';
import { OntologyRegistry } from '../../../server/services/ontology-registry.js';
import { createProposedOntologyFixture } from '../../helpers/ontology-test-fixtures.js';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const proposedFixture = createProposedOntologyFixture(sourceRoot);
const rootDir = proposedFixture.rootDir;
const temporaryDirectories = [];

afterAll(() => proposedFixture.cleanup());

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function writeJson(target, value) {
    writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function signedRegistryFixture({ current = null, status = 'proposed', mutateEntry, mutateReceipt, publicKeyPem } = {}) {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'ontology-registry-'));
    temporaryDirectories.push(fixtureRoot);
    const configDir = path.join(fixtureRoot, 'config/ontology');
    cpSync(path.join(rootDir, 'config/ontology'), configDir, { recursive: true });

    const releasePath = path.join(configDir, 'releases/1.0.0.json');
    const release = JSON.parse(readFileSync(releasePath, 'utf8'));
    release.governance = {
        decision_id: 'decision:ontology-v1',
        scope_entity_id: 'project:brainbase',
        proposer_entity_id: 'person:proposer',
        decider_entity_id: 'person:decider',
        applier_entity_id: 'person:applier'
    };
    writeJson(releasePath, release);
    const releaseBytes = readFileSync(releasePath);

    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const indexPath = path.join(configDir, 'index.json');
    const index = JSON.parse(readFileSync(indexPath, 'utf8'));
    const entry = index.releases[0];
    entry.status = status;
    entry.content_digest = sha256(releaseBytes);
    entry.source_commit_sha = '1'.repeat(40);
    entry.impact_scope = release.impact_scope;
    index.current = current;

    const receipt = {
        payload: {
            schema_version: '1.0.0',
            issued_at: '2026-08-02T00:00:00.000Z',
            release_version: entry.version,
            release_digest: entry.content_digest,
            source_commit_sha: entry.source_commit_sha,
            decision_id: release.governance.decision_id,
            scope_entity_id: release.governance.scope_entity_id,
            proposer_entity_id: release.governance.proposer_entity_id,
            decider_entity_id: release.governance.decider_entity_id,
            applier_entity_id: release.governance.applier_entity_id,
            actor_entity_id: release.governance.applier_entity_id,
            impact_scope: release.impact_scope
        },
        signature_algorithm: 'ed25519',
        signature: '',
        key_id: 'test-key'
    };
    mutateReceipt?.(receipt);
    receipt.signature = sign(null, Buffer.from(canonicalJson(receipt.payload)), privateKey).toString('base64');
    const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    mkdirSync(path.join(configDir, 'publications'), { recursive: true });
    const receiptPath = path.join(configDir, 'publications/1.0.0.receipt.json');
    writeFileSync(receiptPath, receiptBytes);
    Object.assign(entry, {
        receipt_path: 'publications/1.0.0.receipt.json',
        receipt_digest_algorithm: 'sha256',
        receipt_digest: sha256(receiptBytes)
    });
    mutateEntry?.(entry, { configDir, receiptPath });
    writeJson(indexPath, index);

    const trustedPublicKey = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    return {
        registry: new OntologyRegistry({
            rootDir: fixtureRoot,
            publicKeyPem: publicKeyPem === undefined ? trustedPublicKey : publicKeyPem
        }),
        trustedPublicKey
    };
}

describe('OntologyRegistry', () => {
    it('resolves the active repository release with the distributed public trust anchor', () => {
        const previousPublicKey = process.env.ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY;
        delete process.env.ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY;
        try {
            const registry = new OntologyRegistry({ rootDir: sourceRoot });
            expect(registry.resolve()).toMatchObject({
                entry: { version: '1.1.0', status: 'active' },
                kernel: { status: 'active' },
                publicationVerification: {
                    status: 'verified',
                    key_id: 'brainbase-ontology-production-2026-08-03',
                    signature_algorithm: 'ed25519',
                    trust_source: 'git_trust_store',
                    receipt_digest: expect.stringMatching(/^[a-f0-9]{64}$/)
                }
            });
        } finally {
            if (previousPublicKey === undefined) delete process.env.ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY;
            else process.env.ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY = previousPublicKey;
        }
    });

    it('loads the immutable proposed release and verifies its digest', () => {
        const registry = new OntologyRegistry({ rootDir });
        const release = registry.resolve({ version: '1.0.0' });
        expect(release.kernel.describe()).toMatchObject({ version: '1.0.0', effective_status: 'proposed' });
        expect(release.digest).toMatch(/^[a-f0-9]{64}$/);
    });

    it('fails visibly when no current ontology exists', () => {
        const registry = new OntologyRegistry({ rootDir });
        expect(() => registry.resolve()).toThrowError(expect.objectContaining({ code: 'ONTOLOGY_CURRENT_UNAVAILABLE' }));
    });

    it('does not treat receipt metadata as publication evidence', () => {
        const registry = new OntologyRegistry({ rootDir });
        Object.assign(registry.index.releases[0], {
            receipt_path: 'publications/1.0.0.receipt.json',
            receipt_digest_algorithm: 'sha256',
            receipt_digest: 'a'.repeat(64)
        });
        expect(() => registry.resolve({ version: '1.0.0' })).toThrowError(expect.objectContaining({
            code: 'ONTOLOGY_PUBLICATION_UNVERIFIED',
            details: expect.objectContaining({ reason: 'receipt_unavailable' })
        }));
        expect(registry.interpretHistory({ entities: [] }, { asOf: '2026-08-03T00:00:00.000Z' })).toMatchObject({
            verification: 'unverified',
            unverified_reason: { code: 'ONTOLOGY_PUBLICATION_UNVERIFIED' }
        });
    });

    it('rejects partial receipt metadata instead of treating it as proposed', () => {
        const registry = new OntologyRegistry({ rootDir });
        registry.index.releases[0].receipt_path = 'publications/1.0.0.receipt.json';
        expect(() => registry.resolve({ version: '1.0.0' })).toThrowError(expect.objectContaining({
            code: 'ONTOLOGY_PUBLICATION_UNVERIFIED',
            details: expect.objectContaining({ reason: 'incomplete_metadata' })
        }));
    });

    it('requires a trusted receipt before a current release can become active', () => {
        const registry = new OntologyRegistry({ rootDir });
        registry.index.current = '1.0.0';
        expect(() => registry.resolve()).toThrowError(expect.objectContaining({
            code: 'ONTOLOGY_PUBLICATION_UNVERIFIED',
            details: expect.objectContaining({ reason: 'missing_metadata' })
        }));
    });

    it('keeps proposed recorded-version history explicitly unverified', () => {
        const registry = new OntologyRegistry({ rootDir });
        expect(registry.interpretHistory({
            ontology_version: '1.0.0',
            entities: [{ id: 'org:legacy', type: 'org' }]
        })).toMatchObject({
            ontology_version: null,
            recorded_ontology_version: '1.0.0',
            resolved_ontology_version: null,
            verification: 'unverified',
            unverified_reason: { code: 'ONTOLOGY_PUBLICATION_UNVERIFIED' }
        });
    });

    it('derives approved, active, retired, as-of, and verified history only from a valid signed receipt', () => {
        const approved = signedRegistryFixture().registry;
        expect(approved.resolve({ version: '1.0.0' }).kernel.status).toBe('approved');
        expect(approved.resolve({ asOf: '2026-08-03T00:00:00.000Z' }).kernel.version).toBe('1.0.0');
        expect(approved.interpretHistory({ entities: [] }, { asOf: '2026-08-03T00:00:00.000Z' })).toMatchObject({
            resolved_ontology_version: '1.0.0',
            verification: 'verified'
        });

        const active = signedRegistryFixture({ current: '1.0.0', status: 'active' }).registry;
        expect(active.resolve().kernel.status).toBe('active');

        const retired = signedRegistryFixture({ status: 'retired' }).registry;
        expect(retired.resolve({ version: '1.0.0' }).kernel.status).toBe('retired');
    });

    it.each([
        ['missing public key', { publicKeyPem: '' }, 'public_key_unavailable'],
        ['receipt path escape', { mutateEntry: (entry) => { entry.receipt_path = '../outside.json'; } }, 'path_escape'],
        ['receipt digest mismatch', { mutateEntry: (entry) => { entry.receipt_digest = 'a'.repeat(64); } }, 'digest_mismatch'],
        ['payload binding mismatch', { mutateReceipt: (receipt) => { receipt.payload.source_commit_sha = '2'.repeat(40); } }, 'binding_mismatch']
    ])('fails closed for %s', (_label, options, reason) => {
        const { registry } = signedRegistryFixture(options);
        expect(() => registry.resolve({ version: '1.0.0' })).toThrowError(expect.objectContaining({
            code: 'ONTOLOGY_PUBLICATION_UNVERIFIED',
            details: expect.objectContaining({ reason })
        }));
    });

    it('fails closed for a receipt signed by an untrusted key', () => {
        const { publicKey } = generateKeyPairSync('ed25519');
        const untrustedKey = publicKey.export({ type: 'spki', format: 'pem' }).toString();
        const { registry } = signedRegistryFixture({ publicKeyPem: untrustedKey });
        expect(() => registry.resolve({ version: '1.0.0' })).toThrowError(expect.objectContaining({
            code: 'ONTOLOGY_PUBLICATION_UNVERIFIED',
            details: expect.objectContaining({ reason: 'signature_invalid' })
        }));
    });

    it('returns structured unverified history when neither version nor as-of release can be resolved', () => {
        const registry = new OntologyRegistry({ rootDir });
        expect(registry.interpretHistory({ entities: [{ id: 'org:legacy', type: 'org' }] }, {
            asOf: '2026-08-03T00:00:00.000Z'
        })).toMatchObject({
            ontology_version: null,
            recorded_ontology_version: null,
            resolved_ontology_version: null,
            verification: 'unverified',
            unverified_reason: { code: 'ONTOLOGY_VERSION_UNKNOWN' },
            entities: [{ id: 'org:legacy', type: 'org' }]
        });
    });
});
