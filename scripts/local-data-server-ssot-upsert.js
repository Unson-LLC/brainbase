#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
    collectLocalInventory,
    compareWithServer,
    loadServerRows,
    sha256
} from './local-data-server-ssot-inventory.js';

const SUPPORTED_TARGET_TABLES = new Set(['graph_entities', 'wiki_pages']);
const DEFAULT_MAX_WRITES = 100;
const MIGRATION_SOURCE = 'local_ssot_additive_upsert';

function stableTargetId(item) {
    const prefix = item.target_table === 'wiki_pages' ? 'wiki' : String(item.target_type || 'entity').slice(0, 8);
    return `lssot_${prefix}_${sha256(`${item.target_table}|${item.target_type}|${item.source_path}`).slice(0, 24)}`;
}

function countBy(items, keyFn) {
    const result = {};
    for (const item of items) {
        const key = keyFn(item);
        result[key] = (result[key] || 0) + 1;
    }
    return result;
}

function skipReasonForItem(item) {
    if (item.migration_status !== 'local_only') return `status:${item.migration_status}`;
    if (!SUPPORTED_TARGET_TABLES.has(item.target_table)) return `unsupported_target:${item.target_table}`;
    if (!item.content_hash) return 'missing_content_hash';
    if (!item.absolute_path) return 'missing_absolute_path';
    return null;
}

function buildUpsertPlan(items, options = {}) {
    const targetTables = new Set(options.targetTables || SUPPORTED_TARGET_TABLES);
    const operations = [];
    const skips = [];

    for (const item of items) {
        const reason = skipReasonForItem(item);
        if (reason || !targetTables.has(item.target_table)) {
            skips.push({
                reason: reason || `filtered_target:${item.target_table}`,
                migration_status: item.migration_status,
                target_table: item.target_table,
                target_type: item.target_type,
                source_path: item.source_path,
                review_reason: item.review_reason || null
            });
            continue;
        }

        operations.push({
            action: 'insert',
            target_table: item.target_table,
            target_type: item.target_type,
            target_id: stableTargetId(item),
            source_path: item.source_path,
            absolute_path: item.absolute_path,
            source_root: item.source_root || null,
            source_kind: item.source_kind,
            source_subtype: item.source_subtype,
            target_key: item.target_key || null,
            title: item.title || path.basename(item.source_path),
            content_hash: item.content_hash
        });
    }

    return {
        operations,
        skips,
        summary: {
            total: items.length,
            operations: operations.length,
            skipped: skips.length,
            by_operation_target: countBy(operations, (operation) => `${operation.target_table}:${operation.target_type}`),
            by_skip_reason: countBy(skips, (skip) => skip.reason)
        }
    };
}

function assertExecuteAllowed({ execute = false, confirm = false, maxWrites = DEFAULT_MAX_WRITES, connectionString = null } = {}, plan) {
    if (!execute) return;
    if (!confirm) {
        throw new Error('execute mode requires --confirm-additive-upsert');
    }
    if (!connectionString) {
        throw new Error('execute mode requires INFO_SSOT_DATABASE_URL, INFO_SSOT_DB_URL, or DATABASE_URL');
    }
    if (!Number.isInteger(maxWrites) || maxWrites < 0) {
        throw new Error('--max-writes must be a non-negative integer');
    }
    if (plan.operations.length > maxWrites) {
        throw new Error(`planned writes ${plan.operations.length} exceed --max-writes ${maxWrites}`);
    }
}

function readOperationContent(operation) {
    const content = fs.readFileSync(operation.absolute_path, 'utf8');
    return {
        content,
        sizeBytes: Buffer.byteLength(content, 'utf8')
    };
}

async function insertGraphEntity(client, operation) {
    const { content, sizeBytes } = readOperationContent(operation);
    const payload = {
        name: operation.title,
        title: operation.title,
        path: operation.source_path,
        source_kind: operation.source_kind,
        source_subtype: operation.source_subtype,
        target_key: operation.target_key,
        content_hash: operation.content_hash,
        size_bytes: sizeBytes,
        content,
        local_source_root: operation.source_root,
        migration_source: MIGRATION_SOURCE
    };

    const result = await client.query(
        `INSERT INTO graph_entities (id, entity_type, project_id, payload, role_min, sensitivity, created_at, updated_at)
         SELECT $1, $2, NULL, $3::jsonb, $4, $5, NOW(), NOW()
         WHERE NOT EXISTS (
           SELECT 1 FROM graph_entities
           WHERE entity_type = $2 AND payload->>'path' = $6
         )
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [
            operation.target_id,
            operation.target_type,
            JSON.stringify(payload),
            'member',
            'internal',
            operation.source_path
        ]
    );
    return result.rows?.length ? 'inserted' : 'skipped_existing';
}

async function insertWikiPage(client, operation) {
    const { content, sizeBytes } = readOperationContent(operation);
    const result = await client.query(
        `INSERT INTO wiki_pages (id, path, title, role_min, sensitivity, project_id, content_hash, size_bytes, content, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, NOW(), NOW())
         ON CONFLICT (path) DO NOTHING
         RETURNING id`,
        [
            operation.target_id,
            operation.source_path,
            operation.title,
            'member',
            'internal',
            operation.content_hash,
            sizeBytes,
            content
        ]
    );
    return result.rows?.length ? 'inserted' : 'skipped_existing';
}

async function applyUpsertPlan(plan, options = {}) {
    if (!options.execute) {
        return { dry_run: true, inserted: 0, skipped_existing: 0, operations: plan.operations.length };
    }

    const pg = options.client ? null : await import('pg');
    const pool = options.client ? null : new pg.Pool({ connectionString: options.connectionString });
    const client = options.client || await pool.connect();
    const useTransaction = !options.client;
    const result = { dry_run: false, inserted: 0, skipped_existing: 0, operations: plan.operations.length };

    try {
        if (useTransaction) await client.query('BEGIN');
        for (const operation of plan.operations) {
            const status = operation.target_table === 'graph_entities'
                ? await insertGraphEntity(client, operation)
                : await insertWikiPage(client, operation);
            result[status] = (result[status] || 0) + 1;
        }
        if (useTransaction) await client.query('COMMIT');
        return result;
    } catch (error) {
        if (useTransaction) await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        if (!options.client) {
            client.release();
            await pool.end().catch(() => {});
        }
    }
}

function readServerIndexJson(filePath) {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.rows)) return parsed.rows;
    if (Array.isArray(parsed.serverRows)) return parsed.serverRows;
    if (Array.isArray(parsed.items)) return parsed.items;
    throw new Error('--server-index-json must contain an array, rows, serverRows, or items');
}

function parseArgs(argv) {
    const args = {
        json: false,
        execute: false,
        confirm: false,
        limit: null,
        maxWrites: DEFAULT_MAX_WRITES,
        includeConversationLogs: true,
        compareServer: true,
        targetTables: null
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--json') args.json = true;
        else if (arg === '--execute') args.execute = true;
        else if (arg === '--confirm-additive-upsert') args.confirm = true;
        else if (arg === '--compare-server') args.compareServer = true;
        else if (arg === '--allow-offline-plan') args.compareServer = false;
        else if (arg === '--no-conversation-logs') args.includeConversationLogs = false;
        else if (arg === '--no-workspace-content') args.includeWorkspaceContent = false;
        else if (arg === '--codex-root') args.codexRoot = argv[++index];
        else if (arg.startsWith('--codex-root=')) args.codexRoot = arg.slice('--codex-root='.length);
        else if (arg === '--workspace-root') args.workspaceRoot = argv[++index];
        else if (arg.startsWith('--workspace-root=')) args.workspaceRoot = arg.slice('--workspace-root='.length);
        else if (arg === '--workspace-content-dir') {
            args.workspaceContentDirs = args.workspaceContentDirs || [];
            args.workspaceContentDirs.push(argv[++index]);
        } else if (arg.startsWith('--workspace-content-dir=')) {
            args.workspaceContentDirs = args.workspaceContentDirs || [];
            args.workspaceContentDirs.push(arg.slice('--workspace-content-dir='.length));
        }
        else if (arg === '--wiki-root') args.wikiRoots = [argv[++index]];
        else if (arg.startsWith('--wiki-root=')) args.wikiRoots = [arg.slice('--wiki-root='.length)];
        else if (arg === '--home') args.homeDir = argv[++index];
        else if (arg.startsWith('--home=')) args.homeDir = arg.slice('--home='.length);
        else if (arg === '--max-file-bytes') args.maxFileBytes = Number(argv[++index]);
        else if (arg.startsWith('--max-file-bytes=')) args.maxFileBytes = Number(arg.slice('--max-file-bytes='.length));
        else if (arg === '--max-writes') args.maxWrites = Number(argv[++index]);
        else if (arg.startsWith('--max-writes=')) args.maxWrites = Number(arg.slice('--max-writes='.length));
        else if (arg === '--limit') args.limit = Number(argv[++index]);
        else if (arg.startsWith('--limit=')) args.limit = Number(arg.slice('--limit='.length));
        else if (arg === '--server-index-json') args.serverIndexJson = argv[++index];
        else if (arg.startsWith('--server-index-json=')) args.serverIndexJson = arg.slice('--server-index-json='.length);
        else if (arg === '--target-table') {
            args.targetTables = args.targetTables || [];
            args.targetTables.push(argv[++index]);
        } else if (arg.startsWith('--target-table=')) {
            args.targetTables = args.targetTables || [];
            args.targetTables.push(arg.slice('--target-table='.length));
        }
    }
    return args;
}

async function comparedInventory(args, connectionString) {
    const items = collectLocalInventory(args);
    if (!args.compareServer) return items;
    const serverRows = args.serverIndexJson
        ? readServerIndexJson(args.serverIndexJson)
        : await loadServerRows(connectionString);
    return compareWithServer(items, serverRows);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const connectionString = process.env.INFO_SSOT_DATABASE_URL || process.env.INFO_SSOT_DB_URL || process.env.DATABASE_URL || null;
    if (args.compareServer && !args.serverIndexJson && !connectionString) {
        throw new Error('server comparison requires INFO_SSOT_DATABASE_URL, INFO_SSOT_DB_URL, DATABASE_URL, --server-index-json, or --allow-offline-plan');
    }

    const items = await comparedInventory(args, connectionString);
    const plan = buildUpsertPlan(items, { targetTables: args.targetTables || SUPPORTED_TARGET_TABLES });
    assertExecuteAllowed({ execute: args.execute, confirm: args.confirm, maxWrites: args.maxWrites, connectionString }, plan);
    const applyResult = await applyUpsertPlan(plan, { execute: args.execute, connectionString });

    const limit = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : null;
    const output = {
        mode: args.execute ? 'execute' : 'dry_run',
        compare_server: args.compareServer,
        summary: plan.summary,
        apply_result: applyResult,
        operations: limit ? plan.operations.slice(0, limit) : plan.operations,
        skips: limit ? plan.skips.slice(0, limit) : plan.skips
    };

    if (args.json) {
        process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    } else {
        console.log(`mode: ${output.mode}`);
        console.log(`compare_server: ${output.compare_server}`);
        console.log(`operations: ${output.summary.operations}`);
        console.log(`skipped: ${output.summary.skipped}`);
        console.log(`by_operation_target: ${JSON.stringify(output.summary.by_operation_target)}`);
        console.log(`by_skip_reason: ${JSON.stringify(output.summary.by_skip_reason)}`);
        for (const operation of output.operations) {
            console.log(`insert\t${operation.target_table}:${operation.target_type}\t${operation.source_path}`);
        }
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

export {
    DEFAULT_MAX_WRITES,
    applyUpsertPlan,
    assertExecuteAllowed,
    buildUpsertPlan,
    parseArgs,
    stableTargetId
};
