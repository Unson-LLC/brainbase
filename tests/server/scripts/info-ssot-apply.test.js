import { execFile as execFileCallback } from 'node:child_process';
import { access, chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const applyScript = path.join(repoRoot, 'scripts/info-ssot-apply.sh');

async function createPsqlFixture({ failOn = '' } = {}) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'info-ssot-apply-'));
    const logPath = path.join(root, 'psql.log');
    const receiptPath = path.join(root, 'receipt.json');
    const psqlPath = path.join(root, 'fake-psql.sh');
    await writeFile(psqlPath, `#!/usr/bin/env bash
set -euo pipefail

printf '%s\\n' "$*" >> "$FAKE_PSQL_LOG"

for arg in "$@"; do
    if [[ "$arg" == *"info-ssot-${failOn}.sql" ]]; then
        exit 73
    fi
done

TUPLES_ONLY=0
if [[ "$*" == *"-Atq"* ]]; then
    TUPLES_ONLY=1
fi

emit_marker() {
    if [[ "$TUPLES_ONLY" == 1 ]]; then
        printf '%s\\n' "$1"
    else
        # Reproduce the aligned psql output that would make grep -Fqx fail
        # unless the caller explicitly requests tuples-only/unaligned output.
        printf ' marker\\n-----------------------\\n %s\\n(1 row)\\n' "$1"
    fi
}

if [[ "$*" == *"server_version"* ]]; then
    printf '%s\\n' '16.4 (Ubuntu 16.4-1.pgdg22.04+1)'
    exit 0
fi

if [[ "$*" == *"-Atqc"* ]]; then
    printf '%s\\n' 'brainbase@127.0.0.1/32:5432'
    exit 0
fi

for arg in "$@"; do
    case "$arg" in
        *info-ssot-readback.sql) emit_marker 'INFO_SSOT_READBACK_OK' ;;
        *info-ssot-negative-smoke.sql) emit_marker 'INFO_SSOT_NEGATIVE_SMOKE_OK' ;;
    esac
done
`);
    await chmod(psqlPath, 0o700);
    return { root, logPath, receiptPath, psqlPath, failOn };
}

async function runApply(fixture, extraEnv = {}) {
    return execFile(applyScript, [], {
        cwd: repoRoot,
        env: {
            ...process.env,
            INFO_SSOT_DATABASE_URL: 'postgres://test:test@example.test/brainbase',
            INFO_SSOT_GIT_SHA: 'a'.repeat(40),
            INFO_SSOT_ROLLBACK_SHA: 'b'.repeat(40),
            INFO_SSOT_APPLY_RECEIPT_PATH: fixture.receiptPath,
            PSQL_BIN: fixture.psqlPath,
            FAKE_PSQL_LOG: fixture.logPath,
            ...extraEnv,
        },
    });
}

describe('Info SSOT RLS deployment contract', () => {
    it('models aligned psql output and requires tuples-only markers', async () => {
        const fixture = await createPsqlFixture();
        const { stdout } = await execFile(
            fixture.psqlPath,
            ['postgres://test:test@example.test/brainbase', '-f', path.join(repoRoot, 'server/sql/info-ssot-readback.sql')],
            { env: { ...process.env, FAKE_PSQL_LOG: fixture.logPath } },
        );

        expect(stdout).toContain('(1 row)');
        expect(stdout).not.toMatch(/^INFO_SSOT_READBACK_OK$/mu);
    });

    it('runs schema, RLS, readback and smoke in fail-closed single-transaction mode', async () => {
        const script = await readFile(applyScript, 'utf8');

        expect(script).toMatch(/ON_ERROR_STOP=1/u);
        expect(script).toMatch(/--single-transaction/u);
        expect(script).toMatch(/info-ssot-readback\.sql/u);
        expect(script).toMatch(/info-ssot-negative-smoke\.sql/u);
        expect(script).toMatch(/INFO_SSOT_APPLY_RECEIPT_PATH/u);

        const fixture = await createPsqlFixture();
        await runApply(fixture);
        await runApply(fixture);

        const receipt = JSON.parse(await readFile(fixture.receiptPath, 'utf8'));
        expect(receipt).toMatchObject({
            status: 'applied',
            operation_mode: 'apply',
            database_bundle_sha: 'a'.repeat(40),
            service_target_sha: 'a'.repeat(40),
            git_sha: 'a'.repeat(40),
            transaction: 'single',
            on_error_stop: true,
            readback: { status: 'passed', marker: 'INFO_SSOT_READBACK_OK' },
            negative_smoke: { status: 'passed', marker: 'INFO_SSOT_NEGATIVE_SMOKE_OK' },
            server_version: '16.4 (Ubuntu 16.4-1.pgdg22.04+1)',
            rollback: {
                status: 'documented',
                rollback_sha: 'b'.repeat(40),
                database_strategy: 'forward_only_rls',
                service_strategy: 'switch_to_recorded_sha',
            },
        });

        const invocations = (await readFile(fixture.logPath, 'utf8')).trim().split('\n');
        expect(invocations.length).toBeGreaterThanOrEqual(3);
        expect(invocations[0]).toMatch(/--single-transaction/u);
        expect(invocations[0]).toMatch(/-Atq/u);
        expect(invocations[0]).toMatch(/ON_ERROR_STOP=1/u);
        expect(invocations[0]).toMatch(/info-ssot-schema\.sql/u);
        expect(invocations[0]).toMatch(/info-ssot-rls\.sql/u);
        expect(invocations[0]).toMatch(/info-ssot-readback\.sql/u);
        expect(invocations[0]).toMatch(/info-ssot-negative-smoke\.sql/u);
        expect(invocations.filter((invocation) => invocation.includes('info-ssot-negative-smoke.sql'))).toHaveLength(2);
        expect(invocations.filter((invocation) => invocation.includes('--single-transaction'))).toHaveLength(2);
    });

    it('does not write an apply receipt when readback fails', async () => {
        const fixture = await createPsqlFixture({ failOn: 'readback' });

        await expect(runApply(fixture)).rejects.toMatchObject({ code: expect.anything() });
        await expect(access(fixture.receiptPath)).rejects.toThrow();
    });

    it('distinguishes rollback preparation from a normal apply in the receipt', async () => {
        const fixture = await createPsqlFixture();

        await runApply(fixture, { INFO_SSOT_OPERATION_MODE: 'rollback_prepare' });

        const receipt = JSON.parse(await readFile(fixture.receiptPath, 'utf8'));
        expect(receipt).toMatchObject({
            operation_mode: 'rollback_prepare',
            database_bundle_sha: 'a'.repeat(40),
            service_target_sha: 'b'.repeat(40),
        });
    });

    it('rejects an unknown operation mode before touching PostgreSQL', async () => {
        const fixture = await createPsqlFixture();

        await expect(runApply(fixture, { INFO_SSOT_OPERATION_MODE: 'down_migration' }))
            .rejects.toMatchObject({ code: expect.anything() });
        await expect(access(fixture.logPath)).rejects.toThrow();
        await expect(access(fixture.receiptPath)).rejects.toThrow();
    });

    it('rolls back the schema transaction when the negative smoke fails', async () => {
        const fixture = await createPsqlFixture({ failOn: 'negative-smoke' });

        await expect(runApply(fixture)).rejects.toMatchObject({ code: expect.anything() });
        await expect(access(fixture.receiptPath)).rejects.toThrow();

        const invocations = (await readFile(fixture.logPath, 'utf8')).trim().split('\n');
        expect(invocations).toHaveLength(1);
        expect(invocations[0]).toMatch(/--single-transaction/u);
        expect(invocations[0]).toMatch(/info-ssot-schema\.sql/u);
        expect(invocations[0]).toMatch(/info-ssot-rls\.sql/u);
        expect(invocations[0]).toMatch(/info-ssot-readback\.sql/u);
        expect(invocations[0]).toMatch(/info-ssot-negative-smoke\.sql/u);
    });

    it('requires a recorded rollback SHA before touching PostgreSQL', async () => {
        const fixture = await createPsqlFixture();

        await expect(runApply(fixture, { INFO_SSOT_ROLLBACK_SHA: '' })).rejects.toMatchObject({ code: expect.anything() });
        await expect(access(fixture.logPath)).rejects.toThrow();
        await expect(access(fixture.receiptPath)).rejects.toThrow();
    });

    it('keeps the SQL readback and smoke contracts explicit', async () => {
        const readbackSql = await readFile(path.join(repoRoot, 'server/sql/info-ssot-readback.sql'), 'utf8');
        const smokeSql = await readFile(path.join(repoRoot, 'server/sql/info-ssot-negative-smoke.sql'), 'utf8');

        for (const table of ['decisions', 'events', 'raci_assignments', 'graph_entities', 'graph_edges']) {
            expect(readbackSql).toContain(table);
        }
        expect(readbackSql).toContain('INFO_SSOT_READBACK_OK');
        expect(smokeSql).toContain('INFO_SSOT_NEGATIVE_SMOKE_OK');
        expect(smokeSql).toMatch(/rel_type,\s+project_id/u);
        expect(smokeSql).toContain("'governs'");
        expect(smokeSql).toContain('wrong-owner');
        expect(smokeSql).toContain('fixture residual');
        expect(smokeSql).toMatch(/raise exception/iu);
    });

    it('documents the RLS gate before the API/MCP restart', async () => {
        const runbook = await readFile(path.join(repoRoot, 'docs/runbooks/info-ssot-rls-deployment.md'), 'utf8');
        const deploymentRunbook = await readFile(
            path.join(repoRoot, 'docs/brainbase-capabilities/runbooks/deploy-lightsail-production.md'),
            'utf8',
        );

        expect(runbook).toContain('API/MCPを再起動する前');
        expect(runbook).toContain('INFO_SSOT_NEGATIVE_SMOKE_OK');
        expect(runbook).toContain(': "${ROLLBACK_SHA:?');
        expect(runbook).toContain('INFO_SSOT_ROLLBACK_SHA="$ROLLBACK_SHA"');
        expect(runbook).toContain('INFO_SSOT_OPERATION_MODE="apply"');
        expect(runbook).toContain('INFO_SSOT_OPERATION_MODE="rollback_prepare"');
        expect(runbook).toContain('operation_mode=rollback_prepare');
        expect(runbook).toContain('DBのRLSは旧定義へ戻さず');
        expect(runbook).toContain('rollback.database_strategy=forward_only_rls');
        expect(runbook).not.toContain('git cat-file -e "$ROLLBACK_SHA:scripts/info-ssot-apply.sh"');
        expect(runbook).toContain('(../brainbase-capabilities/runbooks/deploy-lightsail-production.md)');
        const rollbackApplyOffset = runbook.lastIndexOf('bash scripts/info-ssot-apply.sh');
        const rollbackSwitchOffset = runbook.indexOf('git switch --detach "$ROLLBACK_SHA"');
        expect(rollbackApplyOffset).toBeGreaterThan(-1);
        expect(rollbackSwitchOffset).toBeGreaterThan(-1);
        expect(rollbackApplyOffset).toBeLessThan(rollbackSwitchOffset);
        expect(deploymentRunbook).toContain('(../../runbooks/info-ssot-rls-deployment.md)');
        expect(deploymentRunbook).toContain('The database is forward-only');
        expect(deploymentRunbook).toContain('rollback.database_strategy=forward_only_rls');
        expect(deploymentRunbook.indexOf('bash scripts/info-ssot-apply.sh'))
            .toBeLessThan(deploymentRunbook.indexOf('sudo systemctl restart brainbase-ssot.service'));
        expect(deploymentRunbook.lastIndexOf('sudo systemctl stop brainbase-ssot.service'))
            .toBeLessThan(deploymentRunbook.lastIndexOf('bash scripts/info-ssot-apply.sh'));
        expect(deploymentRunbook.lastIndexOf('bash scripts/info-ssot-apply.sh'))
            .toBeLessThan(deploymentRunbook.lastIndexOf('sudo systemctl restart brainbase-ssot.service'));
    });
});
