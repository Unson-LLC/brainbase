#!/usr/bin/env node
// @ts-check
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

import {
    collectConversationMessages,
    extractConversationPersonalKgCandidates,
    loadInputMessages,
    parseArgs
} from './oyasumi-conversation-personal-kg.js';
import { PgCandidateRepository } from '../server/services/candidate-store/candidate-repository.js';
import { PromotionGateService } from '../server/services/candidate-store/promotion-gate-service.js';
import { writeMeetingPersonalKgCandidates } from '../server/services/sns/oyasumi-meeting-personal-kg-service.js';
import { canonicalPersonalKgOwner } from '../server/services/personal-kg-owner.js';

const { Pool } = pg;
const DEFAULT_TMP_ROOT = '/tmp';

function flagValue(argv, names) {
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        for (const name of names) {
            if (arg === name) return argv[index + 1] || null;
            if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
        }
    }
    return null;
}

function requiredIdentityValue(value, code) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) throw new Error(code);
    return normalized;
}

export function resolveConversationPersonalKgIdentity(argv, env = process.env) {
    const rawOwner = flagValue(argv, ['--owner-person-id', '--owner'])
        || env.BRAINBASE_PERSONAL_KG_OWNER_PERSON_ID;
    const ownerPersonId = canonicalPersonalKgOwner(
        requiredIdentityValue(rawOwner, 'personal_kg_owner_person_id_required'),
        env
    );
    const actorPersonId = requiredIdentityValue(
        flagValue(argv, ['--actor-person-id', '--actor'])
            || env.BRAINBASE_PERSONAL_KG_ACTOR_PERSON_ID,
        'personal_kg_actor_person_id_required'
    );
    const organizationId = requiredIdentityValue(
        flagValue(argv, ['--organization-id', '--organization'])
            || env.BRAINBASE_PERSONAL_KG_ORGANIZATION_ID
            || env.BRAINBASE_ORGANIZATION_ID,
        'personal_kg_organization_id_required'
    );
    const projectCode = requiredIdentityValue(
        flagValue(argv, ['--project-code', '--project'])
            || env.BRAINBASE_PERSONAL_KG_PROJECT_CODE,
        'personal_kg_project_code_required'
    );
    return {
        personId: ownerPersonId,
        organizationId,
        actorPersonId,
        projectCodes: [projectCode],
        projectCode,
        role: 'member',
        clearance: ['internal']
    };
}

function scopedCandidateId(candidateId, ownerPersonId) {
    const ownerHash = crypto.createHash('sha256').update(ownerPersonId).digest('hex').slice(0, 10);
    const base = String(candidateId || 'personal_kg_candidate').slice(0, 168);
    return `${base}_${ownerHash}`.slice(0, 180);
}

export function scopeConversationExtraction(extracted, access) {
    const adopted = (extracted.adopted || []).map((candidate) => ({
        ...candidate,
        id: scopedCandidateId(candidate.id, access.personId),
        owner_person_id: access.personId,
        organization_id: access.organizationId,
        actor_person_id: access.actorPersonId,
        project_code: access.projectCode,
        org_ids: [access.organizationId],
        project_ids: [access.projectCode],
        recommended_owner_person_id: access.personId,
        permission_snapshot: {
            ...(candidate.permission_snapshot || {}),
            personal_kg_identity: {
                owner_person_id: access.personId,
                actor_person_id: access.actorPersonId,
                organization_id: access.organizationId,
                project_code: access.projectCode,
                source: 'authenticated_local_profile_required'
            }
        }
    }));
    return {
        ...extracted,
        adopted,
        counts: {
            ...(extracted.counts || {}),
            identity_scoped: adopted.length
        }
    };
}

function databaseConfig(env = process.env) {
    if (env.INFO_SSOT_DATABASE_URL || env.INFO_SSOT_DB_URL) {
        return { connectionString: env.INFO_SSOT_DATABASE_URL || env.INFO_SSOT_DB_URL };
    }
    if (env.DATABASE_URL) return { connectionString: env.DATABASE_URL };
    return {
        host: env.PGHOST || '127.0.0.1',
        port: Number(env.PGPORT || 25432),
        database: env.PGDATABASE,
        user: env.PGUSER,
        password: env.PGPASSWORD
    };
}

function validateDatabaseConfig(config) {
    if (config.connectionString) return;
    const missing = ['database', 'user'].filter((key) => !config[key]);
    if (missing.length > 0) {
        throw new Error(`Missing PostgreSQL config: ${missing.join(', ')}. Set INFO_SSOT_DATABASE_URL or PGDATABASE/PGUSER.`);
    }
}

function writePrivateFile(filePath, content) {
    fs.writeFileSync(filePath, content, { mode: 0o600 });
    fs.chmodSync(filePath, 0o600);
}

function outputText({ extracted, writeSummary, messagesPath, extractionPath, write, access }) {
    const lines = [
        `oyasumi conversation Personal KG: ${extracted.date}`,
        `mode: ${write ? 'write' : 'dry-run'}`,
        `owner_person_id: ${access.personId}`,
        `actor_person_id: ${access.actorPersonId}`,
        `organization_id: ${access.organizationId}`,
        `project_code: ${access.projectCode}`,
        `conversation.input_count: ${extracted.input_count}`,
        `personal_kg_core: ${extracted.counts?.personal_kg_core || 0}`,
        `needs_review: ${extracted.counts?.needs_review || 0}`,
        `messages_path: ${messagesPath}`,
        `extraction_path: ${extractionPath}`
    ];
    if (writeSummary) {
        lines.push(`inserted: ${writeSummary.inserted}`);
        lines.push(`skipped: ${writeSummary.skipped}`);
        lines.push(`blocked: ${writeSummary.blocked}`);
    }
    return lines.join('\n');
}

async function writeScopedCandidates(extracted, access, env = process.env) {
    const config = databaseConfig(env);
    validateDatabaseConfig(config);
    const pool = new Pool(config);
    try {
        const repository = new PgCandidateRepository({ pool });
        const candidateService = {
            createCandidate: (candidate) => repository.transaction(
                async (scopedRepository) => new PromotionGateService({ repository: scopedRepository })
                    .createCandidate(candidate),
                { access }
            )
        };
        return await writeMeetingPersonalKgCandidates({ candidateService, extracted });
    } finally {
        await pool.end();
    }
}

export async function runConversationPersonalKg(argv = process.argv.slice(2), env = process.env) {
    const args = parseArgs(argv);
    const access = resolveConversationPersonalKgIdentity(argv, env);
    const outputDir = args.outputDir || path.join(DEFAULT_TMP_ROOT, `oyasumi-${args.date}`);
    fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(outputDir, 0o700);

    const messages = args.input
        ? loadInputMessages(args.input)
        : collectConversationMessages({
            date: args.date,
            includeCodex: args.includeCodex,
            includeClaudeCode: args.includeClaudeCode
        });
    const messagesPath = path.join(outputDir, 'conversation-user-messages.jsonl');
    writePrivateFile(
        messagesPath,
        messages.map((message) => JSON.stringify(message)).join('\n') + (messages.length ? '\n' : '')
    );

    const extracted = scopeConversationExtraction(
        extractConversationPersonalKgCandidates({ date: args.date, messages }),
        access
    );
    const extractionPath = path.join(outputDir, 'conversation-personal-kg-extraction.json');
    writePrivateFile(extractionPath, JSON.stringify(extracted, null, 2));

    if (messages.length === 0 && !args.allowEmpty) {
        const error = new Error('conversation input_count is 0; log collection likely failed');
        error.code = 'conversation_log_collection_failed';
        throw error;
    }

    const writeSummary = args.write ? await writeScopedCandidates(extracted, access, env) : null;
    return {
        mode: args.write ? 'write' : 'dry-run',
        identity: {
            owner_person_id: access.personId,
            actor_person_id: access.actorPersonId,
            organization_id: access.organizationId,
            project_code: access.projectCode
        },
        messages_path: messagesPath,
        extraction_path: extractionPath,
        extracted,
        write_summary: writeSummary,
        text: outputText({ extracted, writeSummary, messagesPath, extractionPath, write: args.write, access })
    };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    runConversationPersonalKg().then((result) => {
        const json = process.argv.includes('--json');
        console.log(json ? JSON.stringify(result, null, 2) : result.text);
    }).catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}