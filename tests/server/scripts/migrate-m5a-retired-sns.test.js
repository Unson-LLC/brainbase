import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { databaseConfig, selectedMigrations } from '../../../scripts/migrate-m5a-production-schema.js';

describe('SNS廃止後の共通M5-A移行', () => {
    it('SNS台帳を除外し共通知識移行を残す', () => {
        const migrations = selectedMigrations([]);
        expect(migrations.some(({ id }) => id === 'sns-posting-ledger')).toBe(false);
        expect(migrations.filter(({ id }) => id === 'personal-knowledge')).toHaveLength(2);
        expect(migrations.map(({ id }) => id)).toContain('candidate-store');
    });

    it('SNS専用DB設定を共通知識移行に流用しない', () => {
        expect(databaseConfig({ SNS_POSTING_LEDGER_DATABASE_URL: 'postgres://retired', INFO_SSOT_DATABASE_URL: 'postgres://common' }))
            .toEqual({ connectionString: 'postgres://common' });
        expect(databaseConfig({ SNS_POSTING_LEDGER_DATABASE_URL: 'postgres://retired', PGDATABASE: 'common', PGUSER: 'app' }))
            .toMatchObject({ database: 'common', user: 'app' });
    });

    it('共通移行の明示選択を維持し、重複指定を拒否する', () => {
        expect(selectedMigrations(['--only=personal-knowledge'])).toHaveLength(2);
        expect(() => selectedMigrations(['--only', 'personal-knowledge', '--only', 'sns-posting-ledger']))
            .toThrow('Specify --only once');
        expect(() => selectedMigrations(['--only=personal-knowledge', '--only=sns-posting-ledger']))
            .toThrow('Specify --only once');
    });

    it.each([
        ['--only', 'sns-posting-ledger'],
        ['--only=sns-posting-ledger'],
    ])('廃止された明示選択 %j をDB設定・接続より前に拒否する', (...args) => {
        const result = spawnSync(process.execPath, ['scripts/migrate-m5a-production-schema.js', ...args], {
            cwd: process.cwd(),
            env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 10000,
        });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Unknown migration id: sns-posting-ledger');
        expect(result.stderr).not.toContain('Missing PostgreSQL config');
    });
});
