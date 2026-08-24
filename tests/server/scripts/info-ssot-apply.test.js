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

if [[ "$*" == *"-Atqc"* ]]; then
    printf '%s\\n' 'brainbase@127.0.0.1:5432'
fi

for arg in "$@"; do
    case "$arg" in
        *info-ssot-readback.sql) printf '%s\\n' 'INFO_SSOT_READBACK_OK' ;;
        *info-ssot-negative-smoke.sql) printf '%s\\n' 'INFO_SSOT_NEGATIVE_SMOKE_OK' ;;
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
            git_sha: 'a'.repeat(40),
            transaction: 'single',
            on_error_stop: true,
            readback: { status: 'passed', marker: 'INFO_SSOT_READBACK_OK' },
            negative_smoke: { status: 'passed', marker: 'INFO_SSOT_NEGATIVE_SMOKE_OK' },
            rollback: {
                status: 'documented',
                rollback_sha: 'b'.repeat(40),
            },
        });

        const invocations = (await readFile(fixture.logPath, 'utf8')).trim().split('\n');
        expect(invocations.length).toBeGreaterThanOrEqual(3);
        expect(invocations[0]).toMatch(/--single-transaction/u);
        expect(invocations[0]).toMatch(/ON_ERROR_STOP=1/u);
        expect(invocations[0]).toMatch(/info-ssot-schema\.sql/u);
        expect(invocations[0]).toMatch(/info-ssot-rls\.sql/u);
        expect(invocations[0]).toMatch(/info-ssot-readback\.sql/u);
        expect(invocations.some((invocation) => invocation.includes('info-ssot-negative-smoke.sql'))).toBe(true);
    });

    it('does not write an apply receipt when readback fails', async () => {
        const fixture = await createPsqlFixture({ failOn: 'readback' });

        await expect(runApply(fixture)).rejects.toMatchObject({ code: expect.anything() });
        await expect(access(fixture.receiptPath)).rejects.toThrow();
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
        expect(runbook).toContain('INFO_SSOT_ROLLBACK_SHA="$FAILED_SHA"');
        expect(deploymentRunbook.indexOf('bash scripts/info-ssot-apply.sh'))
            .toBeLessThan(deploymentRunbook.indexOf('sudo systemctl restart brainbase-ssot.service'));
        expect(deploymentRunbook.lastIndexOf('bash scripts/info-ssot-apply.sh'))
            .toBeLessThan(deploymentRunbook.lastIndexOf('sudo systemctl restart brainbase-ssot.service'));
    });
});
