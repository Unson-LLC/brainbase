#!/usr/bin/env node
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sha256, verifyPublicationReceipt } from '../server/services/ontology-publication.js';

function required(env, name) {
    const value = env[name];
    if (!value) throw new Error(`${name} is required`);
    return value;
}

function option(name) {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 ? process.argv[index + 1] : null;
}

export async function publishOntologyRelease({
    rootDir = process.cwd(),
    version,
    decisionId,
    sourceCommit: requestedSourceCommit = null,
    env = process.env,
    fetchImpl = fetch
}) {
    if (!version) throw new Error('--version is required');
    if (!decisionId) throw new Error('--decision-id is required');
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: rootDir, encoding: 'utf8' }).trim();
    if (status) throw new Error('source checkout must be clean before publication');
    const sourceCommit = requestedSourceCommit || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }).trim();
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
    const release = JSON.parse(releaseBytes.toString('utf8'));
    const scopeEntityId = release.governance?.scope_entity_id;
    const applierEntityId = release.governance?.applier_entity_id;
    if (!scopeEntityId || !applierEntityId) {
        throw new Error('release governance.scope_entity_id and governance.applier_entity_id are required');
    }
    if (release.governance?.decision_id && release.governance.decision_id !== decisionId) {
        throw new Error('--decision-id does not match release governance.decision_id');
    }

    const response = await fetchImpl(`${required(env, 'BRAINBASE_GRAPH_API_URL').replace(/\/$/, '')}/api/info/ontology/publications/authorize`, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${required(env, 'BRAINBASE_GRAPH_API_TOKEN')}`,
            'content-type': 'application/json',
            'x-brainbase-role': env.BRAINBASE_ROLE || 'gm',
            'x-brainbase-projects': env.BRAINBASE_PROJECTS || 'brainbase',
            'x-brainbase-clearance': env.BRAINBASE_CLEARANCE || 'internal,restricted'
        },
        body: JSON.stringify({
            release_version: version,
            source_commit_sha: sourceCommit,
            release_digest: entry.content_digest,
            decision_id: decisionId,
            scope_entity_id: scopeEntityId,
            applier_entity_id: applierEntityId
        })
    });
    const receipt = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`authority denied (${response.status}): ${receipt.code || receipt.error || 'unknown error'}`);
    if (!verifyPublicationReceipt(receipt, required(env, 'ONTOLOGY_RECEIPT_PUBLIC_KEY'))) throw new Error('authority returned an unverifiable receipt');

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
    return { version, source_commit_sha: sourceCommit, generated: outputs.map(([target]) => path.relative(rootDir, target)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    publishOntologyRelease({
        version: option('version'),
        decisionId: option('decision-id') || process.env.ONTOLOGY_DECISION_ID,
        sourceCommit: option('source-commit')
    }).then((result) => {
        process.stdout.write(`${JSON.stringify(result)}\n`);
    }).catch((error) => {
        process.stderr.write(`ontology:publish: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
