#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

import { InfoSSOTService } from '../server/services/info-ssot-service.js';
import {
    OUTCOME_CASE_CONTROL_PLANE_TARGET,
    OutcomeCaseProductionProvisioningError,
    provisionOutcomeCaseControlPlane,
    readbackOutcomeCaseControlPlane
} from '../server/services/outcome-case/outcome-case-production-provisioner.js';

export function parseProvisionOutcomeCaseControlPlaneArgs(argv = [], env = process.env) {
    const modes = ['check', 'dry-run', 'apply'].filter((mode) => argv.includes(`--${mode}`));
    if (modes.length !== 1) {
        throw new OutcomeCaseProductionProvisioningError(
            'ARGUMENT_INVALID', 'Specify exactly one of --check, --dry-run, or --apply'
        );
    }
    const mode = modes[0];
    const allowed = new Set([`--${mode}`]);
    if (mode === 'apply') allowed.add('--approve-apply');
    if (argv.some((argument) => !allowed.has(argument))) {
        throw new OutcomeCaseProductionProvisioningError('ARGUMENT_INVALID', 'Unsupported OutcomeCase provisioning argument');
    }
    if (mode === 'apply' && !argv.includes('--approve-apply')) {
        throw new OutcomeCaseProductionProvisioningError('APPLY_APPROVAL_REQUIRED', 'Apply requires --approve-apply');
    }
    const actorId = String(env.BRAINBASE_PROVISIONING_ACTOR ?? '').trim();
    if (mode === 'apply' && !actorId) {
        throw new OutcomeCaseProductionProvisioningError('ACTOR_REQUIRED', 'BRAINBASE_PROVISIONING_ACTOR is required for apply');
    }
    return { mode, actorId: actorId || mode };
}

export async function runProvisionOutcomeCaseControlPlane({
    argv = process.argv.slice(2),
    env = process.env,
    pool = null,
    infoSSOTService = null
} = {}) {
    const args = parseProvisionOutcomeCaseControlPlaneArgs(argv, env);
    if (args.mode === 'check') {
        return { ok: true, mode: args.mode, persisted: false, target: OUTCOME_CASE_CONTROL_PLANE_TARGET };
    }
    const databaseUrl = env.INFO_SSOT_DATABASE_URL || env.INFO_SSOT_DB_URL;
    const activePool = pool ?? (databaseUrl ? new Pool({ connectionString: databaseUrl }) : null);
    const service = infoSSOTService ?? (activePool ? new InfoSSOTService({ pool: activePool }) : null);
    if (!service) {
        throw new OutcomeCaseProductionProvisioningError(
            'DATABASE_CONFIG_REQUIRED', 'INFO_SSOT_DATABASE_URL or INFO_SSOT_DB_URL is required'
        );
    }
    try {
        const result = await provisionOutcomeCaseControlPlane({
            infoSSOTService: service,
            actorId: args.actorId,
            commit: args.mode === 'apply'
        });
        if (args.mode !== 'apply') return { ok: true, mode: args.mode, ...result };
        const postCommitReadback = await readbackOutcomeCaseControlPlane({ infoSSOTService: service });
        return { ok: true, mode: args.mode, ...result, post_commit_readback: postCommitReadback };
    } finally {
        if (!pool && !infoSSOTService && activePool) {
            try { await activePool.end(); } catch { /* Never expose database details. */ }
        }
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runProvisionOutcomeCaseControlPlane()
        .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
        .catch((error) => {
            process.stderr.write(`${error.code ?? 'OUTCOME_CASE_PROVISIONING_FAILED'}: ${error.message}\n`);
            process.exitCode = 1;
        });
}
