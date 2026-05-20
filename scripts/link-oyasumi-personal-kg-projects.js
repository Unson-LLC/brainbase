#!/usr/bin/env node
// @ts-check
import process from 'node:process';
import pg from 'pg';

const { Pool } = pg;
const SOURCE_SYSTEM = 'oyasumi-meeting-personal-kg';
const LINK_VERSION = 'project-link-v1';
const PROJECT_CODE_ALIASES = {
    'back-office': ['back_office'],
    'tech-knight': ['tech-knight', 'techknight'],
    'vibepro-project': ['vibepro'],
    'ncom-catalyst': ['ncom-catalyst', 'ncom'],
    salestailor: ['salestailor'],
    brainbase: ['brainbase'],
    baao: ['baao'],
    zeims: ['zeims'],
    senrigan: ['senrigan'],
    senpainurse: ['senpainurse'],
    mywa: ['mywa'],
    dialogai: ['dialogai'],
    aitle: ['aitle'],
    'unson-os': ['unson-os']
};

function parseArgs(argv) {
    const args = { write: false, limit: null, projectCode: null, json: false };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--write') args.write = true;
        else if (arg === '--dry-run') args.write = false;
        else if (arg === '--json') args.json = true;
        else if (arg === '--limit') args.limit = Number(argv[++index]);
        else if (arg.startsWith('--limit=')) args.limit = Number(arg.slice('--limit='.length));
        else if (arg === '--project-code') args.projectCode = argv[++index];
        else if (arg.startsWith('--project-code=')) args.projectCode = arg.slice('--project-code='.length);
    }
    if (args.limit !== null && (!Number.isInteger(args.limit) || args.limit <= 0)) throw new Error('--limit must be a positive integer');
    return args;
}

function databaseConfig() {
    if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL };
    if (process.env.INFO_SSOT_DATABASE_URL) return { connectionString: process.env.INFO_SSOT_DATABASE_URL };
    return {
        host: process.env.PGHOST || '127.0.0.1',
        port: Number(process.env.PGPORT || 25432),
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD
    };
}

function normalizeKey(value) {
    return String(value || '').toLowerCase().replace(/_/gu, '-').replace(/\s+/gu, '-').trim();
}

function graphProjectKeys(entity) {
    const payload = entity.payload || {};
    return [entity.id, entity.project_id, payload.code, payload.name, ...(Array.isArray(payload.aliases) ? payload.aliases : [])]
        .filter(Boolean)
        .map(normalizeKey);
}

async function loadProjectIndex(pool) {
    const { rows } = await pool.query(`SELECT id, project_id, payload FROM graph_entities WHERE entity_type = 'project'`);
    const index = new Map();
    for (const row of rows) {
        for (const key of graphProjectKeys(row)) {
            if (!index.has(key)) index.set(key, row);
        }
    }
    return index;
}

function matchProjectEntity(projectIndex, projectCode) {
    for (const key of [projectCode, ...(PROJECT_CODE_ALIASES[projectCode] || [])].map(normalizeKey)) {
        const entity = projectIndex.get(key);
        if (entity) return { entity, matchedBy: key === normalizeKey(projectCode) ? 'project_code' : 'project_code_alias' };
    }
    return { entity: null, matchedBy: null };
}

function buildProjectLink({ candidate, entity, matchedBy }) {
    return {
        entity_type: 'project',
        entity_id: entity.id,
        entity_code: entity.payload?.code || candidate.project_code,
        relation: 'about_project',
        confidence: 1,
        matched_by: matchedBy === 'project_code_alias' ? 'minutes_source_project_code_alias' : 'minutes_source_project_code',
        source_project_code: candidate.project_code,
        source_system: SOURCE_SYSTEM,
        link_version: LINK_VERSION
    };
}

function hasSameProjectLink(existing, nextLink) {
    const links = Array.isArray(existing) ? existing : [];
    return links.some((link) => link?.entity_type === nextLink.entity_type
        && link?.entity_id === nextLink.entity_id
        && link?.entity_code === nextLink.entity_code
        && link?.relation === nextLink.relation
        && link?.matched_by === nextLink.matched_by
        && link?.source_project_code === nextLink.source_project_code
        && link?.link_version === nextLink.link_version);
}

function mergeLinks(existing, nextLink) {
    const links = Array.isArray(existing) ? existing.filter(Boolean) : [];
    return [
        ...links.filter((link) => !(link?.entity_type === 'project' && link?.relation === 'about_project' && link?.link_version === LINK_VERSION)),
        nextLink
    ];
}

async function listCandidates(pool, args) {
    const conditions = [`source_system = $1`, `permission_snapshot ? 'oyasumi_meeting_personal_kg'`, `project_code IS NOT NULL`];
    const params = [SOURCE_SYSTEM];
    if (args.projectCode) {
        params.push(args.projectCode);
        conditions.push(`project_code = $${params.length}`);
    }
    const { rows } = await pool.query(`
        SELECT id, project_code, permission_snapshot
        FROM memory_candidates
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at ASC, id ASC
        ${args.limit ? `LIMIT ${args.limit}` : ''}
    `, params);
    return rows;
}

async function updateCandidateLinks(pool, candidate, links) {
    await pool.query(
        `UPDATE memory_candidates SET permission_snapshot = $2::jsonb, updated_at = NOW() WHERE id = $1`,
        [candidate.id, JSON.stringify({ ...(candidate.permission_snapshot || {}), personal_kg_entity_links: links })]
    );
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const pool = new Pool(databaseConfig());
    try {
        const projectIndex = await loadProjectIndex(pool);
        const candidates = await listCandidates(pool, args);
        const summary = { mode: args.write ? 'write' : 'dry-run', scanned: candidates.length, linked: 0, unresolved: 0, unchanged: 0, by_project_code: {}, unresolved_project_codes: {} };
        for (const candidate of candidates) {
            const projectCode = candidate.project_code;
            const bucket = summary.by_project_code[projectCode] || { scanned: 0, linked: 0, unresolved: 0 };
            bucket.scanned += 1;
            summary.by_project_code[projectCode] = bucket;
            const { entity, matchedBy } = matchProjectEntity(projectIndex, projectCode);
            if (!entity) {
                summary.unresolved += 1;
                bucket.unresolved += 1;
                summary.unresolved_project_codes[projectCode] = (summary.unresolved_project_codes[projectCode] || 0) + 1;
                continue;
            }
            const nextLink = buildProjectLink({ candidate, entity, matchedBy });
            const currentLinks = candidate.permission_snapshot?.personal_kg_entity_links;
            if (hasSameProjectLink(currentLinks, nextLink)) {
                summary.unchanged += 1;
                continue;
            }
            if (args.write) await updateCandidateLinks(pool, candidate, mergeLinks(currentLinks, nextLink));
            summary.linked += 1;
            bucket.linked += 1;
        }
        if (args.json) console.log(JSON.stringify(summary, null, 2));
        else {
            console.log(`mode: ${summary.mode}`);
            console.log(`scanned: ${summary.scanned}`);
            console.log(`linked: ${summary.linked}`);
            console.log(`unchanged: ${summary.unchanged}`);
            console.log(`unresolved: ${summary.unresolved}`);
            if (Object.keys(summary.unresolved_project_codes).length > 0) console.log(`unresolved_project_codes: ${JSON.stringify(summary.unresolved_project_codes)}`);
        }
    } finally {
        await pool.end();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

export { parseArgs, matchProjectEntity, buildProjectLink, mergeLinks, hasSameProjectLink };
