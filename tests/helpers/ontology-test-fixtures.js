import { generateKeyPairSync, sign } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { canonicalJson, sha256 } from '../../server/services/ontology-publication.js';

const PUBLICATION_FIELDS = [
    'receipt_path',
    'receipt_digest_algorithm',
    'receipt_digest',
    'source_commit_sha',
    'impact_scope'
];

function writeJson(target, value) {
    writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

export function createProposedOntologyFixture(sourceRoot) {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'ontology-proposed-'));
    const configDir = path.join(rootDir, 'config/ontology');
    mkdirSync(path.dirname(configDir), { recursive: true });
    cpSync(path.join(sourceRoot, 'config/ontology'), configDir, { recursive: true });

    const indexPath = path.join(configDir, 'index.json');
    const index = JSON.parse(readFileSync(indexPath, 'utf8'));
    const entry = index.releases.find(({ version }) => version === '1.0.0');
    if (!entry) throw new Error('Ontology 1.0.0 release entry is required for the test fixture');

    index.current = null;
    entry.status = 'proposed';
    for (const field of PUBLICATION_FIELDS) delete entry[field];
    const releaseBytes = readFileSync(path.join(configDir, entry.path));
    entry.content_digest_algorithm = 'sha256';
    entry.content_digest = sha256(releaseBytes);
    writeJson(indexPath, index);

    rmSync(path.join(configDir, 'publications'), { recursive: true, force: true });
    rmSync(path.join(configDir, 'brainbase-ontology.v1.json'), { force: true });

    return {
        rootDir,
        configDir,
        cleanup: () => rmSync(rootDir, { recursive: true, force: true })
    };
}

export function createSignedActiveOntologyFixture(sourceRoot) {
    const fixture = createProposedOntologyFixture(sourceRoot);
    const indexPath = path.join(fixture.configDir, 'index.json');
    const index = JSON.parse(readFileSync(indexPath, 'utf8'));
    const entry = index.releases.find(({ version }) => version === '1.0.0');
    const releasePath = path.join(fixture.configDir, entry.path);
    const release = JSON.parse(readFileSync(releasePath, 'utf8'));
    const releaseBytes = readFileSync(releasePath);
    const sourceCommitSha = '1'.repeat(40);
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');

    const payload = {
        schema_version: '1.0.0',
        issued_at: '2026-08-03T00:00:00.000Z',
        release_version: entry.version,
        release_digest: entry.content_digest,
        source_commit_sha: sourceCommitSha,
        decision_id: release.governance.decision_id,
        scope_entity_id: release.governance.scope_entity_id,
        proposer_entity_id: release.governance.proposer_entity_id,
        decider_entity_id: release.governance.decider_entity_id,
        applier_entity_id: release.governance.applier_entity_id,
        actor_entity_id: release.governance.applier_entity_id,
        impact_scope: release.impact_scope
    };
    const receipt = {
        payload,
        signature_algorithm: 'ed25519',
        signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64'),
        key_id: 'ontology-test-key'
    };
    const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    mkdirSync(path.join(fixture.configDir, 'publications'), { recursive: true });
    writeFileSync(path.join(fixture.configDir, 'publications/1.0.0.receipt.json'), receiptBytes);
    writeFileSync(path.join(fixture.configDir, 'brainbase-ontology.v1.json'), releaseBytes);

    Object.assign(entry, {
        status: 'active',
        receipt_path: 'publications/1.0.0.receipt.json',
        receipt_digest_algorithm: 'sha256',
        receipt_digest: sha256(receiptBytes),
        source_commit_sha: sourceCommitSha,
        impact_scope: release.impact_scope
    });
    index.current = entry.version;
    writeJson(indexPath, index);

    return {
        ...fixture,
        publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString()
    };
}
