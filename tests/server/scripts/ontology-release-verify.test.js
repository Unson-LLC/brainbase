import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sha256 } from '../../../server/services/ontology-publication.js';
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

function publicationRepository() {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'ontology-history-'));
    temporaryDirectories.push(rootDir);
    git(rootDir, ['init']);
    git(rootDir, ['config', 'user.email', 'ontology@example.test']);
    git(rootDir, ['config', 'user.name', 'Ontology Test']);
    const configDir = path.join(rootDir, 'config/ontology');
    mkdirSync(path.join(configDir, 'releases'), { recursive: true });
    const releaseBytes = Buffer.from('{"version":"1.0.0","effective_at":"2026-08-01T00:00:00.000Z"}\n');
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
