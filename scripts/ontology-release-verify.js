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
        for (const ref of [base, head]) execFileSync('git', ['cat-file', '-e', `${ref}^{commit}`], { cwd: rootDir, stdio: 'ignore' });
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
