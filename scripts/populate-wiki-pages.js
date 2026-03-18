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
import { ulid } from 'ulid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────── CLI args ───────────────────

const DRY_RUN = process.argv.includes('--dry-run');

const WIKI_ROOT = process.argv.find((_, i, a) => a[i - 1] === '--wiki-root')
    || process.env.BRAINBASE_WIKI_ROOT
    || path.resolve(__dirname, '..', '..', 'wiki');

const DB_URL = process.env.INFO_SSOT_DATABASE_URL
    || process.env.INFO_SSOT_DB_URL
    || process.env.DATABASE_URL
    || 'postgresql://localhost:5432/brainbase';

// ─────────────────── Helpers ───────────────────

/**
 * Recursively collect all .md files under a directory.
 * Returns paths relative to baseDir.
 */
async function collectMarkdownFiles(baseDir) {
    const results = [];

    async function walk(dir) {
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return; // directory doesn't exist or inaccessible
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

// ─────────────────── Main ───────────────────

async function main() {
    console.log(`[populate] Wiki root:  ${WIKI_ROOT}`);
    console.log(`[populate] Database:   ${DB_URL.replace(/\/\/.*@/, '//<credentials>@')}`);
    console.log(`[populate] Dry run:    ${DRY_RUN}`);
    console.log('');

    // 1. Verify wiki directory exists
    try {
        const stat = await fs.stat(WIKI_ROOT);
        if (!stat.isDirectory()) {
            console.error(`ERROR: ${WIKI_ROOT} is not a directory`);
            process.exit(1);
        }
    } catch {
        console.error(`ERROR: Wiki directory not found: ${WIKI_ROOT}`);
        process.exit(1);
    }

    // 2. Collect all markdown files
    const mdFiles = await collectMarkdownFiles(WIKI_ROOT);
    console.log(`[populate] Found ${mdFiles.length} markdown files`);

    if (mdFiles.length === 0) {
        console.log('[populate] Nothing to do.');
        return;
    }

    // 3. Connect to database and fetch known projects (with name→id mapping)
    const pool = new pg.Pool({ connectionString: DB_URL });

    // Build folder-name → project ULID mapping
    // Projects table uses ULID IDs (prj_01KG...) but wiki folders use slug names (salestailor, zeims, etc.)
    const folderToProjectId = new Map();
    try {
        const { rows } = await pool.query(
            `SELECT ge.id, ge.payload->>'name' as name
             FROM graph_entities ge WHERE ge.entity_type = 'project'`
        );
        // Map lowercase name variants to project ID
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
            // Direct lowercase match
            for (const [pattern, folder] of Object.entries(NAME_TO_FOLDER)) {
                if (name === pattern || name.toLowerCase() === pattern) {
                    folderToProjectId.set(folder, row.id);
                }
            }
            // Also try name as-is (lowercased) → folder
            if (!folderToProjectId.has(name)) {
                folderToProjectId.set(name, row.id);
            }
        }
        console.log(`[populate] Project mapping: ${folderToProjectId.size} entries`);
        for (const [folder, id] of folderToProjectId) {
            console.log(`  ${folder} → ${id}`);
        }
    } catch (err) {
        console.warn(`[populate] WARNING: Could not query projects: ${err.message}`);
        console.warn('[populate] Continuing without project mapping...');
    }

    // 4. Build page records
    const pages = [];
    const warnings = [];
    const unmappedFolders = new Set();

    for (const relPath of mdFiles) {
        const wikiPath = toWikiPath(relPath);
        const { projectId: folderName, sensitivity } = deriveProjectInfo(relPath);

        // Resolve folder name to actual project ULID
        let resolvedProjectId = null;
        if (folderName) {
            resolvedProjectId = folderToProjectId.get(folderName) || folderToProjectId.get(folderName.toLowerCase()) || null;
            if (!resolvedProjectId && !unmappedFolders.has(folderName)) {
                warnings.push(`Wiki folder '${folderName}' has no matching project in DB`);
                unmappedFolders.add(folderName);
            }
        }

        // Extract title, content_hash, size_bytes from file content
        let title;
        let contentHash = null;
        let sizeBytes = null;
        try {
            const content = await fs.readFile(path.join(WIKI_ROOT, relPath), 'utf-8');
            title = extractTitle(content);
            contentHash = crypto.createHash('sha256').update(content).digest('hex');
            sizeBytes = Buffer.byteLength(content, 'utf-8');
        } catch {
            title = null;
        }
        if (!title) {
            title = titleFromPath(relPath);
        }

        pages.push({
            wikiPath,
            title,
            roleMin: 'member',
            sensitivity,
            projectId: resolvedProjectId,
            contentHash,
            sizeBytes,
        });
    }

    // Print warnings
    if (warnings.length > 0) {
        console.log('');
        for (const w of warnings) {
            console.warn(`  WARNING: ${w}`);
        }
    }

    // 5. Dry-run output
    if (DRY_RUN) {
        console.log('');
        console.log('─── Dry Run: pages to upsert ───');
        for (const p of pages) {
            const proj = p.projectId ?? '(null)';
            const sens = p.sensitivity !== 'internal' ? ` [${p.sensitivity}]` : '';
            console.log(`  ${p.wikiPath}  →  project=${proj}${sens}  title="${p.title}"`);
        }
        console.log('');
        console.log(`[populate] Total: ${pages.length} pages would be upserted`);
        await pool.end();
        return;
    }

    // 6. UPSERT into wiki_pages
    console.log('');
    console.log(`[populate] Upserting ${pages.length} wiki_pages records...`);

    const client = await pool.connect();
    let inserted = 0;
    let updated = 0;
    let errors = 0;

    try {
        await client.query('BEGIN');

        for (const p of pages) {
            try {
                const result = await client.query(
                    `INSERT INTO wiki_pages (id, path, title, role_min, sensitivity, project_id, content_hash, size_bytes)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                     ON CONFLICT (path) DO UPDATE SET
                         title = EXCLUDED.title,
                         sensitivity = EXCLUDED.sensitivity,
                         project_id = EXCLUDED.project_id,
                         content_hash = EXCLUDED.content_hash,
                         size_bytes = EXCLUDED.size_bytes,
                         updated_at = NOW()
                     RETURNING (xmax = 0) AS is_insert`,
                    [
                        `wiki_${ulid()}`,
                        p.wikiPath,
                        p.title,
                        p.roleMin,
                        p.sensitivity,
                        p.projectId,
                        p.contentHash,
                        p.sizeBytes,
                    ]
                );
                if (result.rows[0]?.is_insert) {
                    inserted++;
                } else {
                    updated++;
                }
            } catch (err) {
                console.error(`  ERROR: ${p.wikiPath}: ${err.message}`);
                errors++;
            }
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[populate] Transaction failed, rolled back: ${err.message}`);
        process.exit(1);
    } finally {
        client.release();
    }

    // 7. Summary
    console.log('');
    console.log('========== Populate Summary ==========');
    console.log(`  Files scanned:   ${mdFiles.length}`);
    console.log(`  Rows inserted:   ${inserted}`);
    console.log(`  Rows updated:    ${updated}`);
    console.log(`  Errors:          ${errors}`);
    console.log(`  Warnings:        ${warnings.length}`);
    console.log(`  Wiki root:       ${WIKI_ROOT}`);
    console.log('======================================');

    await pool.end();
}

main().catch(err => {
    console.error('[populate] Fatal error:', err);
    process.exit(1);
});
