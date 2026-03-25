#!/usr/bin/env node
/**
 * GraphDB → Wiki 移行スクリプト
 *
 * GraphDB (graph_entities) の payload からナラティブ向きのデータを
 * wiki/ ディレクトリに Markdown ファイルとして書き出し、
 * wiki_pages テーブルにデフォルト権限レコードを挿入する。
 *
 * Usage:
 *   node scripts/migrate-graphdb-to-wiki.js [--dry-run] [--wiki-root /path/to/wiki]
 *
 * 環境変数:
 *   INFO_SSOT_DATABASE_URL  - PostgreSQL 接続文字列
 *   BRAINBASE_WIKI_ROOT     - wiki ディレクトリ（デフォルト: ../wiki/）
 */

import pg from 'pg';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DRY_RUN = process.argv.includes('--dry-run');
const WIKI_ROOT = process.argv.find((_, i, a) => a[i - 1] === '--wiki-root')
    || process.env.BRAINBASE_WIKI_ROOT
    || path.resolve(__dirname, '..', '..', 'wiki');

const DB_URL = process.env.INFO_SSOT_DATABASE_URL || process.env.INFO_SSOT_DB_URL;

if (!DB_URL) {
    console.error('ERROR: INFO_SSOT_DATABASE_URL is required');
    process.exit(1);
}

console.log(`[migrate] Wiki root: ${WIKI_ROOT}`);
console.log(`[migrate] Dry run: ${DRY_RUN}`);

const pool = new pg.Pool({ connectionString: DB_URL });

// ─────────────────── Entity → Markdown converters ───────────────────

function personToMarkdown(entity) {
    const p = entity.payload;
    const lines = [];
    lines.push(`# ${p.name || entity.id}`);
    lines.push('');
    if (p.role) lines.push(`**役職**: ${p.role}`);
    if (p.org) lines.push(`**所属**: ${p.org}`);
    if (p.status) lines.push(`**ステータス**: ${p.status}`);
    if (p.aliases?.length) lines.push(`**別名**: ${p.aliases.join(', ')}`);
    if (p.projects?.length) lines.push(`**プロジェクト**: ${p.projects.join(', ')}`);
    if (p.org_tags?.length) lines.push(`**組織タグ**: ${p.org_tags.join(', ')}`);
    lines.push('');
    if (p.bio) {
        lines.push('## 概要');
        lines.push('');
        lines.push(p.bio);
    }
    return lines.join('\n');
}

function projectToMarkdown(entity) {
    const p = entity.payload;
    const lines = [];
    lines.push(`# ${p.name || entity.id}`);
    lines.push('');
    if (p.status) lines.push(`**ステータス**: ${p.status}`);
    if (p.code) lines.push(`**コード**: ${p.code}`);
    if (p.team?.length) lines.push(`**チーム**: ${p.team.join(', ')}`);
    if (p.orgs?.length) lines.push(`**組織**: ${p.orgs.join(', ')}`);
    if (p.apps?.length) lines.push(`**アプリ**: ${p.apps.join(', ')}`);
    if (p.customers?.length) lines.push(`**顧客**: ${p.customers.join(', ')}`);
    lines.push('');
    if (p.description) {
        lines.push('## 概要');
        lines.push('');
        lines.push(p.description);
    }
    return lines.join('\n');
}

function orgToMarkdown(entity) {
    const p = entity.payload;
    const lines = [];
    lines.push(`# ${p.name || entity.id}`);
    lines.push('');
    if (p.type) lines.push(`**種別**: ${p.type}`);
    if (p.aliases?.length) lines.push(`**別名**: ${p.aliases.join(', ')}`);
    lines.push('');
    if (p.description) {
        lines.push('## 概要');
        lines.push('');
        lines.push(p.description);
    }
    return lines.join('\n');
}

function decisionToMarkdown(entity) {
    const p = entity.payload;
    const lines = [];
    lines.push(`# ${p.title || entity.id}`);
    lines.push('');
    if (p.decided_at) lines.push(`**決定日**: ${p.decided_at}`);
    if (p.decider) lines.push(`**決定者**: ${p.decider}`);
    if (p.project_id) lines.push(`**プロジェクト**: ${p.project_id}`);
    if (p.status) lines.push(`**ステータス**: ${p.status}`);
    if (p.meeting_id) lines.push(`**会議**: ${p.meeting_id}`);
    lines.push('');
    if (p.context) {
        lines.push('## 背景');
        lines.push('');
        lines.push(typeof p.context === 'string' ? p.context : JSON.stringify(p.context, null, 2));
        lines.push('');
    }
    if (p.options) {
        lines.push('## 選択肢');
        lines.push('');
        if (Array.isArray(p.options)) {
            p.options.forEach((opt, i) => {
                lines.push(`${i + 1}. ${typeof opt === 'string' ? opt : JSON.stringify(opt)}`);
            });
        } else {
            lines.push(JSON.stringify(p.options, null, 2));
        }
        lines.push('');
    }
    if (p.chosen) {
        lines.push('## 決定');
        lines.push('');
        lines.push(typeof p.chosen === 'string' ? p.chosen : JSON.stringify(p.chosen, null, 2));
        lines.push('');
    }
    if (p.reason) {
        lines.push('## 理由');
        lines.push('');
        lines.push(p.reason);
    }
    return lines.join('\n');
}

function glossaryTermToMarkdown(entity) {
    const p = entity.payload;
    const lines = [];
    lines.push(`# ${p.term || p.name || entity.id}`);
    lines.push('');
    if (p.definition) lines.push(p.definition);
    if (p.description) lines.push(p.description);
    return lines.join('\n');
}

function genericToMarkdown(entity) {
    const p = entity.payload;
    const lines = [];
    lines.push(`# ${p.name || p.title || entity.id}`);
    lines.push('');
    lines.push(`**タイプ**: ${entity.entity_type}`);
    lines.push('');
    // Dump payload fields
    for (const [key, value] of Object.entries(p)) {
        if (['name', 'title'].includes(key)) continue;
        if (value === null || value === undefined) continue;
        if (typeof value === 'string') {
            lines.push(`**${key}**: ${value}`);
        } else if (Array.isArray(value)) {
            lines.push(`**${key}**: ${value.join(', ')}`);
        } else {
            lines.push(`**${key}**: ${JSON.stringify(value)}`);
        }
    }
    return lines.join('\n');
}

// ─────────────────── Entity type → wiki path mapping ───────────────────

function entityToWikiPath(entity) {
    const id = entity.id || entity.entity_id;
    switch (entity.entity_type) {
        case 'person':
            return `people/${id}`;
        case 'project': {
            const code = entity.payload?.code || id;
            return `${code}/overview`;
        }
        case 'org':
            return `orgs/${entity.payload?.org_id || id}`;
        case 'decision': {
            const projectId = entity.payload?.project_id || entity.project_id || 'general';
            return `${projectId}/decisions/${id}`;
        }
        case 'glossary_term':
            return `glossary/${id}`;
        default:
            return `other/${entity.entity_type}/${id}`;
    }
}

function entityToMarkdown(entity) {
    switch (entity.entity_type) {
        case 'person': return personToMarkdown(entity);
        case 'project': return projectToMarkdown(entity);
        case 'org': return orgToMarkdown(entity);
        case 'decision': return decisionToMarkdown(entity);
        case 'glossary_term': return glossaryTermToMarkdown(entity);
        default: return genericToMarkdown(entity);
    }
}

// ─────────────────── Main ───────────────────

async function main() {
    // 1. Fetch all entities from graph_entities
    console.log('[migrate] Fetching entities from graph_entities...');
    const { rows: entities } = await pool.query(
        `SELECT id AS entity_id, entity_type, project_id, payload, role_min, sensitivity, updated_at
         FROM graph_entities
         WHERE entity_type IN ('person', 'project', 'org', 'decision', 'glossary_term')
           AND id NOT LIKE 'simproj_%'
           AND id NOT LIKE '%_simproj_%'
           AND COALESCE(payload->>'code', '') NOT LIKE 'simproj_%'
           AND COALESCE(project_id, '') NOT IN (
             SELECT id FROM graph_entities
             WHERE entity_type = 'project'
               AND payload->>'code' LIKE 'simproj_%'
           )
         ORDER BY entity_type, id`
    );
    console.log(`[migrate] Found ${entities.length} entities`);

    // 2. Filter: only migrate narrative-suitable types (skip raci, app, customer)
    const stats = { created: 0, skipped: 0, dbInserted: 0 };
    const wikiPagesInserts = [];

    for (const entity of entities) {
        const wikiPath = entityToWikiPath(entity);
        const filePath = path.join(WIKI_ROOT, `${wikiPath}.md`);
        const content = entityToMarkdown(entity);

        // Check if file already exists
        try {
            await fs.access(filePath);
            console.log(`  [skip] ${wikiPath} (already exists)`);
            stats.skipped++;
            continue;
        } catch {
            // File doesn't exist, proceed
        }

        if (DRY_RUN) {
            console.log(`  [dry-run] Would create: ${wikiPath} (${content.length} chars)`);
            stats.created++;
            continue;
        }

        // Create directory and write file
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, 'utf-8');
        console.log(`  [created] ${wikiPath}`);
        stats.created++;

        // Prepare wiki_pages insert
        wikiPagesInserts.push({
            path: wikiPath,
            title: entity.payload?.name || entity.payload?.title || wikiPath.split('/').pop(),
            roleMin: entity.role_min || 'member',
            sensitivity: entity.sensitivity || 'internal',
            projectId: entity.project_id || null
        });
    }

    // 3. Insert wiki_pages records
    if (!DRY_RUN && wikiPagesInserts.length > 0) {
        console.log(`\n[migrate] Inserting ${wikiPagesInserts.length} wiki_pages records...`);
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Ensure wiki_pages table exists
            await client.query(`
                CREATE TABLE IF NOT EXISTS wiki_pages (
                    id text PRIMARY KEY,
                    path text UNIQUE NOT NULL,
                    title text NOT NULL,
                    role_min text NOT NULL DEFAULT 'member',
                    sensitivity text NOT NULL DEFAULT 'internal',
                    project_id text REFERENCES projects(id),
                    created_at timestamptz NOT NULL DEFAULT NOW(),
                    updated_at timestamptz NOT NULL DEFAULT NOW()
                )
            `);

            for (const page of wikiPagesInserts) {
                const id = `wiki_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                await client.query(
                    `INSERT INTO wiki_pages (id, path, title, role_min, sensitivity, project_id)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (path) DO NOTHING`,
                    [id, page.path, page.title, page.roleMin, page.sensitivity, page.projectId]
                );
                stats.dbInserted++;
            }

            await client.query('COMMIT');
            console.log(`[migrate] DB records inserted: ${stats.dbInserted}`);
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('[migrate] DB insert failed, rolled back:', error.message);
        } finally {
            client.release();
        }
    }

    // 4. Summary
    console.log('\n========== Migration Summary ==========');
    console.log(`  Files created:   ${stats.created}`);
    console.log(`  Files skipped:   ${stats.skipped}`);
    console.log(`  DB records:      ${stats.dbInserted}`);
    console.log(`  Wiki root:       ${WIKI_ROOT}`);
    if (DRY_RUN) {
        console.log('  ⚠️  DRY RUN - no changes were made');
    }
    console.log('========================================');
}

main()
    .catch(error => {
        console.error('[migrate] Fatal error:', error);
        process.exit(1);
    })
    .finally(() => pool.end());
