import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { canonicalJson, sha256 } from '../../../server/services/ontology-publication.js';
import { publishOntologyRelease, replacePublicationOutputs } from '../../../scripts/ontology-release-publish.js';
import { verifyOntologyHistory, verifyOntologyRelease } from '../../../scripts/ontology-release-verify.js';
import { InfoSSOTService } from '../../../server/services/info-ssot-service.js';
import { OntologyRegistry } from '../../../server/services/ontology-registry.js';
import { createProposedOntologyFixture } from '../../helpers/ontology-test-fixtures.js';

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

function publicationRepository({ publish = true, receiptOverrides = {}, privateKey = null } = {}) {
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
            proposer_entity_id: 'person:proposer',
            decider_entity_id: 'person:decider',
            applier_entity_id: 'person:applier'
        },
        impact_scope: { graph_scope: 'project:brainbase', migration_required: false }
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
            schema_version: '1.0.0',
            issued_at: '2026-08-02T00:00:00.000Z',
            release_version: entry.version,
            release_digest: entry.content_digest,
            source_commit_sha: sourceCommit,
            decision_id: 'decision:ontology-v1',
            scope_entity_id: 'project:brainbase',
            proposer_entity_id: 'person:proposer',
            decider_entity_id: 'person:decider',
            applier_entity_id: 'person:applier',
            actor_entity_id: 'person:applier',
            impact_scope: { graph_scope: 'project:brainbase', migration_required: false },
            ...receiptOverrides
        },
        signature_algorithm: 'ed25519',
        signature: 'fixture',
        key_id: 'fixture'
    };
    if (privateKey) receipt.signature = sign(null, Buffer.from(canonicalJson(receipt.payload)), privateKey).toString('base64');
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
        source_commit_sha: sourceCommit,
        impact_scope: { graph_scope: 'project:brainbase', migration_required: false }
    };
    writeJson(path.join(configDir, 'index.json'), { current: '1.0.0', releases: [publishedEntry] });
    git(rootDir, ['add', '.']);
    git(rootDir, ['commit', '-m', 'publish']);
    return { rootDir, sourceCommit, publicationCommit: git(rootDir, ['rev-parse', 'HEAD']), releasePath: path.join(configDir, 'releases/1.0.0.json') };
}

function lifecycleRepository({ includeRuntime = false } = {}) {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'ontology-lifecycle-'));
    temporaryDirectories.push(rootDir);
    git(rootDir, ['init']);
    git(rootDir, ['config', 'user.email', 'ontology@example.test']);
    git(rootDir, ['config', 'user.name', 'Ontology Test']);
    const configDir = path.join(rootDir, 'config/ontology');
    mkdirSync(path.dirname(configDir), { recursive: true });
    const proposedFixture = createProposedOntologyFixture(projectRoot);
    cpSync(proposedFixture.configDir, configDir, { recursive: true });
    proposedFixture.cleanup();
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
    const indexPath = path.join(configDir, 'index.json');
    const index = JSON.parse(readFileSync(indexPath, 'utf8'));
    index.current = null;
    index.releases[0].content_digest = sha256(releaseBytes);
    writeJson(indexPath, index);
    if (includeRuntime) {
        cpSync(path.join(projectRoot, 'server'), path.join(rootDir, 'server'), { recursive: true });
        cpSync(path.join(projectRoot, 'scripts'), path.join(rootDir, 'scripts'), { recursive: true });
    }
    git(rootDir, ['add', '.']);
    git(rootDir, ['commit', '-m', 'approved source']);
    return { rootDir, release, entry: index.releases[0], sourceCommit: git(rootDir, ['rev-parse', 'HEAD']) };
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

    it('rejects reopening a published release after its lifecycle status is recorded', () => {
        const fixture = publicationRepository();
        const indexPath = path.join(fixture.rootDir, 'config/ontology/index.json');
        const index = JSON.parse(readFileSync(indexPath, 'utf8'));
        index.releases[0].status = 'approved';
        writeJson(indexPath, index);
        git(fixture.rootDir, ['add', '.']);
        git(fixture.rootDir, ['commit', '-m', 'reopen published release']);

        expect(() => verifyOntologyHistory({
            rootDir: fixture.rootDir,
            base: fixture.publicationCommit,
            head: git(fixture.rootDir, ['rev-parse', 'HEAD'])
        })).toThrow(/lifecycle changed outside the publisher/);
    });

    it('requires the newly selected current release to be active', () => {
        const fixture = publicationRepository();
        const indexPath = path.join(fixture.rootDir, 'config/ontology/index.json');
        const index = JSON.parse(readFileSync(indexPath, 'utf8'));
        index.releases[0].status = 'approved';
        writeJson(indexPath, index);
        git(fixture.rootDir, ['add', '.']);
        git(fixture.rootDir, ['commit', '-m', 'publish inactive current']);

        expect(() => verifyOntologyHistory({
            rootDir: fixture.rootDir,
            base: fixture.sourceCommit,
            head: git(fixture.rootDir, ['rev-parse', 'HEAD'])
        })).toThrow(/current release must be active after publication/);
    });

    it.each([
        ['decision_id', 'decision:other'],
        ['scope_entity_id', 'project:other'],
        ['proposer_entity_id', 'person:other-proposer'],
        ['decider_entity_id', 'person:other-decider'],
        ['applier_entity_id', 'person:other-applier'],
        ['actor_entity_id', 'person:other-actor']
    ])('rejects a validly signed receipt with substituted %s governance', (field, value) => {
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        const fixture = publicationRepository({ receiptOverrides: { [field]: value }, privateKey });
        expect(() => verifyOntologyHistory({
            rootDir: fixture.rootDir,
            base: fixture.sourceCommit,
            head: fixture.publicationCommit,
            publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString()
        })).toThrow(/governance binding mismatch/);
    });

    it.each([
        ['schema_version', '9.9.9'],
        ['issued_at', 'not-an-iso-timestamp']
    ])('rejects a validly signed receipt with invalid %s contract metadata', (field, value) => {
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        const fixture = publicationRepository({ receiptOverrides: { [field]: value }, privateKey });
        expect(() => verifyOntologyHistory({
            rootDir: fixture.rootDir,
            base: fixture.sourceCommit,
            head: fixture.publicationCommit,
            publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString()
        })).toThrow(/contract mismatch/);
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
                ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }).toString()
            },
            fetchImpl: async (url, options) => {
                observedRequest = { url, options, body: JSON.parse(options.body) };
                const payload = {
                    schema_version: '1.0.0',
                    issued_at: '2026-08-02T00:00:00.000Z',
                    actor_entity_id: 'person:applier',
                    applier_entity_id: 'person:applier',
                    proposer_entity_id: 'person:proposer',
                    decider_entity_id: 'person:decider',
                    decision_id: 'decision:ontology-v1',
                    release_digest: fixture.entry.content_digest,
                    release_version: '1.0.0',
                    scope_entity_id: 'project:brainbase',
                    impact_scope: { graph_scope: 'project:brainbase', migration_required: false },
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
            impact_scope: { graph_scope: 'project:brainbase', migration_required: false },
            proposer_entity_id: 'person:proposer',
            decider_entity_id: 'person:decider',
            applier_entity_id: 'person:applier'
        });
        expect(observedRequest.options.headers.authorization).toBe('Bearer secret-token');
        expect(result.generated).toEqual([
            'config/ontology/publications/1.0.0.receipt.json',
            'config/ontology/brainbase-ontology.v1.json',
            'config/ontology/index.json'
        ]);
    });

    it('rejects publication when the release manifest has no Decision binding', async () => {
        const fixture = publicationRepository({ publish: false });
        const release = JSON.parse(readFileSync(fixture.releasePath, 'utf8'));
        delete release.governance.decision_id;
        writeJson(fixture.releasePath, release);
        const indexPath = path.join(fixture.rootDir, 'config/ontology/index.json');
        const index = JSON.parse(readFileSync(indexPath, 'utf8'));
        index.releases[0].content_digest = sha256(readFileSync(fixture.releasePath));
        writeJson(indexPath, index);
        git(fixture.rootDir, ['add', '.']);
        git(fixture.rootDir, ['commit', '-m', 'remove decision binding']);
        let requested = false;

        await expect(publishOntologyRelease({
            rootDir: fixture.rootDir,
            version: '1.0.0',
            decisionId: 'decision:ontology-v1',
            env: {},
            fetchImpl: async () => { requested = true; }
        })).rejects.toThrow(/governance decision_id is required/);
        expect(requested).toBe(false);
    });

    it('retires the previous current release when a later release becomes active', async () => {
        const fixture = publicationRepository({ publish: false });
        const configDir = path.join(fixture.rootDir, 'config/ontology');
        const indexPath = path.join(configDir, 'index.json');
        const index = JSON.parse(readFileSync(indexPath, 'utf8'));
        index.current = '0.9.0';
        index.releases.unshift({
            version: '0.9.0',
            status: 'active',
            effective_at: '2026-07-01T00:00:00.000Z',
            path: 'releases/0.9.0.json',
            content_digest_algorithm: 'sha256',
            content_digest: '0'.repeat(64),
            receipt_path: 'publications/0.9.0.receipt.json',
            receipt_digest_algorithm: 'sha256',
            receipt_digest: '1'.repeat(64),
            source_commit_sha: '2'.repeat(40),
            impact_scope: { graph_scope: 'project:brainbase', migration_required: false }
        });
        writeJson(indexPath, index);
        git(fixture.rootDir, ['add', '.']);
        git(fixture.rootDir, ['commit', '-m', 'add previous current']);
        const sourceCommit = git(fixture.rootDir, ['rev-parse', 'HEAD']);
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');

        await publishOntologyRelease({
            rootDir: fixture.rootDir,
            version: '1.0.0',
            decisionId: 'decision:ontology-v1',
            sourceCommit,
            env: {
                BRAINBASE_GRAPH_API_URL: 'https://graph.example.test',
                BRAINBASE_GRAPH_API_TOKEN: 'secret-token',
                ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }).toString()
            },
            fetchImpl: async (_url, options) => {
                const request = JSON.parse(options.body);
                const payload = {
                    schema_version: '1.0.0',
                    issued_at: '2026-08-02T00:00:00.000Z',
                    actor_entity_id: 'person:applier',
                    applier_entity_id: 'person:applier',
                    proposer_entity_id: 'person:proposer',
                    decider_entity_id: 'person:decider',
                    decision_id: request.decision_id,
                    release_digest: request.release_digest,
                    release_version: request.release_version,
                    scope_entity_id: request.scope_entity_id,
                    impact_scope: request.impact_scope,
                    source_commit_sha: request.source_commit_sha
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

        const published = JSON.parse(readFileSync(indexPath, 'utf8'));
        expect(published.current).toBe('1.0.0');
        expect(published.releases.find(({ version }) => version === '0.9.0').status).toBe('retired');
        expect(published.releases.find(({ version }) => version === '1.0.0').status).toBe('active');

        published.releases.find(({ version }) => version === '0.9.0').status = 'active';
        writeJson(indexPath, published);
        git(fixture.rootDir, ['add', '.']);
        git(fixture.rootDir, ['commit', '-m', 'publish without retiring previous current']);

        expect(() => verifyOntologyHistory({
            rootDir: fixture.rootDir,
            base: sourceCommit,
            head: git(fixture.rootDir, ['rev-parse', 'HEAD'])
        })).toThrow(/publication must retire previous current release/);
    });

    it.each([
        ['missing', null],
        ['substituted', 'person:other-actor']
    ])('rejects a validly signed receipt with %s actor before replacing outputs', async (_label, actorEntityId) => {
        const fixture = lifecycleRepository();
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        const configDir = path.join(fixture.rootDir, 'config/ontology');
        const indexPath = path.join(configDir, 'index.json');
        const priorIndex = readFileSync(indexPath);

        await expect(publishOntologyRelease({
            rootDir: fixture.rootDir,
            version: '1.0.0',
            decisionId: 'decision:ontology-v1',
            env: {
                BRAINBASE_GRAPH_API_URL: 'https://graph.example.test',
                BRAINBASE_GRAPH_API_TOKEN: 'secret-token',
                ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }).toString()
            },
            fetchImpl: async () => {
                const payload = {
                    schema_version: '1.0.0',
                    issued_at: '2026-08-02T00:00:00.000Z',
                    applier_entity_id: 'person:applier',
                    proposer_entity_id: 'person:proposer',
                    decider_entity_id: 'person:decider',
                    decision_id: 'decision:ontology-v1',
                    release_digest: fixture.entry.content_digest,
                    release_version: '1.0.0',
                    scope_entity_id: 'project:brainbase',
                    impact_scope: fixture.release.impact_scope,
                    source_commit_sha: fixture.sourceCommit
                };
                if (actorEntityId) payload.actor_entity_id = actorEntityId;
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
        })).rejects.toThrow(/unverifiable receipt|actor_entity_id/);

        expect(readFileSync(indexPath)).toEqual(priorIndex);
        expect(() => readFileSync(path.join(configDir, 'publications/1.0.0.receipt.json'))).toThrow();
    });

    it('restores every prior output when a later replacement fails', () => {
        const fixture = publicationRepository({ publish: false });
        const configDir = path.join(fixture.rootDir, 'config/ontology');
        const viewPath = path.join(configDir, 'brainbase-ontology.v1.json');
        const indexPath = path.join(configDir, 'index.json');
        mkdirSync(path.join(configDir, 'publications'));
        writeFileSync(viewPath, 'prior-view\n');
        const priorIndex = readFileSync(indexPath);
        let renameCount = 0;
        expect(() => replacePublicationOutputs([
            [path.join(configDir, 'publications/1.0.0.receipt.json'), Buffer.from('receipt\n')],
            [viewPath, Buffer.from('next-view\n')],
            [indexPath, Buffer.from('next-index\n')]
        ], {
            renameSync: (source, target) => {
                renameCount += 1;
                if (renameCount === 3) throw new Error('fixture rename failure');
                return execFileSync('mv', [source, target]);
            }
        })).toThrow(/prior current was restored/);
        expect(readFileSync(viewPath, 'utf8')).toBe('prior-view\n');
        expect(readFileSync(indexPath)).toEqual(priorIndex);
        expect(() => readFileSync(path.join(configDir, 'publications/1.0.0.receipt.json'))).toThrow();
    });

    it('runs current-null through signed publication to an active generic write guard', async () => {
        const fixture = lifecycleRepository();
        const proposedRegistry = new OntologyRegistry({ rootDir: fixture.rootDir });
        expect(proposedRegistry.index.current).toBeNull();
        expect(proposedRegistry.resolve({ version: '1.0.0' }).kernel.describe().effective_status).toBe('proposed');
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        await publishOntologyRelease({
            rootDir: fixture.rootDir,
            version: '1.0.0',
            decisionId: 'decision:ontology-v1',
            env: {
                BRAINBASE_GRAPH_API_URL: 'https://graph.example.test',
                BRAINBASE_GRAPH_API_TOKEN: 'secret-token',
                ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }).toString()
            },
            fetchImpl: async (_url, options) => {
                const requestBody = JSON.parse(options.body);
                const payload = {
                    schema_version: '1.0.0',
                    issued_at: '2026-08-02T00:00:00.000Z',
                    actor_entity_id: 'person:applier',
                    applier_entity_id: 'person:applier',
                    proposer_entity_id: 'person:proposer',
                    decider_entity_id: 'person:decider',
                    decision_id: 'decision:ontology-v1',
                    release_digest: fixture.entry.content_digest,
                    release_version: '1.0.0',
                    scope_entity_id: 'project:brainbase',
                    impact_scope: fixture.release.impact_scope,
                    source_commit_sha: fixture.sourceCommit
                };
                expect(requestBody).toMatchObject({
                    release_version: payload.release_version,
                    release_digest: payload.release_digest,
                    source_commit_sha: payload.source_commit_sha,
                    decision_id: payload.decision_id,
                    scope_entity_id: payload.scope_entity_id,
                    impact_scope: payload.impact_scope,
                    proposer_entity_id: payload.proposer_entity_id,
                    decider_entity_id: payload.decider_entity_id,
                    applier_entity_id: payload.applier_entity_id
                });
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
        let untrustedConnectionAttempts = 0;
        const untrustedService = new InfoSSOTService({
            ontologyRegistry: new OntologyRegistry({ rootDir: fixture.rootDir, publicKeyPem: '' }),
            pool: {
                connect: async () => {
                    untrustedConnectionAttempts += 1;
                    throw new Error('must not connect');
                }
            }
        });
        await expect(untrustedService.createOrUpdateGraphEntity(
            { role: 'gm', projectCodes: ['brainbase'], clearance: ['internal'] },
            {
                id: 'org:untrusted',
                entityType: 'org',
                projectCode: 'brainbase',
                payload: {},
                roleMin: 'member',
                sensitivity: 'internal'
            }
        )).rejects.toMatchObject({ code: 'ONTOLOGY_PUBLICATION_UNVERIFIED' });
        expect(untrustedConnectionAttempts).toBe(0);

        const activeRegistry = new OntologyRegistry({
            rootDir: fixture.rootDir,
            publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString()
        });
        expect(activeRegistry.index.current).toBe('1.0.0');
        const service = new InfoSSOTService({ ontologyRegistry: activeRegistry, pool: { connect: async () => { throw new Error('must not persist'); } } });
        expect(service.getOntologyGuard()).toEqual({ guard_status: 'active_current', ontology_version: '1.0.0' });
        await expect(service.createOrUpdateGraphEntity(
            { role: 'gm', projectCodes: ['brainbase'], clearance: ['internal'] },
            {
                id: 'unknown:one',
                entityType: 'unknown_type',
                projectCode: 'brainbase',
                payload: {},
                roleMin: 'member',
                sensitivity: 'internal'
            }
        )).rejects.toMatchObject({ code: 'ONTOLOGY_VALIDATION_FAILED' });
    });

    it('rejects invalid signed contract metadata on the current-only verification path', async () => {
        const fixture = lifecycleRepository({ includeRuntime: true });
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
        await publishOntologyRelease({
            rootDir: fixture.rootDir,
            version: '1.0.0',
            decisionId: 'decision:ontology-v1',
            env: {
                BRAINBASE_GRAPH_API_URL: 'https://graph.example.test',
                BRAINBASE_GRAPH_API_TOKEN: 'secret-token',
                ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY: publicKeyPem
            },
            fetchImpl: async () => {
                const payload = {
                    schema_version: '1.0.0',
                    issued_at: '2026-08-02T00:00:00.000Z',
                    actor_entity_id: 'person:applier',
                    applier_entity_id: 'person:applier',
                    proposer_entity_id: 'person:proposer',
                    decider_entity_id: 'person:decider',
                    decision_id: 'decision:ontology-v1',
                    release_digest: fixture.entry.content_digest,
                    release_version: '1.0.0',
                    scope_entity_id: 'project:brainbase',
                    impact_scope: fixture.release.impact_scope,
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
        const receiptPath = path.join(fixture.rootDir, 'config/ontology/publications/1.0.0.receipt.json');
        const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
        receipt.payload.issued_at = 'invalid';
        receipt.signature = sign(null, Buffer.from(canonicalJson(receipt.payload)), privateKey).toString('base64');
        writeJson(receiptPath, receipt);
        const indexPath = path.join(fixture.rootDir, 'config/ontology/index.json');
        const index = JSON.parse(readFileSync(indexPath, 'utf8'));
        index.releases[0].receipt_digest = sha256(readFileSync(receiptPath));
        writeJson(indexPath, index);

        expect(() => verifyOntologyRelease({ rootDir: fixture.rootDir, publicKeyPem })).toThrow(/contract mismatch: issued_at/);
    });

    it('verifies an active current release through the repository trust store without an environment key', () => {
        expect(verifyOntologyRelease({ rootDir: projectRoot })).toMatchObject({
            current: '1.0.0',
            release_count: 2
        });
    });

    it('rejects a retired release without an immutable receipt binding', () => {
        const fixture = lifecycleRepository({ includeRuntime: true });
        const indexPath = path.join(fixture.rootDir, 'config/ontology/index.json');
        const index = JSON.parse(readFileSync(indexPath, 'utf8'));
        index.releases[0].status = 'retired';
        delete index.releases[0].receipt_path;
        delete index.releases[0].receipt_digest;
        writeJson(indexPath, index);

        expect(() => verifyOntologyRelease({ rootDir: fixture.rootDir })).toThrow(/retired release has no receipt binding/);
    });

    it.each([
        ['path only', {
            receipt_path: 'publications/1.0.0.receipt.json'
        }],
        ['blank path', {
            receipt_path: '   ',
            receipt_digest_algorithm: 'sha256',
            receipt_digest: 'a'.repeat(64)
        }],
        ['unsupported algorithm', {
            receipt_path: 'publications/1.0.0.receipt.json',
            receipt_digest_algorithm: 'sha512',
            receipt_digest: 'a'.repeat(64)
        }],
        ['malformed digest', {
            receipt_path: 'publications/1.0.0.receipt.json',
            receipt_digest_algorithm: 'sha256',
            receipt_digest: 'not-a-sha256-digest'
        }]
    ])('rejects partial receipt metadata on a proposed release: %s', (_label, receiptMetadata) => {
        const fixture = lifecycleRepository({ includeRuntime: true });
        const indexPath = path.join(fixture.rootDir, 'config/ontology/index.json');
        const index = JSON.parse(readFileSync(indexPath, 'utf8'));
        Object.assign(index.releases[0], receiptMetadata);
        writeJson(indexPath, index);

        expect(() => verifyOntologyRelease({ rootDir: fixture.rootDir })).toThrow(/incomplete receipt binding/);
    });

    it('fails closed on authority network and incomplete-response failures without publishing outputs', async () => {
        for (const [label, fetchImpl, expected] of [
            ['network', async () => { throw new Error('secret upstream detail'); }, /authority request failed \(Error\)/],
            ['incomplete', async () => ({ ok: true, json: async () => ({ payload: {} }) }), /unverifiable receipt/]
        ]) {
            const fixture = lifecycleRepository();
            await expect(publishOntologyRelease({
                rootDir: fixture.rootDir,
                version: '1.0.0',
                decisionId: 'decision:ontology-v1',
                env: {
                    BRAINBASE_GRAPH_API_URL: 'https://graph.example.test',
                    BRAINBASE_GRAPH_API_TOKEN: `secret-${label}`,
                    ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY: 'unused-fixture-key'
                },
                fetchImpl
            })).rejects.toThrow(expected);
            const index = JSON.parse(readFileSync(path.join(fixture.rootDir, 'config/ontology/index.json'), 'utf8'));
            expect(index.current).toBeNull();
            expect(index.releases[0].receipt_path).toBeUndefined();
        }
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
