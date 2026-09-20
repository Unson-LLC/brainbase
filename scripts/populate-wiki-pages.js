#!/usr/bin/env node
/**
 * wiki_pages テーブルポピュレートスクリプト
 *
 * wiki/ ディレクトリを再帰スキャンし、ディレクトリ構造から project_id を推定して
 * wiki_pages テーブルに UPSERT する。
 *
 * Usage:
 *   node scripts/populate-wiki-pages.js [--dry-run] [--wiki-root /path/to/wiki]
 *
 * 環境変数:
 *   DATABASE_URL          - PostgreSQL 接続文字列（デフォルト: postgresql://localhost:5432/brainbase）
 *   INFO_SSOT_DATABASE_URL - DATABASE_URL のフォールバック
 *   BRAINBASE_WIKI_ROOT   - wiki ディレクトリ（デフォルト: ../wiki/ relative to script）
 */

import pg from 'pg';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RETIRED_MESSAGE = 'wiki_pages population is retired. Only --dry-run inventory is allowed.';

function logMessage(logger, method, ...args) {
    if (typeof logger?.[method] === 'function') logger[method](...args);
}

// ─────────────────── Helpers ───────────────────

/**
 * Recursively collect all .md files under a directory.
 * Returns paths relative to baseDir.
 */
export async function collectMarkdownFiles(baseDir, fsImpl = fs) {
    const results = [];

    async function walk(dir) {
        let entries;
        try {
            entries = await fsImpl.readdir(dir, { withFileTypes: true });
        } catch (error) {
            throw new Error(`Unable to read Wiki directory ${dir}: ${error.message}`, { cause: error });
        }
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(fullPath);
            } else if (entry.isFile() && entry.name.endsWith('.md')) {
                results.push(path.relative(baseDir, fullPath));
            }
        }
    }

    await walk(baseDir);
    return results.sort();
}

/**
 * Extract the first H1 header from markdown content.
 * Returns null if not found.
 */
function extractTitle(content) {
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : null;
}

/**
 * Derive title from a file path (filename without extension).
 * Converts kebab-case / snake_case to readable form.
 */
function titleFromPath(relPath) {
    const basename = path.basename(relPath, '.md');
    return basename
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Derive project_id and sensitivity from wiki-relative path.
 *
 * Rules:
 *   _common/**  → project_id = null, sensitivity = 'internal'
 *   _archived/** → project_id = null, sensitivity = 'restricted'
 *   index.md (root level) → project_id = null
 *   {folder}/** → project_id = folder name
 */
function deriveProjectInfo(relPath) {
    // Normalize to forward slashes
    const normalized = relPath.replace(/\\/g, '/');
    const parts = normalized.split('/');
    const topLevel = parts[0];

    if (topLevel === '_common') {
        return { projectId: null, sensitivity: 'internal' };
    }
    if (topLevel === '_archived') {
        return { projectId: null, sensitivity: 'restricted' };
    }
    // Root-level files (e.g., index.md)
    if (parts.length === 1) {
        return { projectId: null, sensitivity: 'internal' };
    }
    return { projectId: topLevel, sensitivity: 'internal' };
}

/**
 * Normalize wiki path: strip .md extension, use forward slashes.
 */
function toWikiPath(relPath) {
    let p = relPath.replace(/\\/g, '/');
    if (p.endsWith('.md')) p = p.slice(0, -3);
    return p;
}

// ─────────────────── Inventory runner ───────────────────

const PROJECT_QUERY = `SELECT ge.id, ge.payload->>'name' as name
             FROM graph_entities ge WHERE ge.entity_type = 'project'`;

/**
 * Read saved Wiki Markdown and project metadata for a dry-run inventory.
 * No write path is exposed by this runner; read failures reject the run.
 */
export async function runWikiPagesInventory({
    dryRun = true,
    wikiRoot,
    dbUrl,
    pool: suppliedPool,
    fsImpl = fs,
    logger = console,
} = {}) {
    if (!dryRun) {
        throw new Error(`ERROR: ${RETIRED_MESSAGE}`);
    }
    if (!wikiRoot) {
        throw new Error('ERROR: Wiki root is required');
    }
    if (!suppliedPool && !dbUrl) {
        throw new Error('ERROR: DATABASE_URL is required');
    }

    let stat;
    try {
        stat = await fsImpl.stat(wikiRoot);
    } catch (error) {
        throw new Error(`Unable to read Wiki directory ${wikiRoot}: ${error.message}`, { cause: error });
    }
    if (!stat.isDirectory()) {
        throw new Error(`ERROR: ${wikiRoot} is not a directory`);
    }

    const mdFiles = await collectMarkdownFiles(wikiRoot, fsImpl);
    logMessage(logger, 'log', `[populate] Found ${mdFiles.length} markdown files`);

    if (mdFiles.length === 0) {
        logMessage(logger, 'log', '[populate] Nothing to do.');
        return { mdFiles, pages: [], warnings: [] };
    }

    const pool = suppliedPool || new pg.Pool({ connectionString: dbUrl });
    const ownsPool = !suppliedPool;

    try {
        // Build folder-name → project ULID mapping. A failed read is fatal:
        // an empty mapping is not evidence that no projects exist.
        const folderToProjectId = new Map();
        const { rows } = await pool.query(PROJECT_QUERY);
        const NAME_TO_FOLDER = {
            'brainbase': 'brainbase',
            'baao': 'baao',
            'salestaylor': 'salestailor', 'salestailpr': 'salestailor', 'salest ailor': 'salestailor',
            'zeims': 'zeims',
            'tech knight': 'techknight', 'tech-knight': 'techknight',
            'unson': 'unson',
            'unson os': 'unson-os',
            'aitle': 'aitle',
            'mywa': 'mywa',
            'mana': 'mana',
            'senrigan': 'senrigan',
            'ncom (ntt com dialogai)': 'ncom',
            'detectiveai（探偵業界向けai報告書作成プラットフォーム）': 'detectiveai',
            'back_office': 'back_office',
            'vibepro': 'vibepro',
            'postio（ポスティオ）': 'postio',
            'sato-portfolio': 'sato-portfolio',
        };
        for (const row of rows) {
            const name = (row.name || '').toLowerCase();
            for (const [pattern, folder] of Object.entries(NAME_TO_FOLDER)) {
                if (name === pattern) folderToProjectId.set(folder, row.id);
            }
            if (!folderToProjectId.has(name)) folderToProjectId.set(name, row.id);
        }
        logMessage(logger, 'log', `[populate] Project mapping: ${folderToProjectId.size} entries`);
        for (const [folder, id] of folderToProjectId) {
            logMessage(logger, 'log', `  ${folder} → ${id}`);
        }

        const pages = [];
        const warnings = [];
        const unmappedFolders = new Set();

        for (const relPath of mdFiles) {
            const wikiPath = toWikiPath(relPath);
            const { projectId: folderName, sensitivity } = deriveProjectInfo(relPath);

            let resolvedProjectId = null;
            if (folderName) {
                resolvedProjectId = folderToProjectId.get(folderName)
                    || folderToProjectId.get(folderName.toLowerCase())
                    || null;
                if (!resolvedProjectId && !unmappedFolders.has(folderName)) {
                    warnings.push(`Wiki folder '${folderName}' has no matching project in DB`);
                    unmappedFolders.add(folderName);
                }
            }

            let fileContent;
            try {
                fileContent = await fsImpl.readFile(path.join(wikiRoot, relPath), 'utf-8');
            } catch (error) {
                throw new Error(`Unable to read Wiki file ${path.join(wikiRoot, relPath)}: ${error.message}`, { cause: error });
            }
            const title = extractTitle(fileContent) || titleFromPath(relPath);

            pages.push({
                wikiPath,
                title,
                roleMin: 'member',
                sensitivity,
                projectId: resolvedProjectId,
                contentHash: crypto.createHash('sha256').update(fileContent).digest('hex'),
                sizeBytes: Buffer.byteLength(fileContent, 'utf-8'),
                content: fileContent,
            });
        }

        if (warnings.length > 0) {
            logMessage(logger, 'log', '');
            for (const warning of warnings) logMessage(logger, 'warn', `  WARNING: ${warning}`);
        }

        logMessage(logger, 'log', '');
        logMessage(logger, 'log', '─── Dry Run: pages to upsert ───');
        for (const page of pages) {
            const project = page.projectId ?? '(null)';
            const sensitivity = page.sensitivity !== 'internal' ? ` [${page.sensitivity}]` : '';
            logMessage(logger, 'log', `  ${page.wikiPath}  →  project=${project}${sensitivity}  title="${page.title}"`);
        }
        logMessage(logger, 'log', '');
        logMessage(logger, 'log', `[populate] Total: ${pages.length} pages would be upserted`);

        return { mdFiles, pages, warnings };
    } finally {
        if (ownsPool) await pool.end();
    }
}

export async function main(argv = process.argv.slice(2)) {
    const dryRun = argv.includes('--dry-run');
    const wikiRoot = argv.find((_, index, args) => args[index - 1] === '--wiki-root')
        || process.env.BRAINBASE_WIKI_ROOT
        || path.resolve(__dirname, '..', '..', 'wiki');
    const dbUrl = process.env.INFO_SSOT_DATABASE_URL
        || process.env.INFO_SSOT_DB_URL
        || process.env.DATABASE_URL
        || 'postgresql://localhost:5432/brainbase';

    if (!dryRun) {
        console.error(`ERROR: ${RETIRED_MESSAGE}`);
        return 1;
    }

    console.log(`[populate] Wiki root:  ${wikiRoot}`);
    console.log(`[populate] Database:   ${dbUrl.replace(/\/\/.*@/, '//<credentials>@')}`);
    console.log(`[populate] Dry run:    ${dryRun}`);
    console.log('');
    await runWikiPagesInventory({ dryRun, wikiRoot, dbUrl });
    return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
    main().then(code => {
        if (code) process.exitCode = code;
    }).catch(error => {
        console.error('[populate] Fatal error:', error);
        process.exitCode = 1;
    });
}
