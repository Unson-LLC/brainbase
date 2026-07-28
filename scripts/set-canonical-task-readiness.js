#!/usr/bin/env node
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

import { verifyBeforeEnableEvidenceFile } from './preflight-canonical-task-cutover.js';
import {
    canonicalTaskBackendIdentityHash,
    createCanonicalTaskStoreConfig,
    resolveCanonicalTaskBackend
} from '../server/services/companion/canonical-task-store-config.js';

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

export function parseCanonicalTaskReadinessArgs(argv) {
    const parsed = {};
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--enable') parsed.enable = true;
        else if (argument === '--disable') parsed.disable = true;
        else if (argument === '--evidence') parsed.evidencePath = argv[++index];
        else if (argument === '--reason') parsed.reason = argv[++index];
        else throw new Error(`Unknown argument: ${argument}`);
    }
    if (Boolean(parsed.enable) === Boolean(parsed.disable)) throw new Error('Specify exactly one of --enable or --disable');
    if (parsed.enable && !parsed.evidencePath) throw new Error('--enable requires --evidence');
    if (parsed.disable && !parsed.reason) throw new Error('--disable requires --reason');
    return parsed;
}

export async function setCanonicalTaskReadiness({
    argv = process.argv.slice(2),
    pool = null,
    rootDir = process.cwd(),
    sourceHead = null
} = {}) {
    const args = parseCanonicalTaskReadinessArgs(argv);
    const databaseUrl = process.env.INFO_SSOT_DATABASE_URL || process.env.INFO_SSOT_DB_URL;
    const activePool = pool || (databaseUrl ? new Pool({ connectionString: databaseUrl }) : null);
    if (!activePool) throw new Error('INFO_SSOT_DATABASE_URL is required');
    const client = await activePool.connect();
    try {
        await client.query('BEGIN');
        if (args.disable) {
            await client.query(
                `INSERT INTO canonical_task_readiness (singleton_id, ready, reason, updated_at)
                 VALUES (TRUE, FALSE, $1, NOW())
                 ON CONFLICT (singleton_id) DO UPDATE SET ready = FALSE, reason = EXCLUDED.reason, updated_at = NOW()`,
                [args.reason]
            );
            await client.query('COMMIT');
            return { ready: false, reason: args.reason };
        }

        const config = createCanonicalTaskStoreConfig();
        const backendIdentityHash = canonicalTaskBackendIdentityHash(config, resolveCanonicalTaskBackend());
        const resolvedSourceHead = sourceHead
            || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }).trim();
        const verified = await verifyBeforeEnableEvidenceFile({
            rootDir,
            evidencePath: args.evidencePath,
            sourceHead: resolvedSourceHead,
            manifestPath: config.manifestPath
        });
        const evidenceBytes = verified.bytes;
        const evidence = verified.evidence;
        if (evidence.manifest_hash !== backendIdentityHash) throw new Error('Evidence manifest_hash does not match the canonical store');
        if (evidence.schema_version !== config.schemaVersion) throw new Error('Evidence schema_version does not match the canonical store');
        const writer = await client.query(
            `SELECT writer_token, source_head FROM canonical_task_writer
             WHERE singleton_id = TRUE FOR UPDATE`
        );
        if (!writer.rowCount
            || writer.rows[0].writer_token !== evidence.writer_token
            || writer.rows[0].source_head !== resolvedSourceHead) {
            throw new Error('Evidence writer claim does not match the active writer token and source HEAD');
        }
        const evidenceHash = sha256(evidenceBytes);
        await client.query(
            `INSERT INTO canonical_task_readiness (
                singleton_id, ready, writer_token, manifest_hash, schema_version,
                source_head, evidence_hash, evidence_path, reason, updated_at
             ) VALUES (TRUE, TRUE, $1, $2, $3, $4, $5, $6, NULL, NOW())
             ON CONFLICT (singleton_id) DO UPDATE SET
                ready = TRUE,
                writer_token = EXCLUDED.writer_token,
                manifest_hash = EXCLUDED.manifest_hash,
                schema_version = EXCLUDED.schema_version,
                source_head = EXCLUDED.source_head,
                evidence_hash = EXCLUDED.evidence_hash,
                evidence_path = EXCLUDED.evidence_path,
                reason = NULL,
                updated_at = NOW()`,
            [evidence.writer_token, backendIdentityHash, config.schemaVersion, resolvedSourceHead, evidenceHash, args.evidencePath]
        );
        await client.query('COMMIT');
        return { ready: true, evidence_hash: evidenceHash, source_head: resolvedSourceHead };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
        if (!pool) await activePool.end();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    setCanonicalTaskReadiness()
        .then((result) => console.log(JSON.stringify(result)))
        .catch((error) => {
            console.error(error.message);
            process.exitCode = 1;
        });
}
