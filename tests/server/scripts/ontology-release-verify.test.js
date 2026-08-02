import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { canonicalJson, sha256 } from '../../../server/services/ontology-publication.js';
import { publishOntologyRelease } from '../../../scripts/ontology-release-publish.js';
import { verifyOntologyHistory } from '../../../scripts/ontology-release-verify.js';

const projectRoot = path.resolve(import.meta.dirname, '../../..');

const temporaryDirectories = [];
afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function git(rootDir, args) {
    return execFileSync('git', args, { cwd: rootDir, encoding: 'utf8' }).trim();
}

function writeJson(target, value) {
    writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function publicationRepository({ publish = true } = {}) {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'ontology-history-'));
    temporaryDirectories.push(rootDir);
    git(rootDir, ['init']);
    git(rootDir, ['config', 'user.email', 'ontology@example.test']);
    git(rootDir, ['config', 'user.name', 'Ontology Test']);
    const configDir = path.join(rootDir, 'config/ontology');
    mkdirSync(path.join(configDir, 'releases'), { recursive: true });
    const releaseBytes = Buffer.from(`${JSON.stringify({
        version: '1.0.0',
        effective_at: '2026-08-01T00:00:00.000Z',
        governance: {
            decision_id: 'decision:ontology-v1',
            scope_entity_id: 'project:brainbase',
            applier_entity_id: 'person:applier'
        }
    })}\n`);
    writeFileSync(path.join(configDir, 'releases/1.0.0.json'), releaseBytes);
    const entry = {
        version: '1.0.0',
        status: 'proposed',
        effective_at: '2026-08-01T00:00:00.000Z',
        path: 'releases/1.0.0.json',
        content_digest_algorithm: 'sha256',
        content_digest: sha256(releaseBytes)
    };
    writeJson(path.join(configDir, 'index.json'), { current: null, releases: [entry] });
    git(rootDir, ['add', '.']);
    git(rootDir, ['commit', '-m', 'source']);
    const sourceCommit = git(rootDir, ['rev-parse', 'HEAD']);
    if (!publish) return { rootDir, sourceCommit, releasePath: path.join(configDir, 'releases/1.0.0.json'), entry };

    const receipt = {
        payload: {
            release_version: entry.version,
            release_digest: entry.content_digest,
            source_commit_sha: sourceCommit
        },
        signature_algorithm: 'ed25519',
        signature: 'fixture',
        key_id: 'fixture'
    };
    const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    mkdirSync(path.join(configDir, 'publications'));
    writeFileSync(path.join(configDir, 'publications/1.0.0.receipt.json'), receiptBytes);
    writeFileSync(path.join(configDir, 'brainbase-ontology.v1.json'), releaseBytes);
    const publishedEntry = {
        ...entry,
        status: 'active',
        receipt_path: 'publications/1.0.0.receipt.json',
        receipt_digest_algorithm: 'sha256',
        receipt_digest: sha256(receiptBytes),
        source_commit_sha: sourceCommit
    };
    writeJson(path.join(configDir, 'index.json'), { current: '1.0.0', releases: [publishedEntry] });
    git(rootDir, ['add', '.']);
    git(rootDir, ['commit', '-m', 'publish']);
    return { rootDir, sourceCommit, publicationCommit: git(rootDir, ['rev-parse', 'HEAD']), releasePath: path.join(configDir, 'releases/1.0.0.json') };
}

describe('ontology release Git history verification', () => {
    it('fails the publisher with an actionable decision-id contract and no credential echo', () => {
        const result = spawnSync(process.execPath, ['scripts/ontology-release-publish.js', '--version', '1.0.0'], {
            cwd: projectRoot,
            encoding: 'utf8',
            env: {
                ...process.env,
                ONTOLOGY_DECISION_ID: '',
                BRAINBASE_GRAPH_API_TOKEN: 'must-not-appear'
            }
        });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('--decision-id is required');
        expect(result.stderr).not.toContain('must-not-appear');
    });

    it('accepts a direct-child generated-only publication commit', () => {
        const fixture = publicationRepository();
        expect(verifyOntologyHistory({
            rootDir: fixture.rootDir,
            base: fixture.sourceCommit,
            head: fixture.publicationCommit
        })).toMatchObject({ base_current: null, head_current: '1.0.0' });
    });

    it('sends Decision, scope, and applier bindings from release governance', async () => {
        const fixture = publicationRepository({ publish: false });
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        let observedRequest;
        const result = await publishOntologyRelease({
            rootDir: fixture.rootDir,
            version: '1.0.0',
            decisionId: 'decision:ontology-v1',
            env: {
                BRAINBASE_GRAPH_API_URL: 'https://graph.example.test',
                BRAINBASE_GRAPH_API_TOKEN: 'secret-token',
                ONTOLOGY_RECEIPT_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }).toString()
            },
            fetchImpl: async (url, options) => {
                observedRequest = { url, options, body: JSON.parse(options.body) };
                const payload = {
                    actor_entity_id: 'person:applier',
                    applier_entity_id: 'person:applier',
                    decision_id: 'decision:ontology-v1',
                    release_digest: fixture.entry.content_digest,
                    release_version: '1.0.0',
                    scope_entity_id: 'project:brainbase',
                    source_commit_sha: fixture.sourceCommit
                };
                return {
                    ok: true,
                    json: async () => ({
                        payload,
                        signature_algorithm: 'ed25519',
                        signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64'),
                        key_id: 'test-key'
                    })
                };
            }
        });

        expect(observedRequest.url).toBe('https://graph.example.test/api/info/ontology/publications/authorize');
        expect(observedRequest.body).toEqual({
            release_version: '1.0.0',
            source_commit_sha: fixture.sourceCommit,
            release_digest: fixture.entry.content_digest,
            decision_id: 'decision:ontology-v1',
            scope_entity_id: 'project:brainbase',
            applier_entity_id: 'person:applier'
        });
        expect(observedRequest.options.headers.authorization).toBe('Bearer secret-token');
        expect(result.generated).toEqual([
            'config/ontology/publications/1.0.0.receipt.json',
            'config/ontology/brainbase-ontology.v1.json',
            'config/ontology/index.json'
        ]);
    });

    it('rejects release mutation after publication', () => {
        const fixture = publicationRepository();
        writeFileSync(fixture.releasePath, '{"version":"1.0.0","effective_at":"mutated"}\n');
        git(fixture.rootDir, ['add', '.']);
        git(fixture.rootDir, ['commit', '-m', 'mutate']);
        expect(() => verifyOntologyHistory({
            rootDir: fixture.rootDir,
            base: fixture.sourceCommit,
            head: git(fixture.rootDir, ['rev-parse', 'HEAD'])
        })).toThrow(/not byte-bound/);
    });

    it('rejects manually making an existing receipt release current', () => {
        const fixture = publicationRepository();
        const indexPath = path.join(fixture.rootDir, 'config/ontology/index.json');
        const approvedIndex = JSON.parse(readFileSync(indexPath, 'utf8'));
        approvedIndex.current = null;
        writeJson(indexPath, approvedIndex);
        git(fixture.rootDir, ['add', '.']);
        git(fixture.rootDir, ['commit', '-m', 'trusted approved snapshot']);
        const base = git(fixture.rootDir, ['rev-parse', 'HEAD']);

        approvedIndex.current = '1.0.0';
        writeJson(indexPath, approvedIndex);
        git(fixture.rootDir, ['add', '.']);
        git(fixture.rootDir, ['commit', '-m', 'manual current switch']);

        expect(() => verifyOntologyHistory({
            rootDir: fixture.rootDir,
            base,
            head: git(fixture.rootDir, ['rev-parse', 'HEAD'])
        })).toThrow(/current change must introduce its receipt/);
    });
});
