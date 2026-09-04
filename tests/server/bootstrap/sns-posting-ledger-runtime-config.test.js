// @ts-check
import { describe, expect, it } from 'vitest';

import { databaseConfig, selectedMigrations } from '../../../scripts/migrate-m5a-production-schema.js';

describe('SNS廃止後の共通M5-A移行設定', () => {
    it('共通の明示的な移行先をSNS専用DB設定より優先する', () => {
        expect(databaseConfig({
            M5A_DATABASE_URL: 'postgres://release-db',
            SNS_POSTING_LEDGER_DATABASE_URL: 'postgres://retired-sns-ledger',
            INFO_SSOT_DATABASE_URL: 'postgres://info-ssot'
        })).toEqual({ connectionString: 'postgres://release-db' });
    });

    it('SNS専用DB設定があっても既存の共通Info SSOTを使う', () => {
        expect(databaseConfig({
            SNS_POSTING_LEDGER_DATABASE_URL: 'postgres://retired-sns-ledger',
            INFO_SSOT_DATABASE_URL: 'postgres://info-ssot'
        })).toEqual({ connectionString: 'postgres://info-ssot' });
    });

    it('SNS専用DB設定だけでは共通移行先を構成しない', () => {
        expect(databaseConfig({
            SNS_POSTING_LEDGER_DATABASE_URL: 'postgres://retired-sns-ledger',
            PGDATABASE: 'common',
            PGUSER: 'app'
        })).toMatchObject({ database: 'common', user: 'app' });
        expect(databaseConfig({
            SNS_POSTING_LEDGER_DATABASE_URL: 'postgres://retired-sns-ledger'
        })).toMatchObject({ host: '127.0.0.1', port: 25432 });
    });

    it('M5-Aの既定移行からSNS台帳を除外する', () => {
        const migrations = selectedMigrations([]);
        expect(migrations.some(({ id }) => id === 'sns-posting-ledger')).toBe(false);
        expect(migrations.filter(({ id }) => id === 'personal-knowledge')).toHaveLength(2);
    });

    it('廃止されたSNS台帳の明示選択を拒否する', () => {
        expect(() => selectedMigrations(['--only', 'sns-posting-ledger']))
            .toThrow('Unknown migration id: sns-posting-ledger');
    });
});
