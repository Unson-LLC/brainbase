import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    DECISION_STATUS_RULE_ID,
    OntologyError,
    OntologyKernel,
    buildOntologyReleaseCandidate
} from '../src/ontology-kernel.js';
import { OntologyRegistry } from '../src/ontology-registry.js';
import {
    canonicalJson,
    publicationReceiptContractErrors,
    sha256,
    verifyPublicationReceipt
} from '../src/ontology-publication.js';
import { hasCompleteReceiptMetadata, verifyPublishedReceipt } from '../src/ontology-release-trust.js';

const typeMeta = { description: 'd', identity: 'id', usage: 'u', examples: [], counter_examples: [], owner: 'o' };
const relationMeta = { direction: 'outgoing', cardinality: 'many_to_many', lifecycle: 'active', provenance: 'p', symmetric: false };

function manifest(version = '1.0.0') {
    return {
        version,
        initial_status: 'active',
        effective_at: '2026-01-01T00:00:00.000Z',
        entity_types: { project: { ...typeMeta }, decision: { ...typeMeta }, note: { ...typeMeta } },
        relation_types: {
            belongs_to_project: { ...relationMeta, from: ['decision', 'note'], to: ['project'] },
            supersedes: { ...relationMeta, from: ['decision'], to: ['decision'] }
        },
        constraints: [
            { id: 'CON-NOTE-TITLE', target: 'note', kind: 'required_fields_when', when: {}, fields: ['title'] }
        ],
        inference_rules: [],
        evolution_rules: { history_required_for: ['rename', 'merge'] },
        previous_version: null,
        compatibility: { classification: 'initial' },
        migration: { required: false },
        rollback: { strategy: 'restore_previous_current' },
        governance: {
            decision_id: 'dec_1', scope_entity_id: 'project:demo', proposer_entity_id: 'per_a',
            decider_entity_id: 'per_b', applier_entity_id: 'per_c'
        },
        impact_scope: { graph_scope: 'project:demo' },
        changes: ['initial']
    };
}

const temps: string[] = [];
afterEach(() => {
    while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

function signedConfig({ tamper = false } = {}) {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'ontology-oss-'));
    temps.push(rootDir);
    const configDir = path.join(rootDir, 'config/ontology');
    mkdirSync(path.join(configDir, 'releases'), { recursive: true });
    mkdirSync(path.join(configDir, 'publications'), { recursive: true });
    const release = manifest();
    const releaseBytes = Buffer.from(`${JSON.stringify(release, null, 2)}\n`);
    writeFileSync(path.join(configDir, 'releases/1.0.0.json'), releaseBytes);
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const payload = {
        schema_version: '1.0.0',
        release_version: '1.0.0',
        release_digest: sha256(releaseBytes),
        source_commit_sha: '1'.repeat(40),
        ...release.governance,
        actor_entity_id: release.governance.applier_entity_id,
        impact_scope: release.impact_scope,
        issued_at: '2026-01-01T00:00:00.000Z'
    };
    const receipt = {
        signature_algorithm: 'ed25519',
        key_id: 'test-key',
        payload: tamper ? { ...payload, decision_id: 'dec_other' } : payload,
        signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64')
    };
    const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    writeFileSync(path.join(configDir, 'publications/1.0.0.receipt.json'), receiptBytes);
    const entry = {
        version: '1.0.0', status: 'active', effective_at: release.effective_at, path: 'releases/1.0.0.json',
        content_digest_algorithm: 'sha256', content_digest: sha256(releaseBytes),
        receipt_path: 'publications/1.0.0.receipt.json', receipt_digest_algorithm: 'sha256', receipt_digest: sha256(receiptBytes),
        source_commit_sha: '1'.repeat(40), impact_scope: release.impact_scope
    };
    writeFileSync(path.join(configDir, 'index.json'), JSON.stringify({ schema_version: '1.0.0', current: '1.0.0', releases: [entry] }));
    writeFileSync(path.join(configDir, 'trusted-public-keys.json'), JSON.stringify({
        schema_version: '1.0.0',
        keys: { 'test-key': { algorithm: 'ed25519', public_key_pem: publicKey.export({ type: 'spki', format: 'pem' }).toString() } }
    }));
    return { rootDir, configDir, release, entry };
}

describe('ontology kernel', () => {
    it('rejects an incomplete manifest with a typed error', () => {
        const broken: Record<string, unknown> = manifest();
        delete broken.governance;
        expect(() => new OntologyKernel({ manifest: broken })).toThrow(OntologyError);
        try {
            new OntologyKernel({ manifest: broken });
        } catch (error: any) {
            expect(error.code).toBe('ONTOLOGY_MANIFEST_INVALID');
            expect(error.details.missing).toEqual(['governance']);
        }
    });

    it('validates entities, required fields, and Decision status', () => {
        const kernel = new OntologyKernel({ manifest: manifest() });
        expect(kernel.validateEntity({ id: 'n1', type: 'note', payload: { title: 'x' } }).valid).toBe(true);
        expect(kernel.validateEntity({ id: 'n1', type: 'note', payload: {} }).violations[0].rule_id).toBe('CON-NOTE-TITLE');
        expect(kernel.validateEntity({ id: 'd1', type: 'decision', payload: {} }).violations
            .map((v: any) => v.rule_id)).toContain(DECISION_STATUS_RULE_ID);
        expect(() => kernel.getType('missing')).toThrow(/Unknown ontology type/);
    });

    it('plans identity history only for registered evolution kinds', () => {
        const kernel = new OntologyKernel({ manifest: manifest() });
        expect(kernel.planEvolution({
            kind: 'rename', canonical_id: 'c1', source_ids: ['a', 'a', 'b'], effective_at: '2026-02-01T00:00:00.000Z'
        })).toMatchObject({ event_type: 'ontology_rename', source_ids: ['a', 'b'], aliases: ['a', 'b'] });
        expect(() => kernel.planEvolution({ kind: 'split' })).toThrow(/does not require identity history/);
    });

    it('builds a release candidate and classifies the required bump', () => {
        const result = buildOntologyReleaseCandidate(manifest(), {
            next_version: '1.1.0',
            summary: ['add a type'],
            effective_at: '2026-02-01T00:00:00.000Z',
            changes: { entity_types: { upsert: { task: { ...typeMeta } } } }
        });
        expect(result.candidate.version).toBe('1.1.0');
        expect(result.candidate.previous_version).toBe('1.0.0');
        expect(result.declared_bump).toBe('minor');
        expect(result.semver_ok).toBe(true);
        expect(() => buildOntologyReleaseCandidate(manifest(), { next_version: 'x', summary: ['s'] })).toThrow(/semantic version/);
    });
});

describe('ontology publication receipts', () => {
    it('serializes canonically and checks the receipt contract', () => {
        expect(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
        expect(publicationReceiptContractErrors({ payload: { schema_version: '1.0.0', actor_entity_id: 'p', issued_at: 'bad' } }))
            .toEqual(['issued_at']);
    });

    it('verifies a signed receipt and rejects a tampered payload', () => {
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        const payload = { schema_version: '1.0.0', actor_entity_id: 'per_c', issued_at: '2026-01-01T00:00:00.000Z' };
        const receipt = { signature_algorithm: 'ed25519', key_id: 'k', payload, signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64') };
        const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
        expect(verifyPublicationReceipt(receipt, pem)).toBe(true);
        expect(verifyPublicationReceipt({ ...receipt, payload: { ...payload, actor_entity_id: 'per_x' } }, pem)).toBe(false);
    });

    it('trusts a published release only when the receipt binds to it', () => {
        const ok = signedConfig();
        const trusted = verifyPublishedReceipt({
            configDir: ok.configDir, entry: ok.entry, manifest: ok.release,
            trustedPublicKeys: JSON.parse(readFileSync(path.join(ok.configDir, 'trusted-public-keys.json'), 'utf8')).keys
        });
        expect(trusted.verified).toBe(true);
        expect(hasCompleteReceiptMetadata(ok.entry)).toBe(true);
        expect(verifyPublishedReceipt({ configDir: ok.configDir, entry: { ...ok.entry, receipt_path: '../index.json' }, manifest: ok.release }))
            .toMatchObject({ verified: false, reason: 'path_escape' });
        expect(verifyPublishedReceipt({ configDir: ok.configDir, entry: { ...ok.entry, receipt_digest: 'a'.repeat(64) }, manifest: ok.release }))
            .toMatchObject({ verified: false, reason: 'digest_mismatch' });
    });
});

describe('ontology registry', () => {
    it('resolves the current signed release from a config directory', () => {
        const { rootDir } = signedConfig();
        const registry = new OntologyRegistry({ rootDir, publicKeyPem: '' });
        expect(registry.hasCurrent()).toBe(true);
        const resolved = registry.resolve();
        expect(resolved.kernel.version).toBe('1.0.0');
        expect(resolved.kernel.status).toBe('active');
        expect(resolved.publicationVerification).toMatchObject({ status: 'verified', key_id: 'test-key', trust_source: 'git_trust_store' });
    });

    it('refuses a current release whose receipt does not bind to it', () => {
        const { rootDir } = signedConfig({ tamper: true });
        const registry = new OntologyRegistry({ rootDir, publicKeyPem: '' });
        expect(() => registry.resolve()).toThrow(OntologyError);
    });
});

