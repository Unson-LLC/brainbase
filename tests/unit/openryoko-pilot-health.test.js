import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const scriptPath = path.resolve('scripts/openryoko/check-pilot-health.sh');

function writeExecutable(filePath, body) {
    fs.writeFileSync(filePath, `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
}

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openryoko-health-'));
    const homeDir = path.join(root, 'home');
    const stateDir = path.join(homeDir, '.local/state/openryoko-run-receipt');
    const binDir = path.join(root, 'bin');
    const meminfoFile = path.join(root, 'meminfo');
    fs.mkdirSync(path.join(stateDir, 'outbox'), { recursive: true });
    fs.mkdirSync(path.join(stateDir, 'dead-letter'), { recursive: true });
    fs.mkdirSync(binDir);
    writeExecutable(path.join(binDir, 'systemctl'), 'printf "active\\n"');
    writeExecutable(path.join(binDir, 'curl'), 'exit 0');
    fs.writeFileSync(meminfoFile, 'MemAvailable:       1048576 kB\n');
    return { root, homeDir, stateDir, binDir, meminfoFile };
}

function runHealth({ homeDir, binDir, meminfoFile }, extraEnv = {}) {
    return spawnSync('bash', [scriptPath], {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        env: {
            ...process.env,
            PATH: `${binDir}:${process.env.PATH}`,
            HOME_DIR: homeDir,
            OPENRYOKO_MEMINFO_FILE: meminfoFile,
            ...extraEnv
        }
    });
}

describe('OpenRyoko pilot health check', () => {
    it('reports metadata-only healthy state', () => {
        const testFixture = fixture();
        const result = runHealth(testFixture);

        expect(result.status).toBe(0);
        const output = JSON.parse(result.stdout);
        expect(output.status).toBe('healthy');
        expect(output.services).toEqual({
            openryoko: 'active',
            receipt_timer: 'active',
            gateway: 'healthy'
        });
        expect(output.receipt_delivery).toMatchObject({
            outbox_count: 0,
            dead_letter_count: 0,
            oldest_outbox_age_seconds: 0
        });
        expect(output.failures).toEqual([]);
        expect(result.stdout).not.toMatch(/token|prompt|transcript/i);
    });

    it('fails closed when a dead-letter exists', () => {
        const testFixture = fixture();
        fs.writeFileSync(
            path.join(testFixture.stateDir, 'dead-letter/rr1_example.json'),
            JSON.stringify({ delivery: { idempotency_key: 'not-emitted' } })
        );

        const result = runHealth(testFixture);

        expect(result.status).toBe(1);
        const output = JSON.parse(result.stdout);
        expect(output.status).toBe('unhealthy');
        expect(output.receipt_delivery.dead_letter_count).toBe(1);
        expect(output.failures).toContain('dead_letter_present');
        expect(result.stdout).not.toContain('not-emitted');
    });

    it('fails when an outbox item is older than the threshold', () => {
        const testFixture = fixture();
        const outboxFile = path.join(testFixture.stateDir, 'outbox/rr1_stalled.json');
        fs.writeFileSync(outboxFile, '{}');
        const oldTime = new Date(Date.now() - 10_000);
        fs.utimesSync(outboxFile, oldTime, oldTime);

        const result = runHealth(testFixture, {
            OPENRYOKO_MAX_OUTBOX_AGE_SECONDS: '1'
        });

        expect(result.status).toBe(1);
        const output = JSON.parse(result.stdout);
        expect(output.receipt_delivery.outbox_count).toBe(1);
        expect(output.receipt_delivery.oldest_outbox_age_seconds).toBeGreaterThan(1);
        expect(output.failures).toContain('outbox_stalled');
    });
});
