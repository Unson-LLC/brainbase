#!/usr/bin/env node
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sha256, verifyPublicationReceipt } from '../server/services/ontology-publication.js';

function required(name) {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required`);
    return value;
}

function option(name) {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
    const rootDir = process.cwd();
    const version = option('version');
    if (!version) throw new Error('--version is required');
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: rootDir, encoding: 'utf8' }).trim();
    if (status) throw new Error('source checkout must be clean before publication');
    const sourceCommit = option('source-commit') || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }).trim();
    execFileSync('git', ['cat-file', '-e', `${sourceCommit}^{commit}`], { cwd: rootDir, stdio: 'ignore' });

    const configDir = path.join(rootDir, 'config/ontology');
    const indexPath = path.join(configDir, 'index.json');
    const index = JSON.parse(readFileSync(indexPath, 'utf8'));
    const entry = index.releases.find((item) => item.version === version);
    if (!entry) throw new Error(`release is not indexed: ${version}`);
    if (index.current === version || entry.receipt_path) throw new Error(`release is already published: ${version}`);
    const releasePath = path.resolve(configDir, entry.path);
    const releaseBytes = readFileSync(releasePath);
    if (sha256(releaseBytes) !== entry.content_digest) throw new Error(`release digest mismatch: ${version}`);

    const response = await fetch(`${required('BRAINBASE_GRAPH_API_URL').replace(/\/$/, '')}/api/info/ontology/publications/authorize`, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${required('BRAINBASE_GRAPH_API_TOKEN')}`,
            'content-type': 'application/json',
            'x-brainbase-role': process.env.BRAINBASE_ROLE || 'gm',
            'x-brainbase-projects': process.env.BRAINBASE_PROJECTS || 'brainbase',
            'x-brainbase-clearance': process.env.BRAINBASE_CLEARANCE || 'internal,restricted'
        },
        body: JSON.stringify({
            release_version: version,
            source_commit_sha: sourceCommit,
            release_digest: entry.content_digest,
            decision_id: required('ONTOLOGY_DECISION_ID'),
            scope_entity_id: required('ONTOLOGY_SCOPE_ENTITY_ID'),
            applier_entity_id: required('ONTOLOGY_APPLIER_ENTITY_ID')
        })
    });
    const receipt = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`authority denied (${response.status}): ${receipt.code || receipt.error || 'unknown error'}`);
    if (!verifyPublicationReceipt(receipt, required('ONTOLOGY_RECEIPT_PUBLIC_KEY'))) throw new Error('authority returned an unverifiable receipt');

    const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    const receiptRelative = `publications/${version}.receipt.json`;
    const receiptPath = path.join(configDir, receiptRelative);
    mkdirSync(path.dirname(receiptPath), { recursive: true });
    const nextEntry = {
        ...entry,
        status: 'active',
        receipt_path: receiptRelative,
        receipt_digest_algorithm: 'sha256',
        receipt_digest: sha256(receiptBytes),
        source_commit_sha: sourceCommit
    };
    const nextIndex = { ...index, current: version, releases: index.releases.map((item) => item.version === version ? nextEntry : item) };
    const outputs = [
        [receiptPath, receiptBytes],
        [path.join(configDir, 'brainbase-ontology.v1.json'), releaseBytes],
        [indexPath, Buffer.from(`${JSON.stringify(nextIndex, null, 2)}\n`)]
    ];
    for (const [target, bytes] of outputs) writeFileSync(`${target}.tmp`, bytes);
    for (const [target] of outputs) renameSync(`${target}.tmp`, target);
    process.stdout.write(`${JSON.stringify({ version, source_commit_sha: sourceCommit, generated: outputs.map(([target]) => path.relative(rootDir, target)) })}\n`);
}

main().catch((error) => {
    process.stderr.write(`ontology:publish: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
