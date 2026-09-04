#!/usr/bin/env node
// @ts-check
import process from 'node:process';
import path from 'node:path';
import pg from 'pg';

import {
    JsonFileSnsPostingLedgerRepository,
    PgSnsPostingLedgerRepository,
    isSnsPostingLedgerJsonTestMode
} from '../server/services/sns/posting-ledger-repository.js';
import {
    createSnsPostScriptExecutor,
    SnsLedgerPublishService
} from '../server/services/sns/sns-ledger-publish-service.js';
import { SnsScheduledPublisher } from '../server/services/sns/sns-scheduled-publisher.js';
import { createTenantRuntimeServicesFromEnv } from '../server/services/multitenant/tenant-runtime-services.js';
import { throwRetiredSnsCli } from './lib/retired-sns-cli.js';

const { Pool } = pg;

export function parseArgs(argv) {
    const args = {
        now: null,
        limit: 20,
        dryRun: false,
        json: false
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--now') args.now = argv[++i];
        if (arg === '--limit') args.limit = Number(argv[++i]);
        if (arg === '--dry-run') args.dryRun = true;
        if (arg === '--json') args.json = true;
    }
    return args;
}

export function validateArgs(args) {
    if (args.now && Number.isNaN(new Date(args.now).getTime())) {
        throw new Error('--now must be an ISO datetime');
    }
    if (!Number.isInteger(args.limit) || args.limit < 1) {
        throw new Error('--limit must be a positive integer');
    }
}

export function resolveAutoPublishEnabled(env = process.env) {
    return ['true', '1', 'yes'].includes(String(env.SNS_AUTO_PUBLISH_ENABLED || '').toLowerCase());
}

export function resolveSnsPostingLedgerDatabaseUrl(env = process.env) {
    if (env.SNS_POSTING_LEDGER_DATABASE_URL) return env.SNS_POSTING_LEDGER_DATABASE_URL;
    if (env.BRAINBASE_TEST_MODE === 'true') return '';
    return env.INFO_SSOT_DATABASE_URL || env.INFO_SSOT_DB_URL || env.DATABASE_URL || '';
}

export function resolveSnsPostingLedgerFile(env = process.env, cwd = process.cwd()) {
    return env.SNS_POSTING_LEDGER_FILE || path.join(cwd, 'var', 'sns-posting-ledger.json');
}

export function shouldUseJsonLedgerForTest(env = process.env) {
    return isSnsPostingLedgerJsonTestMode(env);
}

function requiredEnvironmentValue(env, name) {
    const value = String(env?.[name] ?? '').trim();
    if (!value) throw new Error(`${name} is required for scheduled SNS publishing`);
    return value;
}

function resolveProjectCodes(value) {
    if (value === undefined || value === null) return [];
    const raw = String(value).trim();
    if (!raw) throw new Error('SNS_ACTOR_PROJECT_CODES must not be empty when provided');
    const projectCodes = [...new Set(raw.split(',').map((projectCode) => projectCode.trim()).filter(Boolean))];
    if (projectCodes.length === 0) throw new Error('SNS_ACTOR_PROJECT_CODES must contain at least one project code');
    return projectCodes;
}

export function resolveSnsScheduledPublisherActor(env = process.env) {
    const actorPersonId = requiredEnvironmentValue(env, 'SNS_ACTOR_PERSON_ID');
    const organizationId = requiredEnvironmentValue(env, 'SNS_ORGANIZATION_ID');
    const role = String(env?.SNS_ACTOR_ROLE ?? 'member').trim();
    if (!role) throw new Error('SNS_ACTOR_ROLE must not be empty when provided');
    return {
        sub: actorPersonId,
        actor_person_id: actorPersonId,
        organization_id: organizationId,
        org_ids: [organizationId],
        role,
        projectCodes: resolveProjectCodes(env?.SNS_ACTOR_PROJECT_CODES)
    };
}

export function resolveTenantJobBoundary({
    env = process.env,
    pool,
    requireTenantBoundary = false,
    createServices = createTenantRuntimeServicesFromEnv
} = {}) {
    if (!requireTenantBoundary) {
        return { tenantIsolationRequired: false, tenantBoundaryAuthorizer: null };
    }
    if (env.BRAINBASE_TENANT_RUNTIME_ENABLED !== '1') {
        throw new Error('Tenant runtime is required for public scheduled publishing');
    }
    if (!pool) {
        throw new Error('Tenant runtime PostgreSQL pool is required for public scheduled publishing');
    }
    const services = createServices({ env, pool });
    if (typeof services?.tenantBoundaryGateway?.authorize !== 'function') {
        throw new Error('Tenant boundary gateway is required for public scheduled publishing');
    }
    return {
        tenantIsolationRequired: true,
        tenantBoundaryAuthorizer: ({ tenant_context, resource_ref }) => services.tenantBoundaryGateway.authorize({
            tenant_context,
            entry_point: 'background_job',
            resource_ref
        })
    };
}

export async function runScheduledPosts({
    argv = process.argv.slice(2),
    env = process.env,
    cwd = process.cwd(),
    PoolClass = Pool,
    createServices = createTenantRuntimeServicesFromEnv,
    createPostExecutor = createSnsPostScriptExecutor,
    output = console
} = {}) {
    const args = parseArgs(argv);
    validateArgs(args);
    const publisherActor = resolveSnsScheduledPublisherActor(env);
    const databaseUrl = resolveSnsPostingLedgerDatabaseUrl(env);
    const pool = databaseUrl ? new PoolClass({ connectionString: databaseUrl }) : null;
    try {
        if (!pool && !shouldUseJsonLedgerForTest(env)) {
            throw new Error('SNS Posting Ledger PostgreSQL URL is required outside explicit JSON test mode');
        }
        const autoPublishEnabled = resolveAutoPublishEnabled(env);
        const tenantJobBoundary = resolveTenantJobBoundary({
            env,
            pool,
            requireTenantBoundary: autoPublishEnabled && !args.dryRun,
            createServices
        });
        const ledgerRepository = pool
            ? new PgSnsPostingLedgerRepository({ pool })
            : new JsonFileSnsPostingLedgerRepository({ filePath: resolveSnsPostingLedgerFile(env, cwd) });
        const publishService = new SnsLedgerPublishService({
            ledgerRepository,
            postExecutor: createPostExecutor({
                pythonPath: env.SNS_POST_PYTHON,
                scriptPath: env.SNS_POST_SCRIPT
            })
        });
        const publisher = new SnsScheduledPublisher({
            ledgerRepository,
            publishService,
            tenantBoundaryAuthorizer: tenantJobBoundary.tenantBoundaryAuthorizer,
            now: () => args.now ? new Date(args.now) : new Date()
        });
        const result = await publisher.run({
            actor: publisherActor,
            dry_run: args.dryRun,
            auto_publish_enabled: autoPublishEnabled,
            limit: args.limit
        });
        const outputText = JSON.stringify(result, null, 2);
        if (args.json) {
            output.log(outputText);
        } else {
            output.log(`SNS scheduled publisher: due=${result.due} posted=${result.posted} failed=${result.failed} skipped=${result.skipped} dry_run=${result.dry_run}`);
            output.log(outputText);
        }
        return result;
    } finally {
        await pool?.end();
    }
}

export async function main() {
    throwRetiredSnsCli('run-sns-scheduled-posts.js');
    const result = await runScheduledPosts();
    if (result.failed > 0) process.exitCode = 1;
    return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
