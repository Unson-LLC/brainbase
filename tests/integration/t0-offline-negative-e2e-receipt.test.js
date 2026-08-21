import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

import {
    createForbiddenExternalAdapters,
    createFixtureOnlyAdapterLayer,
    REPOSITORY_ROOT,
    runT0OfflineNegativeE2E
} from '../../scripts/run-t0-offline-negative-e2e.js';

const BASE_SHA = 'e44843bd1bfc995c760dd6ec7e2916d62685a514';
const WORKTREE_ROOT = REPOSITORY_ROOT;
const HEAD_SHA = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: WORKTREE_ROOT,
    encoding: 'utf8'
}).trim();
const SCRIPT_PATH = resolve(WORKTREE_ROOT, 'scripts/run-t0-offline-negative-e2e.js');
const REDELIVERY_EVENT = Object.freeze({
    event_id: 'evt-t0-direct-redelivery-001',
    tenant_id: 'tenant-unson-business'
});

function runCli(args) {
    return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
        encoding: 'utf8'
    });
}

describe('T0 offline-negative E2E Receipt', () => {
    test('keeps the fixture-only boundary and records the three negative cases', () => {
        const externalAdapters = createForbiddenExternalAdapters();
        const receipt = runT0OfflineNegativeE2E({
            baseSha: BASE_SHA,
            headSha: HEAD_SHA,
            externalAdapters
        });

        expect(receipt).toMatchObject({
            schema_version: 't0.offline_negative_e2e_receipt.v1',
            mode: 'fixture-only',
            base_sha: BASE_SHA,
            head_sha: HEAD_SHA,
            fixture_harness_status: 'success',
            production_executed: false,
            deploy_allowed: false,
            external_adapter_calls: 0
        });
        expect(receipt).not.toHaveProperty('status');
        expect(receipt.fixture_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(Object.keys(receipt.cases)).toEqual([
            'same_event_redelivery',
            'cross_tenant_rejected',
            'upstream_unavailable'
        ]);

        expect(receipt.cases.same_event_redelivery).toMatchObject({
            status: 'passed',
            counters: { provider: 1, delivery: 1, accounting: 1 }
        });
        expect(receipt.cases.cross_tenant_rejected).toMatchObject({
            status: 'blocked',
            rejected_before: 'resolver',
            counters: { resolver: 0, provider: 0, delivery: 0, accounting: 0 }
        });
        expect(receipt.cases.upstream_unavailable).toMatchObject({
            status: 'blocked',
            failure_code: 'UPSTREAM_UNAVAILABLE',
            resolution: { available: false },
            counters: { resolver: 1, provider: 0, delivery: 0, accounting: 0 },
            external_readback: { state: 'not_collected', quantities: null }
        });
        expect(externalAdapters.boundary_checks).toBeGreaterThan(0);
        expect(externalAdapters.calls).toEqual([]);
    });

    test('fails closed if upstream fixture reports available=true', () => {
        const externalAdapters = createForbiddenExternalAdapters();

        expect(() => runT0OfflineNegativeE2E({
            baseSha: BASE_SHA,
            headSha: HEAD_SHA,
            externalAdapters,
            upstreamAvailable: true
        })).toThrow('upstream unavailable fixture must resolve with available=false');
        expect(externalAdapters.calls).toEqual([]);
    });

    test('rejects a non-exact base/head binding and production-shaped adapters', () => {
        expect(() => runT0OfflineNegativeE2E({
            baseSha: '0'.repeat(40),
            headSha: HEAD_SHA
        })).toThrow(`baseSha must match the fixed T0 base ${BASE_SHA}`);
        expect(() => runT0OfflineNegativeE2E({
            baseSha: BASE_SHA,
            headSha: 'f'.repeat(40)
        })).toThrow(/headSha must match current git HEAD/);
        expect(() => runT0OfflineNegativeE2E({
            baseSha: BASE_SHA,
            headSha: HEAD_SHA,
            externalAdapters: {
                mode: 'production',
                calls: [],
                assertUnused() {}
            }
        })).toThrow('fixture-only external adapter boundary is required; production adapters are forbidden');
    });

    test('rejects a structurally forged fixture-only adapter before injection calls', () => {
        const forgedCalls = [];
        const forgedExternalAdapters = {
            mode: 'fixture-only-forbidden',
            calls: forgedCalls,
            assertUnused() {},
            provider: {
                applyOnce() {
                    forgedCalls.push({ adapter: 'provider', method: 'applyOnce' });
                    return true;
                }
            }
        };

        expect(() => runT0OfflineNegativeE2E({
            baseSha: BASE_SHA,
            headSha: HEAD_SHA,
            externalAdapters: forgedExternalAdapters,
            injectForbiddenAdapter: 'provider'
        })).toThrow('fixture-only external adapter boundary identity is required');
        expect(forgedCalls).toEqual([]);
    });

    test('keeps fixture results deterministic for the exact git binding', () => {
        const first = runT0OfflineNegativeE2E({ baseSha: BASE_SHA, headSha: HEAD_SHA });
        const second = runT0OfflineNegativeE2E({ baseSha: BASE_SHA, headSha: HEAD_SHA });

        expect(second.fixture_hash).toBe(first.fixture_hash);
        expect(second.cases).toEqual(first.cases);
    });

    test('guards provider, delivery, and accounting on direct redelivery', () => {
        const externalAdapters = createForbiddenExternalAdapters();
        const counters = { resolver: 0, provider: 0, delivery: 0, accounting: 0 };
        const layer = createFixtureOnlyAdapterLayer({
            externalBoundary: externalAdapters,
            counters
        });

        expect(layer.provider.applyOnce(REDELIVERY_EVENT)).toBe(true);
        expect(layer.provider.applyOnce(REDELIVERY_EVENT)).toBe(false);
        expect(layer.delivery.deliverOnce(REDELIVERY_EVENT)).toBe(REDELIVERY_EVENT.event_id);
        expect(layer.delivery.deliverOnce(REDELIVERY_EVENT)).toBe(false);
        expect(layer.accounting.recordOnce(REDELIVERY_EVENT)).toBe(REDELIVERY_EVENT.event_id);
        expect(layer.accounting.recordOnce(REDELIVERY_EVENT)).toBe(false);
        expect(counters).toEqual({ resolver: 0, provider: 1, delivery: 1, accounting: 1 });
        expect(externalAdapters.calls).toEqual([]);
    });

    test('fails closed when a forbidden adapter is injected into normal fixture processing', () => {
        const externalAdapters = createForbiddenExternalAdapters();

        expect(() => runT0OfflineNegativeE2E({
            baseSha: BASE_SHA,
            headSha: HEAD_SHA,
            externalAdapters,
            injectForbiddenAdapter: 'provider'
        })).toThrow('external adapter call is forbidden in fixture-only mode');
        expect(externalAdapters.calls).toEqual([
            { adapter: 'provider', method: 'applyOnce' }
        ]);
    });

    test('rejects a forged low-level external boundary before provider calls', () => {
        const forgedCalls = [];
        const forgedExternalBoundary = {
            mode: 'fixture-only-forbidden',
            calls: [],
            assertUnused() {
                forgedCalls.push('boundary');
            }
        };
        const forgedInjectedAdapters = {
            provider: {
                applyOnce() {
                    forgedCalls.push('provider');
                    return true;
                }
            }
        };

        expect(() => {
            const layer = createFixtureOnlyAdapterLayer({
                externalBoundary: forgedExternalBoundary,
                counters: { resolver: 0, provider: 0, delivery: 0, accounting: 0 },
                injectedForbiddenAdapters: forgedInjectedAdapters
            });
            layer.provider.applyOnce(REDELIVERY_EVENT);
        }).toThrow('fixture-only external adapter boundary identity is required');
        expect(forgedCalls).toEqual([]);
    });

    test('rejects a forged low-level injection before provider calls', () => {
        const externalAdapters = createForbiddenExternalAdapters();
        const forgedCalls = [];
        const forgedInjectedAdapters = {
            provider: {
                applyOnce() {
                    forgedCalls.push('provider');
                    return true;
                }
            }
        };

        expect(() => {
            const layer = createFixtureOnlyAdapterLayer({
                externalBoundary: externalAdapters,
                counters: { resolver: 0, provider: 0, delivery: 0, accounting: 0 },
                injectedForbiddenAdapters: forgedInjectedAdapters
            });
            layer.provider.applyOnce(REDELIVERY_EVENT);
        }).toThrow('fixture-only adapter injection identity is required');
        expect(forgedCalls).toEqual([]);
        expect(externalAdapters.calls).toEqual([]);
    });

    test('fails closed if a fixture attempts any external adapter call', () => {
        const externalAdapters = createForbiddenExternalAdapters();

        [
            ['resolver', 'resolve'],
            ['provider', 'recordEffect'],
            ['delivery', 'deliver'],
            ['accounting', 'recordUsage']
        ].forEach(([adapter, method]) => {
            expect(() => externalAdapters[adapter][method]()).toThrow(
                'external adapter call is forbidden in fixture-only mode'
            );
        });
        expect(externalAdapters.calls).toEqual([
            { adapter: 'resolver', method: 'resolve' },
            { adapter: 'provider', method: 'recordEffect' },
            { adapter: 'delivery', method: 'deliver' },
            { adapter: 'accounting', method: 'recordUsage' }
        ]);
    });

    test('prints one machine-readable Receipt in fixture-only CLI mode', () => {
        const stdout = execFileSync(process.execPath, [
            SCRIPT_PATH,
            '--json',
            '--base-sha',
            BASE_SHA,
            '--head-sha',
            HEAD_SHA
        ], { encoding: 'utf8' });
        const receipt = JSON.parse(stdout);

        expect(receipt).toMatchObject({
            base_sha: BASE_SHA,
            head_sha: HEAD_SHA,
            fixture_harness_status: 'success',
            mode: 'fixture-only',
            production_executed: false,
            deploy_allowed: false
        });
        expect(stdout.trim().split('\n')).toHaveLength(1);
    });

    test('fails with exit 1 for an unknown CLI option', () => {
        const result = runCli([
            '--json',
            '--base-sha',
            BASE_SHA,
            '--head-sha',
            HEAD_SHA,
            '--unknown-option'
        ]);

        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr.trim()).toBe(
            't0 offline-negative e2e: unknown option: --unknown-option'
        );
    });

    test('fails with exit 1 when --json is omitted', () => {
        const result = runCli([
            '--base-sha',
            BASE_SHA,
            '--head-sha',
            HEAD_SHA
        ]);

        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr.trim()).toBe(
            't0 offline-negative e2e: --json is required for machine-readable output'
        );
    });
});
