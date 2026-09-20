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

const RETIRED_MESSAGE = 'GraphDB → Wiki materialization is retired. Query Graph directly; only --dry-run inventory is allowed.';

function logMessage(logger, method, ...args) {
    if (typeof logger?.[method] === 'function') logger[method](...args);
}

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

function speakingToMarkdown(entity) {
    const p = entity.payload;
    const lines = [];
    lines.push(`# ${p.session_title || p.event || entity.id}`);
    lines.push('');
    if (p.date) lines.push(`**日付**: ${p.date}`);
    if (p.event) lines.push(`**イベント**: ${p.event}`);
    if (p.organizer) lines.push(`**主催**: ${p.organizer}`);
    if (p.role) lines.push(`**役割**: ${p.role}`);
    if (p.duration_min) lines.push(`**時間**: ${p.duration_min}分`);
    if (p.venue) lines.push(`**会場**: ${p.venue}`);
    if (p.format) lines.push(`**形式**: ${p.format}`);
    if (p.attendance) lines.push(`**参加者**: ${p.attendance}`);
    if (p.slides_url) lines.push(`**資料**: [${p.slides_url}](${p.slides_url})`);
    if (p.hashtag) lines.push(`**ハッシュタグ**: ${p.hashtag}`);
    return lines.join('\n');
}

function mediaAppearanceToMarkdown(entity) {
    const p = entity.payload;
    const lines = [];
    lines.push(`# ${p.program || p.medium || entity.id}`);
    lines.push('');
    if (p.medium) lines.push(`**媒体**: ${p.medium}`);
    if (p.program) lines.push(`**番組/枠**: ${p.program}`);
    if (p.role) lines.push(`**役割**: ${p.role}`);
    if (p.format) lines.push(`**形式**: ${p.format}`);
    if (p.date) lines.push(`**日付**: ${p.date}${p.date_note ? ` (${p.date_note})` : ''}`);
    if (p.url) lines.push(`**URL**: [${p.url_label || p.url}](${p.url})`);
    return lines.join('\n');
}

function roleAssignmentToMarkdown(entity) {
    const p = entity.payload;
    const lines = [];
    lines.push(`# ${p.role || ''}@${p.org || entity.id}`);
    lines.push('');
    if (p.org) lines.push(`**組織**: ${p.org}`);
    if (p.org_tag) lines.push(`**組織タグ**: ${p.org_tag}`);
    if (p.role) lines.push(`**役職**: ${p.role}`);
    if (p.period) lines.push(`**期間**: ${p.period}`);
    if (p.start_date) lines.push(`**開始**: ${p.start_date}`);
    if (p.via) lines.push(`**経由**: ${p.via}`);
    if (p.description) {
        lines.push('');
        lines.push('## 内容');
        lines.push('');
        lines.push(p.description);
    }
    return lines.join('\n');
}

function productToMarkdown(entity) {
    const p = entity.payload;
    const lines = [];
    lines.push(`# ${p.name || entity.id}`);
    lines.push('');
    if (p.status) lines.push(`**ステータス**: ${p.status}`);
    if (p.role) lines.push(`**役割**: ${p.role}`);
    if (p.url) lines.push(`**URL**: [${p.url}](${p.url})`);
    if (p.summary) {
        lines.push('');
        lines.push('## 概要');
        lines.push('');
        lines.push(p.summary);
    }
    return lines.join('\n');
}

function publicationToMarkdown(entity) {
    const p = entity.payload;
    const lines = [];
    lines.push(`# 『${p.title || entity.id}』`);
    lines.push('');
    if (p.format) lines.push(`**形態**: ${p.format}`);
    if (p.authors?.length) lines.push(`**著者**: ${p.authors.join(' / ')}`);
    if (p.achievement) lines.push(`**実績**: ${p.achievement}`);
    if (p.url) lines.push(`**リンク**: [${p.url}](${p.url})`);
    if (p.note) {
        lines.push('');
        lines.push(`**備考**: ${p.note}`);
    }
    return lines.join('\n');
}

function pressMentionToMarkdown(entity) {
    const p = entity.payload;
    const lines = [];
    lines.push(`# ${p.medium || entity.id}`);
    lines.push('');
    if (p.date) lines.push(`**日付**: ${p.date}${p.date_note ? ` (${p.date_note})` : ''}`);
    if (p.medium) lines.push(`**媒体**: ${p.medium}`);
    if (p.section) lines.push(`**枠**: ${p.section}`);
    if (p.content) {
        lines.push('');
        lines.push('## 内容');
        lines.push('');
        lines.push(p.content);
    }
    if (p.note) {
        lines.push('');
        lines.push(`**備考**: ${p.note}`);
    }
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
    const personSourceId = entity.payload?.person_id;
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
        case 'speaking':
            return personSourceId ? `people/${personSourceId}/speaking/${id}` : `other/speaking/${id}`;
        case 'media_appearance':
            return personSourceId ? `people/${personSourceId}/media/${id}` : `other/media/${id}`;
        case 'role_assignment':
            return personSourceId ? `people/${personSourceId}/roles/${id}` : `other/roles/${id}`;
        case 'product':
            return personSourceId ? `people/${personSourceId}/products/${id}` : `other/products/${id}`;
        case 'publication':
            return personSourceId ? `people/${personSourceId}/publications/${id}` : `other/publications/${id}`;
        case 'press_mention':
            return personSourceId ? `people/${personSourceId}/press/${id}` : `other/press/${id}`;
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
        case 'speaking': return speakingToMarkdown(entity);
        case 'media_appearance': return mediaAppearanceToMarkdown(entity);
        case 'role_assignment': return roleAssignmentToMarkdown(entity);
        case 'product': return productToMarkdown(entity);
        case 'publication': return publicationToMarkdown(entity);
        case 'press_mention': return pressMentionToMarkdown(entity);
        default: return genericToMarkdown(entity);
    }
}

// ─────────────────── Inventory runner ───────────────────

const ENTITY_QUERY = `SELECT id AS entity_id, entity_type, project_id, payload, role_min, sensitivity, updated_at
         FROM graph_entities
         WHERE entity_type IN ('person', 'project', 'org', 'decision', 'glossary_term',
                                'speaking', 'media_appearance', 'role_assignment',
                                'product', 'publication', 'press_mention')
           AND id NOT LIKE 'simproj_%'
           AND id NOT LIKE '%_simproj_%'
           AND COALESCE(payload->>'code', '') NOT LIKE 'simproj_%'
           AND COALESCE(project_id, '') NOT IN (
             SELECT id FROM graph_entities
             WHERE entity_type = 'project'
               AND payload->>'code' LIKE 'simproj_%'
           )
         ORDER BY entity_type, id`;

/**
 * Read the GraphDB rows and inspect the corresponding Wiki paths.
 *
 * This runner is deliberately dry-run only. The injected fs/pool arguments
 * make the read-only and failure boundaries testable without touching a real
 * database or the saved Wiki tree.
 */
export async function runGraphWikiInventory({
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
        throw new Error('ERROR: INFO_SSOT_DATABASE_URL is required');
    }

    const pool = suppliedPool || new pg.Pool({ connectionString: dbUrl });
    const ownsPool = !suppliedPool;

    try {
    // 1. Fetch all entities from graph_entities
    logMessage(logger, 'log', '[migrate] Fetching entities from graph_entities...');
    const { rows: entities } = await pool.query(
        ENTITY_QUERY
    );
    logMessage(logger, 'log', `[migrate] Found ${entities.length} entities`);

    // 2. Filter: only migrate narrative-suitable types (skip raci, app, customer)
    const stats = { created: 0, skipped: 0, dbInserted: 0 };

    for (const entity of entities) {
        const wikiPath = entityToWikiPath(entity);
        const filePath = path.join(wikiRoot, `${wikiPath}.md`);
        const content = entityToMarkdown(entity);

        // Check if file already exists
        try {
            await fsImpl.access(filePath);
            logMessage(logger, 'log', `  [skip] ${wikiPath} (already exists)`);
            stats.skipped++;
            continue;
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                throw new Error(`Unable to inspect Wiki file ${filePath}: ${error.message}`, { cause: error });
            }
        }

        logMessage(logger, 'log', `  [dry-run] Would create: ${wikiPath} (${content.length} chars)`);
        stats.created++;
    }

    // 4. Summary
    logMessage(logger, 'log', '\n========== Migration Summary ==========');
    logMessage(logger, 'log', `  Files created:   ${stats.created}`);
    logMessage(logger, 'log', `  Files skipped:   ${stats.skipped}`);
    logMessage(logger, 'log', `  DB records:      ${stats.dbInserted}`);
    logMessage(logger, 'log', `  Wiki root:       ${wikiRoot}`);
    logMessage(logger, 'log', '  ⚠️  DRY RUN - no changes were made');
    logMessage(logger, 'log', '========================================');

    return { entities, stats };
    } finally {
        if (ownsPool) await pool.end();
    }
}

export async function main(argv = process.argv.slice(2)) {
    const dryRun = argv.includes('--dry-run');
    const wikiRoot = argv.find((_, index, args) => args[index - 1] === '--wiki-root')
        || process.env.BRAINBASE_WIKI_ROOT
        || path.resolve(__dirname, '..', '..', 'wiki');
    const dbUrl = process.env.INFO_SSOT_DATABASE_URL || process.env.INFO_SSOT_DB_URL;

    if (!dryRun) {
        console.error(`ERROR: ${RETIRED_MESSAGE}`);
        return 1;
    }
    if (!dbUrl) {
        console.error('ERROR: INFO_SSOT_DATABASE_URL is required');
        return 1;
    }

    console.log(`[migrate] Wiki root: ${wikiRoot}`);
    console.log(`[migrate] Dry run: ${dryRun}`);
    await runGraphWikiInventory({ dryRun, wikiRoot, dbUrl });
    return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
    main().then(code => {
        if (code) process.exitCode = code;
    }).catch(error => {
        console.error('[migrate] Fatal error:', error);
        process.exitCode = 1;
    });
}
