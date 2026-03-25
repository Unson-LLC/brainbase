#!/usr/bin/env node
/**
 * brainbase-codex → Wiki マージスクリプト
 *
 * brainbase-codex (archived) のリッチなMarkdownコンテンツを
 * wiki/ ディレクトリにマージする。GraphDB移行で失われた詳細情報を復元。
 *
 * Usage:
 *   node scripts/merge-codex-to-wiki.js [--dry-run] [--codex-root /path] [--wiki-root /path]
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DRY_RUN = process.argv.includes('--dry-run');
const CODEX_ROOT = process.argv.find((_, i, a) => a[i - 1] === '--codex-root')
    || '/tmp/brainbase-codex';
const WIKI_ROOT = process.argv.find((_, i, a) => a[i - 1] === '--wiki-root')
    || process.env.BRAINBASE_WIKI_ROOT
    || path.resolve(__dirname, '..', '..', 'wiki');

console.log(`[merge] Codex root: ${CODEX_ROOT}`);
console.log(`[merge] Wiki root: ${WIKI_ROOT}`);
console.log(`[merge] Dry run: ${DRY_RUN}`);

const stats = { copied: 0, skippedSmaller: 0, skippedSame: 0, newFiles: 0 };

// ─────── Mapping: codex path → wiki path ───────

const MERGE_MAP = [
    // people/*.md → wiki/people/{person_id}.md
    {
        codexDir: 'common/meta/people',
        wikiDir: 'people',
        transform: (filename) => filename, // keep same name
    },
    // raci/*.md → wiki/raci/{org_id}.md
    {
        codexDir: 'common/meta/raci',
        wikiDir: 'raci',
        transform: (filename) => filename,
    },
    // orgs/*.md → wiki/orgs/{org_id}.md
    {
        codexDir: 'common/meta/orgs',
        wikiDir: 'orgs',
        transform: (filename) => filename,
    },
    // decisions/*.md → wiki/decisions/{id}.md
    {
        codexDir: 'common/meta/decisions',
        wikiDir: 'decisions',
        transform: (filename) => filename,
    },
    // customers/*.md → wiki/customers/{id}.md
    {
        codexDir: 'common/meta/customers',
        wikiDir: 'customers',
        transform: (filename) => filename,
    },
    // financials/*.md → wiki/financials/{id}.md
    {
        codexDir: 'common/meta/financials',
        wikiDir: 'financials',
        transform: (filename) => filename,
    },
    // contracts/*.md → wiki/contracts/{id}.md
    {
        codexDir: 'common/meta/contracts',
        wikiDir: 'contracts',
        transform: (filename) => filename,
    },
    // Top-level meta files
    {
        codexDir: 'common/meta',
        wikiDir: 'meta',
        filesOnly: true, // only .md files directly in this dir, not subdirs
        transform: (filename) => filename,
    },
    // projects/*/  → wiki/{project_id}/
    {
        codexDir: 'projects',
        wikiDir: '', // project code becomes the wiki folder
        recursive: true,
        transform: (filename) => filename,
    },
];

// ─────── Helpers ───────

async function listMdFiles(dir, recursive = false) {
    const results = [];
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isFile() && entry.name.endsWith('.md')) {
                results.push(fullPath);
            } else if (entry.isDirectory() && recursive) {
                const sub = await listMdFiles(fullPath, true);
                results.push(...sub);
            }
        }
    } catch {
        // dir doesn't exist
    }
    return results;
}

async function fileSize(filePath) {
    try {
        const stat = await fs.stat(filePath);
        return stat.size;
    } catch {
        return -1; // doesn't exist
    }
}

async function mergeFile(codexPath, wikiPath) {
    const codexContent = await fs.readFile(codexPath, 'utf-8');
    const codexSize = codexContent.length;

    const wikiSize = await fileSize(wikiPath);

    if (wikiSize < 0) {
        // New file
        if (DRY_RUN) {
            console.log(`  [new] ${path.relative(WIKI_ROOT, wikiPath)} (${codexSize} chars)`);
        } else {
            await fs.mkdir(path.dirname(wikiPath), { recursive: true });
            await fs.writeFile(wikiPath, codexContent, 'utf-8');
            console.log(`  [new] ${path.relative(WIKI_ROOT, wikiPath)}`);
        }
        stats.newFiles++;
        return;
    }

    const wikiContent = await fs.readFile(wikiPath, 'utf-8');

    if (wikiContent === codexContent) {
        stats.skippedSame++;
        return;
    }

    // Codex is richer (larger) → overwrite
    if (codexSize > wikiContent.length) {
        if (DRY_RUN) {
            console.log(`  [overwrite] ${path.relative(WIKI_ROOT, wikiPath)} (wiki: ${wikiContent.length} → codex: ${codexSize} chars)`);
        } else {
            await fs.writeFile(wikiPath, codexContent, 'utf-8');
            console.log(`  [overwrite] ${path.relative(WIKI_ROOT, wikiPath)} (${wikiContent.length} → ${codexSize})`);
        }
        stats.copied++;
    } else {
        // Wiki already has more content, skip
        stats.skippedSmaller++;
    }
}

// ─────── Main ───────

async function main() {
    for (const mapping of MERGE_MAP) {
        const codexDir = path.join(CODEX_ROOT, mapping.codexDir);

        try {
            await fs.access(codexDir);
        } catch {
            continue; // dir doesn't exist in codex
        }

        if (mapping.filesOnly) {
            // Only top-level .md files
            const files = await listMdFiles(codexDir, false);
            for (const codexPath of files) {
                const filename = mapping.transform(path.basename(codexPath));
                const wikiPath = path.join(WIKI_ROOT, mapping.wikiDir, filename);
                await mergeFile(codexPath, wikiPath);
            }
        } else if (mapping.recursive && mapping.codexDir === 'projects') {
            // Special: projects/{code}/**/*.md → wiki/{code}/**/*.md
            const entries = await fs.readdir(codexDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const projectDir = path.join(codexDir, entry.name);
                const mdFiles = await listMdFiles(projectDir, true);
                for (const codexPath of mdFiles) {
                    const relPath = path.relative(projectDir, codexPath);
                    const wikiPath = path.join(WIKI_ROOT, entry.name, relPath);
                    await mergeFile(codexPath, wikiPath);
                }
            }
        } else {
            // Standard directory: list all .md files
            const files = await listMdFiles(codexDir, true);
            for (const codexPath of files) {
                const relPath = path.relative(codexDir, codexPath);
                const filename = mapping.transform(relPath);
                const wikiPath = path.join(WIKI_ROOT, mapping.wikiDir, filename);
                await mergeFile(codexPath, wikiPath);
            }
        }
    }

    console.log('\n========== Merge Summary ==========');
    console.log(`  New files:       ${stats.newFiles}`);
    console.log(`  Overwritten:     ${stats.copied}`);
    console.log(`  Skipped (same):  ${stats.skippedSame}`);
    console.log(`  Skipped (wiki>): ${stats.skippedSmaller}`);
    if (DRY_RUN) {
        console.log('  ⚠️  DRY RUN - no changes were made');
    }
    console.log('====================================');
}

main().catch(error => {
    console.error('[merge] Fatal error:', error);
    process.exit(1);
});
