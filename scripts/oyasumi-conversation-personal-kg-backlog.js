#!/usr/bin/env node
// @ts-check
import os from 'node:os';
import process from 'node:process';
import pg from 'pg';

import { collectConversationLogFiles } from './local-data-server-ssot-inventory.js';
import {
    collectConversationMessagesByDate,
    extractConversationPersonalKgCandidates
} from './oyasumi-conversation-personal-kg.js';
import { SOURCE_SYSTEM } from '../server/services/sns/oyasumi-meeting-personal-kg-service.js';
import { requirePersonalKgIdentity } from '../server/services/sns/personal-kg-identity.js';
import { resolvePersonalKgCliAuthority } from './lib/personal-kg-cli-authority.js';

function parseArgs(argv) {
    const args = {
        dateFrom: null,
        dateTo: null,
        json: false,
        homeDir: os.homedir(),
        compareServer: false,
        ownerPersonId: null,
        actorPersonId: null,
        organizationId: null,
        delegationId: null,
        includeCodex: true,
        includeClaudeCode: true,
        limit: null
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--date') {
            args.dateFrom = argv[++index];
            args.dateTo = args.dateFrom;
        } else if (arg.startsWith('--date=')) {
            args.dateFrom = arg.slice('--date='.length);
            args.dateTo = args.dateFrom;
        } else if (arg === '--from') args.dateFrom = argv[++index];
        else if (arg.startsWith('--from=')) args.dateFrom = arg.slice('--from='.length);
        else if (arg === '--to') args.dateTo = argv[++index];
        else if (arg.startsWith('--to=')) args.dateTo = arg.slice('--to='.length);
        else if (arg === '--home') args.homeDir = argv[++index];
        else if (arg.startsWith('--home=')) args.homeDir = arg.slice('--home='.length);
        else if (arg === '--compare-server') args.compareServer = true;
        else if (arg === '--json') args.json = true;
        else if (arg === '--owner' || arg === '--owner-person-id') args.ownerPersonId = argv[++index];
        else if (arg.startsWith('--owner=')) args.ownerPersonId = arg.slice('--owner='.length);
        else if (arg.startsWith('--owner-person-id=')) args.ownerPersonId = arg.slice('--owner-person-id='.length);
        else if (arg === '--actor' || arg === '--actor-person-id') args.actorPersonId = argv[++index];
        else if (arg.startsWith('--actor=')) args.actorPersonId = arg.slice('--actor='.length);
        else if (arg.startsWith('--actor-person-id=')) args.actorPersonId = arg.slice('--actor-person-id='.length);
        else if (arg === '--organization' || arg === '--organization-id') args.organizationId = argv[++index];
        else if (arg.startsWith('--organization=')) args.organizationId = arg.slice('--organization='.length);
        else if (arg.startsWith('--organization-id=')) args.organizationId = arg.slice('--organization-id='.length);
        else if (arg === '--delegation-id') args.delegationId = argv[++index];
        else if (arg.startsWith('--delegation-id=')) args.delegationId = arg.slice('--delegation-id='.length);
        else if (arg === '--codex-only') args.includeClaudeCode = false;
        else if (arg === '--claude-code-only') args.includeCodex = false;
        else if (arg === '--limit') args.limit = Number(argv[++index]);
        else if (arg.startsWith('--limit=')) args.limit = Number(arg.slice('--limit='.length));
        else if (arg === '--all') {
            // Default behavior already scans all available dates.
        }
    }
    for (const [label, value] of [['--from', args.dateFrom], ['--to', args.dateTo]]) {
        if (value && !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
            throw new Error(`${label} requires YYYY-MM-DD`);
        }
    }
    return args;
}

function personalKgIdentity(options) {
    return requirePersonalKgIdentity({
        owner_person_id: options?.owner_person_id || options?.ownerPersonId,
        actor_person_id: options?.actor_person_id || options?.actorPersonId,
        organization_id: options?.organization_id || options?.organizationId,
        org_ids: options?.org_ids,
        project_code: options?.project_code || options?.projectCode,
        authority_resolution_receipt_id: options?.authority_resolution_receipt_id,
        identity_resolution_receipt_id: options?.identity_resolution_receipt_id
    });
}

function databaseConfig() {
    if (process.env.INFO_SSOT_DATABASE_URL || process.env.INFO_SSOT_DB_URL) {
        return { connectionString: process.env.INFO_SSOT_DATABASE_URL || process.env.INFO_SSOT_DB_URL };
    }
    if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL };
    return null;
}

function candidateSourceRef(candidate) {
    const kg = candidate.permission_snapshot?.oyasumi_meeting_personal_kg || {};
    if (kg.source_ref) return kg.source_ref;
    const sourceEventIds = Array.isArray(candidate.source_event_ids) ? candidate.source_event_ids : [];
    return sourceEventIds.find((value) => String(value).startsWith('codex-claude-conversation:')) || null;
}

function indexExistingCandidates(candidates = []) {
    const refs = new Set();
    for (const candidate of candidates) {
        const sourceRef = candidateSourceRef(candidate);
        if (sourceRef) refs.add(sourceRef);
    }
    return refs;
}

async function loadExistingConversationCandidates({ connectionString, ownerPersonId, organizationId }) {
    if (!connectionString) {
        throw new Error('--compare-server requires INFO_SSOT_DATABASE_URL, INFO_SSOT_DB_URL, or DATABASE_URL');
    }
    if (!ownerPersonId || !organizationId) {
        throw new Error('ownerPersonId and organizationId are required for Personal KG database reads');
    }
    const pool = new pg.Pool({ connectionString });
    try {
        const result = await pool.query(
            `SELECT id, source_event_ids, permission_snapshot, created_at
             FROM memory_candidates
             WHERE source_system = $1
               AND owner_person_id = $2
               AND organization_id = $3
               AND workspace = 'codex-claude-code'
               AND permission_snapshot->'oyasumi_meeting_personal_kg'->>'source_kind' = 'daily_interaction'`,
            [SOURCE_SYSTEM, ownerPersonId, organizationId]
        );
        return result.rows;
    } finally {
        await pool.end().catch(() => {});
    }
}

function filterDates(dates, { dateFrom, dateTo, limit }) {
    let filtered = dates.filter((date) => {
        if (dateFrom && date < dateFrom) return false;
        if (dateTo && date > dateTo) return false;
        return true;
    });
    if (Number.isInteger(limit) && limit > 0 && filtered.length > limit) {
        filtered = filtered.slice(filtered.length - limit);
    }
    return filtered;
}

function summarizeDates(dates) {
    const summary = {
        dates_considered: dates.length,
        input_messages: 0,
        adopted_candidates: 0,
        existing_candidates: 0,
        missing_candidates: 0,
        needs_review_candidates: 0,
        by_status: {}
    };
    for (const date of dates) {
        summary.input_messages += date.input_count;
        summary.adopted_candidates += date.adopted_count;
        summary.existing_candidates += date.existing_count;
        summary.missing_candidates += date.missing_count;
        summary.needs_review_candidates += date.needs_review_count;
        summary.by_status[date.status] = (summary.by_status[date.status] || 0) + 1;
    }
    return summary;
}

function buildConversationBacklog({
    homeDir = os.homedir(),
    dateFrom = null,
    dateTo = null,
    includeCodex = true,
    includeClaudeCode = true,
    existingCandidates = [],
    limit = null,
    compareServer = existingCandidates.length > 0,
    identity
} = {}) {
    const access = personalKgIdentity(identity);
    const groupedMessages = collectConversationMessagesByDate({ homeDir, includeCodex, includeClaudeCode });
    const allDates = filterDates(Object.keys(groupedMessages), { dateFrom, dateTo, limit });
    const existingRefs = indexExistingCandidates(existingCandidates);
    const rawLogFiles = collectConversationLogFiles(homeDir);
    const dates = allDates.map((date) => {
        const messages = groupedMessages[date] || [];
        const extracted = extractConversationPersonalKgCandidates({ date, messages, identity: access });
        const candidateRules = extracted.adopted.map((candidate) => {
            const kg = candidate.permission_snapshot?.oyasumi_meeting_personal_kg || {};
            const sourceRef = candidateSourceRef(candidate);
            return {
                rule_id: kg.rule_id || candidate.id,
                memory_layer: kg.memory_layer || null,
                sensitivity: candidate.sensitivity,
                redaction_status: candidate.redaction_status,
                source_ref: sourceRef,
                existing: sourceRef ? existingRefs.has(sourceRef) : false
            };
        });
        const existingCount = candidateRules.filter((rule) => rule.existing).length;
        const missingCount = candidateRules.length - existingCount;
        const needsReviewCount = candidateRules.filter((rule) => rule.memory_layer === 'needs_review').length;
        let status = 'completed';
        if (messages.length === 0) status = 'no_input';
        else if (candidateRules.length === 0) status = 'no_candidate';
        else if (missingCount > 0) status = 'needs_write';
        return {
            date,
            status,
            input_count: messages.length,
            adopted_count: candidateRules.length,
            existing_count: existingCount,
            missing_count: missingCount,
            needs_review_count: needsReviewCount,
            candidate_rules: candidateRules
        };
    });
    const summary = summarizeDates(dates);
    return {
        mode: compareServer ? 'conversation_personal_kg_backlog_compare_server' : 'conversation_personal_kg_backlog',
        source_system: SOURCE_SYSTEM,
        raw_log_file_count: rawLogFiles.length,
        raw_log_source_kinds: {
            codex_history: rawLogFiles.filter((filePath) => filePath.includes('/.codex/')).length,
            claude_code_project_log: rawLogFiles.filter((filePath) => filePath.includes('/.claude/projects/')).length
        },
        summary,
        dates
    };
}

function outputText(backlog) {
    const lines = [
        `${SOURCE_SYSTEM} conversation personal KG backlog`,
        `mode: ${backlog.mode}`,
        `raw_log_file_count: ${backlog.raw_log_file_count}`,
        `dates_considered: ${backlog.summary.dates_considered}`,
        `input_messages: ${backlog.summary.input_messages}`,
        `adopted_candidates: ${backlog.summary.adopted_candidates}`,
        `existing_candidates: ${backlog.summary.existing_candidates}`,
        `missing_candidates: ${backlog.summary.missing_candidates}`,
        `needs_review_candidates: ${backlog.summary.needs_review_candidates}`,
        `by_status: ${JSON.stringify(backlog.summary.by_status)}`
    ];
    for (const date of backlog.dates) {
        lines.push(`${date.date}\t${date.status}\tinput=${date.input_count}\tadopted=${date.adopted_count}\texisting=${date.existing_count}\tmissing=${date.missing_count}\tneeds_review=${date.needs_review_count}`);
    }
    return lines.join('\n');
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const identity = resolvePersonalKgCliAuthority({
        assertedIdentity: args,
        desiredEffect: 'read'
    });
    const existingCandidates = args.compareServer
        ? await loadExistingConversationCandidates({
            connectionString: databaseConfig()?.connectionString,
            ownerPersonId: identity.owner_person_id,
            organizationId: identity.organization_id
        })
        : [];
    const backlog = buildConversationBacklog({
        homeDir: args.homeDir,
        dateFrom: args.dateFrom,
        dateTo: args.dateTo,
        includeCodex: args.includeCodex,
        includeClaudeCode: args.includeClaudeCode,
        existingCandidates,
        limit: args.limit,
        compareServer: args.compareServer,
        identity
    });
    console.log(args.json ? JSON.stringify(backlog, null, 2) : outputText(backlog));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

export {
    buildConversationBacklog,
    candidateSourceRef,
    filterDates,
    indexExistingCandidates,
    loadExistingConversationCandidates,
    parseArgs
};
