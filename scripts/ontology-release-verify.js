#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sha256, verifyPublicationReceipt } from '../server/services/ontology-publication.js';
import { verifyWriterInventory } from './ontology-writer-inventory.js';

function fail(message) {
    process.stderr.write(`ontology:verify: ${message}\n`);
    process.exitCode = 1;
}

function parseArgs(argv) {
    const result = {};
    for (let index = 0; index < argv.length; index += 2) {
        const key = argv[index]?.replace(/^--/, '');
        if (key) result[key] = argv[index + 1];
    }
    return result;
}

function git(rootDir, args, options = {}) {
    return execFileSync('git', args, { cwd: rootDir, encoding: options.encoding ?? 'utf8', stdio: options.stdio }).trim();
}

function gitBytes(rootDir, ref, relativePath, { optional = false } = {}) {
    try {
        return execFileSync('git', ['show', `${ref}:${relativePath}`], {
            cwd: rootDir,
            stdio: optional ? ['ignore', 'pipe', 'ignore'] : undefined
        });
    } catch (error) {
        if (optional) return null;
        throw error;
    }
}

function gitJson(rootDir, ref, relativePath, options) {
    const bytes = gitBytes(rootDir, ref, relativePath, options);
    return bytes ? JSON.parse(bytes.toString('utf8')) : null;
}

function assertAncestor(rootDir, ancestor, descendant, label) {
    try {
        execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: rootDir, stdio: 'ignore' });
    } catch {
        throw new Error(`${label} is not reachable: ${ancestor} -> ${descendant}`);
    }
}

function publicationBinding(entry) {
    return JSON.stringify({
        version: entry.version,
        path: entry.path,
        content_digest: entry.content_digest,
        receipt_path: entry.receipt_path,
        receipt_digest: entry.receipt_digest,
        source_commit_sha: entry.source_commit_sha
    });
}

export function verifyOntologyHistory({ rootDir, publicKeyPem = '', base, head }) {
    for (const ref of [base, head]) execFileSync('git', ['cat-file', '-e', `${ref}^{commit}`], { cwd: rootDir, stdio: 'ignore' });
    const indexPath = 'config/ontology/index.json';
    const baseIndex = gitJson(rootDir, base, indexPath, { optional: true }) || { current: null, releases: [] };
    const headIndex = gitJson(rootDir, head, indexPath);
    const baseEntries = new Map((baseIndex.releases || []).map((entry) => [entry.version, entry]));
    const headEntries = new Map((headIndex.releases || []).map((entry) => [entry.version, entry]));

    for (const baseEntry of baseEntries.values()) {
        if (!baseEntry.receipt_path) continue;
        const headEntry = headEntries.get(baseEntry.version);
        if (!headEntry || publicationBinding(headEntry) !== publicationBinding(baseEntry)) {
            throw new Error(`published release binding changed or disappeared: ${baseEntry.version}`);
        }
        for (const relativePath of [`config/ontology/${baseEntry.path}`, `config/ontology/${baseEntry.receipt_path}`]) {
            if (!gitBytes(rootDir, base, relativePath).equals(gitBytes(rootDir, head, relativePath))) {
                throw new Error(`published object mutated: ${relativePath}`);
            }
        }
    }

    for (const entry of headEntries.values()) {
        if (!entry.receipt_path || baseEntries.get(entry.version)?.receipt_path) continue;
        if (!entry.source_commit_sha) throw new Error(`published release has no source commit: ${entry.version}`);
        const receiptPath = `config/ontology/${entry.receipt_path}`;
        const publicationCommits = git(rootDir, ['log', '--format=%H', '--diff-filter=A', `${base}..${head}`, '--', receiptPath])
            .split('\n').filter(Boolean);
        if (publicationCommits.length !== 1) throw new Error(`receipt must be introduced by exactly one publication commit: ${entry.version}`);
        const publicationCommit = publicationCommits[0];
        const parents = git(rootDir, ['rev-list', '--parents', '-n', '1', publicationCommit]).split(/\s+/).slice(1);
        if (parents.length !== 1 || parents[0] !== entry.source_commit_sha) {
            throw new Error(`publication commit must be the direct child of its source commit: ${entry.version}`);
        }
        assertAncestor(rootDir, entry.source_commit_sha, publicationCommit, 'source commit');
        assertAncestor(rootDir, publicationCommit, head, 'publication commit');
        const allowed = new Set([
            receiptPath,
            indexPath,
            'config/ontology/brainbase-ontology.v1.json'
        ]);
        const changed = git(rootDir, ['diff-tree', '--no-commit-id', '--name-only', '-r', publicationCommit]).split('\n').filter(Boolean);
        if (changed.length !== allowed.size || changed.some((item) => !allowed.has(item))) {
            throw new Error(`publication commit changed files outside the generated allowlist: ${entry.version}`);
        }
        const releasePath = `config/ontology/${entry.path}`;
        const sourceRelease = gitBytes(rootDir, entry.source_commit_sha, releasePath);
        const headRelease = gitBytes(rootDir, head, releasePath);
        if (!sourceRelease.equals(headRelease) || sha256(sourceRelease) !== entry.content_digest) {
            throw new Error(`published release is not byte-bound to its source commit: ${entry.version}`);
        }
        const receiptBytes = gitBytes(rootDir, publicationCommit, receiptPath);
        if (sha256(receiptBytes) !== entry.receipt_digest) throw new Error(`published receipt digest mismatch: ${entry.version}`);
        const receipt = JSON.parse(receiptBytes.toString('utf8'));
        if (receipt.payload.source_commit_sha !== entry.source_commit_sha
            || receipt.payload.release_version !== entry.version
            || receipt.payload.release_digest !== entry.content_digest) {
            throw new Error(`published receipt binding mismatch: ${entry.version}`);
        }
        if (publicKeyPem && !verifyPublicationReceipt(receipt, publicKeyPem)) {
            throw new Error(`published receipt signature is invalid: ${entry.version}`);
        }
    }
    return { base_current: baseIndex.current, head_current: headIndex.current };
}

export function verifyOntologyRelease({ rootDir, publicKeyPem = '', base = null, head = null } = {}) {
    verifyWriterInventory({ rootDir });
    const configDir = path.join(rootDir, 'config/ontology');
    const indexPath = path.join(configDir, 'index.json');
    const indexBytes = readFileSync(indexPath);
    const index = JSON.parse(indexBytes.toString('utf8'));
    const versions = new Set();

    for (const entry of index.releases || []) {
        if (versions.has(entry.version)) throw new Error(`version is reused: ${entry.version}`);
        versions.add(entry.version);
        if (entry.content_digest_algorithm !== 'sha256') throw new Error(`unsupported digest algorithm: ${entry.version}`);
        const releasePath = path.resolve(configDir, entry.path);
        if (!releasePath.startsWith(`${path.resolve(configDir, 'releases')}${path.sep}`)) throw new Error(`release path escapes releases/: ${entry.path}`);
        const releaseBytes = readFileSync(releasePath);
        if (sha256(releaseBytes) !== entry.content_digest) throw new Error(`release digest mismatch: ${entry.version}`);
        const release = JSON.parse(releaseBytes.toString('utf8'));
        if (release.version !== entry.version || release.effective_at !== entry.effective_at) throw new Error(`release metadata mismatch: ${entry.version}`);
    }

    if (index.current) {
        const entry = index.releases.find((item) => item.version === index.current);
        if (!entry?.receipt_path || !entry?.receipt_digest) throw new Error(`current release has no receipt binding: ${index.current}`);
        if (!publicKeyPem) throw new Error('ONTOLOGY_RECEIPT_PUBLIC_KEY is required for an active current release');
        const receiptBytes = readFileSync(path.resolve(configDir, entry.receipt_path));
        if (sha256(receiptBytes) !== entry.receipt_digest) throw new Error(`receipt digest mismatch: ${index.current}`);
        const receipt = JSON.parse(receiptBytes.toString('utf8'));
        if (!verifyPublicationReceipt(receipt, publicKeyPem)) throw new Error(`receipt signature is invalid: ${index.current}`);
        if (receipt.payload.release_version !== entry.version || receipt.payload.release_digest !== entry.content_digest) {
            throw new Error(`receipt binding mismatch: ${index.current}`);
        }
        const viewBytes = readFileSync(path.join(configDir, 'brainbase-ontology.v1.json'));
        const releaseBytes = readFileSync(path.resolve(configDir, entry.path));
        if (!viewBytes.equals(releaseBytes)) throw new Error('compatibility view drift');
    }

    if (base || head) {
        if (!base || !head) throw new Error('--base and --head must be provided together');
        verifyOntologyHistory({ rootDir, publicKeyPem, base, head });
    }
    return { current: index.current, release_count: versions.size };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        const args = parseArgs(process.argv.slice(2));
        const result = verifyOntologyRelease({
            rootDir: process.cwd(),
            publicKeyPem: process.env.ONTOLOGY_RECEIPT_PUBLIC_KEY || '',
            base: args.base || null,
            head: args.head || null
        });
        process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
    }
}
