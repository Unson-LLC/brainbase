#!/usr/bin/env node
// @ts-check
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_CODEX_ROOT = '/Users/ksato/workspace/shared/_codex';
const DEFAULT_WORKSPACE_ROOT = '/Users/ksato/workspace';
const DEFAULT_WORKSPACE_CONTENT_DIRS = ['common', 'brand', 'knowledge', 'sns', 'decisions'];
const DEFAULT_WIKI_ROOTS = [
    '/Users/ksato/workspace/wiki',
    '/Users/ksato/workspace/shared/wiki'
];

const FILE_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.html', '.json', '.csv']);
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const SKIP_DIRS = new Set([
    '.git',
    '.next',
    '.venv',
    'coverage',
    'dist',
    'node_modules',
    'playwright-report',
    'test-results',
    'tmp',
    'var',
    'vendor'
]);

function normalizePath(value) {
    return String(value || '').replace(/\\/gu, '/').replace(/^\/+/u, '');
}

function sha256(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

function firstHeading(content, fallback) {
    const match = String(content || '').match(/^#\s+(.+)$/mu);
    return match ? match[1].trim() : fallback;
}

function stableIdFromRelPath(prefix, relPath) {
    const token = normalizePath(relPath)
        .replace(/\.[^.]+$/u, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, '_')
        .replace(/^_+|_+$/gu, '');
    return `${prefix}_${token || sha256(relPath).slice(0, 12)}`;
}

function classifyCodexRelPath(relPath) {
    const rel = normalizePath(relPath);
    const lower = rel.toLowerCase();
    if (lower.startsWith('common/meta/people/')) return { target_table: 'graph_entities', target_type: 'person', source_subtype: 'common_meta_person' };
    if (lower.startsWith('common/meta/orgs/')) return { target_table: 'graph_entities', target_type: 'org', source_subtype: 'common_meta_org' };
    if (lower.startsWith('common/meta/customers/')) return { target_table: 'graph_entities', target_type: 'customer', source_subtype: 'common_meta_customer' };
    if (lower.startsWith('common/meta/partners/')) return { target_table: 'graph_entities', target_type: 'partner', source_subtype: 'common_meta_partner' };
    if (lower.startsWith('common/meta/contacts/')) return { target_table: 'graph_entities', target_type: 'contact', source_subtype: 'common_meta_contact' };
    if (lower.startsWith('common/meta/decisions/')) return { target_table: 'graph_entities', target_type: 'decision', source_subtype: 'common_meta_decision' };
    if (lower.startsWith('common/meta/raci/')) return { target_table: 'graph_entities', target_type: 'raci_assignment', source_subtype: 'common_meta_raci' };
    if (lower.startsWith('common/meta/glossary/')) return { target_table: 'graph_entities', target_type: 'glossary_term', source_subtype: 'common_meta_glossary' };
    if (lower.startsWith('common/meta/philosophy/')) return { target_table: 'graph_entities', target_type: 'philosophy', source_subtype: 'common_meta_philosophy' };
    if (lower.startsWith('projects/')) return { target_table: 'graph_entities', target_type: 'document', source_subtype: 'project_document' };
    if (lower.startsWith('sns/')) return { target_table: 'graph_entities', target_type: 'document', source_subtype: lower.startsWith('sns/drafts/') ? 'sns_draft_document' : 'sns_document' };
    if (lower.startsWith('brand/')) return { target_table: 'graph_entities', target_type: 'document', source_subtype: 'brand_document' };
    if (lower.startsWith('knowledge/')) return { target_table: 'graph_entities', target_type: 'document', source_subtype: 'knowledge_document' };
    if (lower.startsWith('decisions/')) return { target_table: 'graph_entities', target_type: 'document', source_subtype: 'decision_document' };
    return { target_table: 'graph_entities', target_type: 'document', source_subtype: 'codex_document' };
}

function buildCodexItem({ root, filePath }) {
    const relPath = normalizePath(path.relative(root, filePath));
    const content = fs.readFileSync(filePath, 'utf8');
    const classified = classifyCodexRelPath(relPath);
    return {
        source_path: relPath,
        absolute_path: filePath,
        source_root: root,
        source_kind: 'codex',
        source_subtype: classified.source_subtype,
        target_table: classified.target_table,
        target_type: classified.target_type,
        target_key: classified.target_type === 'document'
            ? `codex:${relPath}`
            : stableIdFromRelPath(classified.target_type.slice(0, 3), relPath),
        content_hash: sha256(content),
        title: firstHeading(content, path.basename(relPath, path.extname(relPath))),
        migration_status: 'local_only'
    };
}

function buildWikiItem({ root, filePath }) {
    const relPath = normalizePath(path.relative(root, filePath));
    const content = fs.readFileSync(filePath, 'utf8');
    const wikiPath = relPath.replace(/\.[^.]+$/u, '');
    return {
        source_path: wikiPath,
        absolute_path: filePath,
        source_root: root,
        source_kind: 'wiki',
        source_subtype: 'wiki_page',
        target_table: 'wiki_pages',
        target_type: 'wiki_page',
        target_key: `wiki:${wikiPath}`,
        content_hash: sha256(content),
        title: firstHeading(content, path.basename(wikiPath)),
        migration_status: 'local_only'
    };
}

function buildConversationLogItem({ filePath, homeDir }) {
    const relPath = normalizePath(path.relative(homeDir, filePath));
    const content = fs.readFileSync(filePath, 'utf8');
    return {
        source_path: relPath,
        absolute_path: filePath,
        source_root: homeDir,
        source_kind: 'conversation_log',
        source_subtype: relPath.startsWith('.codex/') ? 'codex_history' : 'claude_code_project_log',
        target_table: 'memory_candidates',
        target_type: 'personal_kg_candidate',
        target_key: `conversation:${relPath}`,
        content_hash: sha256(content),
        title: path.basename(relPath),
        migration_status: 'needs_extraction',
        review_reason: 'raw conversation log must be extracted into owner-visible memory_candidates before any Graph promotion'
    };
}

function walkFiles(root, { extensions = FILE_EXTENSIONS, maxFileBytes = DEFAULT_MAX_FILE_BYTES } = {}) {
    const results = [];
    if (!root || !fs.existsSync(root)) return results;
    const stack = [root];
    while (stack.length) {
        const current = stack.pop();
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (SKIP_DIRS.has(entry.name)) continue;
                stack.push(full);
            } else if (entry.isFile() && !entry.name.startsWith('.') && extensions.has(path.extname(entry.name).toLowerCase())) {
                const stat = fs.statSync(full);
                if (stat.size > maxFileBytes) continue;
                results.push(full);
            }
        }
    }
    return results.sort();
}

function collectConversationLogFiles(homeDir) {
    const files = [];
    const codexHistory = path.join(homeDir, '.codex', 'history.jsonl');
    if (fs.existsSync(codexHistory)) files.push(codexHistory);
    const claudeProjects = path.join(homeDir, '.claude', 'projects');
    files.push(...walkFiles(claudeProjects, { extensions: new Set(['.jsonl']) }));
    return files.sort();
}

function localInventoryKey(item) {
    return `${item.target_table}|${item.target_type}|${normalizePath(item.source_path)}`;
}

function dedupeLocalInventory(items) {
    const seen = new Map();
    const deduped = [];
    for (const item of items) {
        const key = localInventoryKey(item);
        if (seen.has(key)) {
            const primary = seen.get(key);
            deduped.push({
                ...item,
                migration_status: 'needs_review',
                review_reason: 'duplicate local source path suppressed by root priority',
                duplicate_of_source_root: primary.source_root,
                duplicate_of_source_path: primary.source_path,
                duplicate_resolution: 'suppressed_by_root_priority'
            });
            continue;
        }
        seen.set(key, item);
        deduped.push(item);
    }
    return deduped;
}

function workspaceContentRoots(workspaceRoot, contentDirs = DEFAULT_WORKSPACE_CONTENT_DIRS) {
    if (!workspaceRoot || !fs.existsSync(workspaceRoot)) return [];
    return contentDirs
        .map((dir) => path.join(workspaceRoot, dir))
        .filter((dir) => fs.existsSync(dir));
}

function collectLocalInventory(options = {}) {
    const codexRoot = options.codexRoot || process.env.LOCAL_SSOT_CODEX_ROOT || DEFAULT_CODEX_ROOT;
    const workspaceRoot = options.workspaceRoot || process.env.LOCAL_SSOT_WORKSPACE_ROOT || DEFAULT_WORKSPACE_ROOT;
    const includeWorkspaceContent = options.includeWorkspaceContent !== false;
    const wikiRoots = options.wikiRoots || (process.env.LOCAL_SSOT_WIKI_ROOTS
        ? process.env.LOCAL_SSOT_WIKI_ROOTS.split(',').map((item) => item.trim()).filter(Boolean)
        : DEFAULT_WIKI_ROOTS);
    const homeDir = options.homeDir || os.homedir();
    const maxFileBytes = options.maxFileBytes || DEFAULT_MAX_FILE_BYTES;
    const includeConversationLogs = options.includeConversationLogs !== false;

    const items = [];
    for (const filePath of walkFiles(codexRoot, { maxFileBytes })) {
        items.push(buildCodexItem({ root: codexRoot, filePath }));
    }
    if (includeWorkspaceContent) {
        for (const root of workspaceContentRoots(workspaceRoot, options.workspaceContentDirs || DEFAULT_WORKSPACE_CONTENT_DIRS)) {
            for (const filePath of walkFiles(root, { maxFileBytes })) {
                items.push(buildCodexItem({ root: workspaceRoot, filePath }));
            }
        }
    }
    for (const root of wikiRoots) {
        for (const filePath of walkFiles(root, { extensions: new Set(['.md', '.markdown']), maxFileBytes })) {
            items.push(buildWikiItem({ root, filePath }));
        }
    }
    if (includeConversationLogs) {
        for (const filePath of collectConversationLogFiles(homeDir)) {
            items.push(buildConversationLogItem({ filePath, homeDir }));
        }
    }
    return options.dedupeLocalSources === false ? items : dedupeLocalInventory(items);
}

function serverIndexKey({ target_table, target_type, source_path }) {
    return `${target_table}|${target_type}|${normalizePath(source_path)}`;
}

function compareWithServer(items, serverRows = []) {
    const index = new Map();
    for (const row of serverRows) {
        const key = serverIndexKey(row);
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(row);
    }
    return items.map((item) => {
        if (item.migration_status === 'needs_extraction' || item.migration_status === 'needs_review') return item;
        const matches = index.get(serverIndexKey(item)) || [];
        if (!matches.length) return { ...item, migration_status: 'local_only' };
        const exact = matches.find((row) => row.content_hash && row.content_hash === item.content_hash);
        if (exact) {
            return { ...item, migration_status: 'existing_server_match', server_target_id: exact.target_id || null };
        }
        const hashedMismatch = matches.find((row) => row.content_hash && row.content_hash !== item.content_hash);
        if (hashedMismatch) {
            return {
                ...item,
                migration_status: 'conflict',
                server_target_id: hashedMismatch.target_id || null,
                review_reason: 'server row has the same source path but a different content hash'
            };
        }
        return {
            ...item,
            migration_status: 'existing_server_path_only',
            server_target_id: matches[0].target_id || null,
            review_reason: 'server row has the same source path but no comparable content hash'
        };
    });
}

async function loadServerRows(connectionString) {
    const pg = await import('pg');
    const pool = new pg.Pool({ connectionString });
    try {
        const rows = [];
        const graphResult = await pool.query(`
            SELECT id AS target_id,
                   'graph_entities' AS target_table,
                   entity_type AS target_type,
                   payload->>'path' AS source_path,
                   payload->>'content_hash' AS content_hash
            FROM graph_entities
            WHERE payload ? 'path'
        `);
        rows.push(...graphResult.rows);
        const wikiResult = await pool.query(`
            SELECT id AS target_id,
                   'wiki_pages' AS target_table,
                   'wiki_page' AS target_type,
                   path AS source_path,
                   content_hash
            FROM wiki_pages
        `);
        rows.push(...wikiResult.rows);
        return rows.filter((row) => row.source_path);
    } finally {
        await pool.end().catch(() => {});
    }
}

function summarize(items) {
    const summary = {
        total: items.length,
        by_status: {},
        by_target: {},
        by_source_kind: {}
    };
    for (const item of items) {
        summary.by_status[item.migration_status] = (summary.by_status[item.migration_status] || 0) + 1;
        const target = `${item.target_table}:${item.target_type}`;
        summary.by_target[target] = (summary.by_target[target] || 0) + 1;
        summary.by_source_kind[item.source_kind] = (summary.by_source_kind[item.source_kind] || 0) + 1;
    }
    return summary;
}

function parseArgs(argv) {
    const args = { json: false, compareServer: false, limit: null, includeConversationLogs: true };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--json') args.json = true;
        else if (arg === '--compare-server') args.compareServer = true;
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
        else if (arg === '--limit') args.limit = Number(argv[++index]);
        else if (arg.startsWith('--limit=')) args.limit = Number(arg.slice('--limit='.length));
    }
    return args;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    let items = collectLocalInventory(args);
    if (args.compareServer) {
        const connectionString = process.env.INFO_SSOT_DATABASE_URL || process.env.INFO_SSOT_DB_URL || process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error('--compare-server requires INFO_SSOT_DATABASE_URL, INFO_SSOT_DB_URL, or DATABASE_URL');
        }
        const serverRows = await loadServerRows(connectionString);
        items = compareWithServer(items, serverRows);
    }
    const limitedItems = Number.isInteger(args.limit) && args.limit > 0 ? items.slice(0, args.limit) : items;
    const output = { mode: args.compareServer ? 'inventory_compare_server' : 'inventory_only', summary: summarize(items), items: limitedItems };
    if (args.json) {
        process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    } else {
        console.log(`mode: ${output.mode}`);
        console.log(`total: ${output.summary.total}`);
        console.log(`by_status: ${JSON.stringify(output.summary.by_status)}`);
        console.log(`by_target: ${JSON.stringify(output.summary.by_target)}`);
        for (const item of limitedItems) {
            console.log(`${item.migration_status}\t${item.target_table}:${item.target_type}\t${item.source_kind}\t${item.source_path}`);
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
    classifyCodexRelPath,
    collectLocalInventory,
    compareWithServer,
    dedupeLocalInventory,
    loadServerRows,
    parseArgs,
    serverIndexKey,
    sha256,
    summarize
};
