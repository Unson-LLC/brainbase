#!/usr/bin/env node

// Deterministic contract fixture only; this is not production E2E evidence.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RECEIPT_SCHEMA_VERSION = 't0.offline_negative_e2e_receipt.v1';
const RUN_ID = 't0-offline-negative-e2e';
const EXPECTED_BASE_SHA = 'e44843bd1bfc995c760dd6ec7e2916d62685a514';
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const FIXTURE_ONLY_EXTERNAL_ADAPTER_IDENTITIES = new WeakSet();
const FIXTURE_ONLY_FORBIDDEN_ADAPTER_INJECTION_IDENTITIES = new WeakSet();
const EMPTY_FORBIDDEN_ADAPTER_INJECTION = Object.freeze({});
FIXTURE_ONLY_FORBIDDEN_ADAPTER_INJECTION_IDENTITIES.add(EMPTY_FORBIDDEN_ADAPTER_INJECTION);
export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = Object.freeze({
    tenant_id: 'tenant-unson-business',
    redelivery: Object.freeze({
        event_id: 'evt-t0-redelivery-001',
        tenant_id: 'tenant-unson-business',
        provider_effect: 'provider-effect-001'
    }),
    cross_tenant: Object.freeze({
        event_id: 'evt-t0-cross-tenant-001',
        tenant_id: 'tenant-other-fixture'
    }),
    upstream_unavailable: Object.freeze({
        event_id: 'evt-t0-upstream-unavailable-001',
        tenant_id: 'tenant-unson-business',
        upstream: 'fixture-unavailable'
    })
});

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.keys(value)
            .sort()
            .map((key) => [key, canonicalize(value[key])])
    );
}

function canonicalJson(value) {
    return JSON.stringify(canonicalize(value));
}

function sha256(value) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}

function requireSha(value, name) {
    if (typeof value !== 'string' || !SHA_PATTERN.test(value)) {
        throw new TypeError(`${name} must be a 40-character lowercase SHA-1`);
    }
    return value;
}

function readCurrentHeadSha() {
    try {
        return execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: REPOSITORY_ROOT,
            encoding: 'utf8'
        }).trim();
    } catch (error) {
        throw new Error(`unable to bind fixture Receipt to local git HEAD: ${error.message}`);
    }
}

function requireExactGitBinding(baseSha, headSha) {
    if (baseSha !== EXPECTED_BASE_SHA) {
        throw new Error(`baseSha must match the fixed T0 base ${EXPECTED_BASE_SHA}`);
    }
    const currentHeadSha = readCurrentHeadSha();
    if (headSha !== currentHeadSha) {
        throw new Error(`headSha must match current git HEAD ${currentHeadSha}`);
    }
}

function createCounterSet(overrides = {}) {
    return {
        resolver: overrides.resolver ?? 0,
        provider: overrides.provider ?? 0,
        delivery: overrides.delivery ?? 0,
        accounting: overrides.accounting ?? 0
    };
}

/**
 * Build adapters which make an accidental external call fail immediately.
 * The normal fixture run never invokes these functions.
 */
export function createForbiddenExternalAdapters() {
    const calls = [];
    let boundaryChecks = 0;
    const createAdapter = (adapter) => Object.freeze(new Proxy({}, {
        get: (_target, method) => (..._args) => {
            calls.push({ adapter, method: String(method) });
            throw new Error('external adapter call is forbidden in fixture-only mode');
        }
    }));

    const boundary = {
        mode: 'fixture-only-forbidden',
        calls,
        get boundary_checks() {
            return boundaryChecks;
        },
        assertUnused() {
            boundaryChecks += 1;
            if (calls.length > 0) {
                throw new Error('fixture-only run observed an external adapter call');
            }
        },
        resolver: createAdapter('resolver'),
        provider: createAdapter('provider'),
        delivery: createAdapter('delivery'),
        accounting: createAdapter('accounting')
    };
    FIXTURE_ONLY_EXTERNAL_ADAPTER_IDENTITIES.add(boundary);
    return Object.freeze(boundary);
}

function requireFixtureOnlyExternalBoundary(externalAdapters) {
    const hasExpectedShape = Boolean(
        externalAdapters
        && typeof externalAdapters === 'object'
        && externalAdapters.mode === 'fixture-only-forbidden'
        && Array.isArray(externalAdapters.calls)
        && typeof externalAdapters.assertUnused === 'function'
    );
    if (!hasExpectedShape) {
        throw new Error('fixture-only external adapter boundary is required; production adapters are forbidden');
    }
    if (!FIXTURE_ONLY_EXTERNAL_ADAPTER_IDENTITIES.has(externalAdapters)) {
        throw new Error('fixture-only external adapter boundary identity is required; use createForbiddenExternalAdapters');
    }
    externalAdapters.assertUnused();
    return externalAdapters;
}

const FORBIDDEN_ADAPTER_NAMES = Object.freeze([
    'resolver',
    'provider',
    'delivery',
    'accounting'
]);

function requireEventId(event) {
    if (!event || typeof event.event_id !== 'string' || event.event_id.length === 0) {
        throw new TypeError('fixture event_id is required for idempotency');
    }
    return event.event_id;
}

function createForbiddenAdapterInjection(externalBoundary, adapterName) {
    requireFixtureOnlyExternalBoundary(externalBoundary);
    if (adapterName === undefined) return EMPTY_FORBIDDEN_ADAPTER_INJECTION;
    if (!FORBIDDEN_ADAPTER_NAMES.includes(adapterName)) {
        throw new Error(`unknown forbidden adapter injection: ${adapterName}`);
    }
    const injection = Object.freeze({ [adapterName]: externalBoundary[adapterName] });
    FIXTURE_ONLY_FORBIDDEN_ADAPTER_INJECTION_IDENTITIES.add(injection);
    return injection;
}

function requireFixtureOnlyAdapterInjection(injectedForbiddenAdapters) {
    if (
        !injectedForbiddenAdapters
        || typeof injectedForbiddenAdapters !== 'object'
        || !FIXTURE_ONLY_FORBIDDEN_ADAPTER_INJECTION_IDENTITIES.has(injectedForbiddenAdapters)
    ) {
        throw new Error(
            'fixture-only adapter injection identity is required; use fixture-only injection factory'
        );
    }
    return injectedForbiddenAdapters;
}

export function createFixtureOnlyAdapterLayer({
    externalBoundary,
    counters,
    injectedForbiddenAdapters = EMPTY_FORBIDDEN_ADAPTER_INJECTION,
    upstreamAvailable = false
}) {
    const fixtureBoundary = requireFixtureOnlyExternalBoundary(externalBoundary);
    const fixtureInjection = requireFixtureOnlyAdapterInjection(injectedForbiddenAdapters);
    const assertExternalBoundary = () => fixtureBoundary.assertUnused();
    const callInjectedForbiddenAdapter = (adapterName, method, event) => {
        const adapter = fixtureInjection[adapterName];
        if (adapter) adapter[method](event);
    };
    const idempotencyKeys = {
        provider: new Set(),
        delivery: new Set(),
        accounting: new Set()
    };
    return {
        tenantBoundary: {
            rejectCrossTenant(event, tenantId) {
                assertExternalBoundary();
                return event.tenant_id !== tenantId;
            }
        },
        resolver: {
            resolveUpstream(event) {
                assertExternalBoundary();
                callInjectedForbiddenAdapter('resolver', 'resolveUpstream', event);
                counters.resolver += 1;
                return {
                    event_id: event.event_id,
                    available: upstreamAvailable
                };
            }
        },
        provider: {
            applyOnce(event) {
                assertExternalBoundary();
                callInjectedForbiddenAdapter('provider', 'applyOnce', event);
                const idempotencyKey = requireEventId(event);
                if (idempotencyKeys.provider.has(idempotencyKey)) return false;
                idempotencyKeys.provider.add(idempotencyKey);
                counters.provider += 1;
                return true;
            }
        },
        delivery: {
            deliverOnce(event) {
                assertExternalBoundary();
                callInjectedForbiddenAdapter('delivery', 'deliverOnce', event);
                const idempotencyKey = requireEventId(event);
                if (idempotencyKeys.delivery.has(idempotencyKey)) return false;
                idempotencyKeys.delivery.add(idempotencyKey);
                counters.delivery += 1;
                return event.event_id;
            }
        },
        accounting: {
            recordOnce(event) {
                assertExternalBoundary();
                callInjectedForbiddenAdapter('accounting', 'recordOnce', event);
                const idempotencyKey = requireEventId(event);
                if (idempotencyKeys.accounting.has(idempotencyKey)) return false;
                idempotencyKeys.accounting.add(idempotencyKey);
                counters.accounting += 1;
                return event.event_id;
            }
        }
    };
}

function readExternalAdapterCallCount(externalAdapters) {
    return externalAdapters.calls.length;
}

export function runT0OfflineNegativeE2E({
    baseSha,
    headSha,
    externalAdapters,
    injectForbiddenAdapter,
    upstreamAvailable = false
} = {}) {
    const base = requireSha(baseSha, 'baseSha');
    const head = requireSha(headSha, 'headSha');
    requireExactGitBinding(base, head);
    const adapters = requireFixtureOnlyExternalBoundary(
        externalAdapters ?? createForbiddenExternalAdapters()
    );
    const injectedForbiddenAdapters = createForbiddenAdapterInjection(
        adapters,
        injectForbiddenAdapter
    );

    const redeliveryCounters = createCounterSet();
    const redeliveryAdapters = createFixtureOnlyAdapterLayer({
        externalBoundary: adapters,
        counters: redeliveryCounters,
        injectedForbiddenAdapters
    });
    let deduplicatedRedeliveries = 0;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const applied = redeliveryAdapters.provider.applyOnce(FIXTURE.redelivery);
        if (!applied) {
            deduplicatedRedeliveries += 1;
            continue;
        }
        redeliveryAdapters.delivery.deliverOnce(FIXTURE.redelivery);
        redeliveryAdapters.accounting.recordOnce(FIXTURE.redelivery);
    }

    const crossTenantCounters = createCounterSet();
    const crossTenantAdapters = createFixtureOnlyAdapterLayer({
        externalBoundary: adapters,
        counters: crossTenantCounters,
        injectedForbiddenAdapters
    });
    const crossTenantRejected = crossTenantAdapters.tenantBoundary.rejectCrossTenant(
        FIXTURE.cross_tenant,
        FIXTURE.tenant_id
    );
    const crossTenantCase = crossTenantRejected
        ? {
            status: 'blocked',
            reason: 'TENANT_MISMATCH',
            rejected_before: 'resolver',
            counters: crossTenantCounters
        }
        : {
            status: 'failed',
            reason: 'FIXTURE_INVALID',
            counters: crossTenantCounters
        };

    const upstreamCounters = createCounterSet();
    const upstreamAdapters = createFixtureOnlyAdapterLayer({
        externalBoundary: adapters,
        counters: upstreamCounters,
        injectedForbiddenAdapters,
        upstreamAvailable
    });
    const upstreamResolution = upstreamAdapters.resolver.resolveUpstream(FIXTURE.upstream_unavailable);
    if (upstreamResolution.available !== false) {
        throw new Error('upstream unavailable fixture must resolve with available=false');
    }
    const upstreamCase = {
        status: 'blocked',
        failure_code: 'UPSTREAM_UNAVAILABLE',
        counters: upstreamCounters,
        resolution: upstreamResolution,
        external_readback: {
            state: 'not_collected',
            quantities: null
        }
    };

    const cases = {
        same_event_redelivery: {
            status: 'passed',
            attempts: 2,
            deduplicated_redeliveries: deduplicatedRedeliveries,
            counters: redeliveryCounters
        },
        cross_tenant_rejected: crossTenantCase,
        upstream_unavailable: upstreamCase
    };
    const receipt = {
        schema_version: RECEIPT_SCHEMA_VERSION,
        run_id: RUN_ID,
        mode: 'fixture-only',
        base_sha: base,
        head_sha: head,
        fixture_hash: `sha256:${sha256(canonicalJson(FIXTURE))}`,
        fixture_harness_status: 'success',
        production_executed: false,
        deploy_allowed: false,
        cases,
        counters: {
            same_event_redelivery: redeliveryCounters,
            cross_tenant_rejected: crossTenantCounters,
            upstream_unavailable: upstreamCounters
        },
        external_adapter_calls: readExternalAdapterCallCount(adapters)
    };

    adapters.assertUnused();
    return receipt;
}

function parseArgs(argv) {
    const options = { json: false, baseSha: undefined, headSha: undefined };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--json') {
            options.json = true;
            continue;
        }
        if (argument === '--base-sha' || argument === '--head-sha') {
            const value = argv[index + 1];
            if (!value || value.startsWith('--')) {
                throw new Error(`${argument} requires a value`);
            }
            options[argument === '--base-sha' ? 'baseSha' : 'headSha'] = value;
            index += 1;
            continue;
        }
        throw new Error(`unknown option: ${argument}`);
    }
    if (!options.json) throw new Error('--json is required for machine-readable output');
    return options;
}

function isMainModule() {
    const entrypoint = process.argv[1];
    return entrypoint && fileURLToPath(import.meta.url) === resolve(entrypoint);
}

if (isMainModule()) {
    try {
        const options = parseArgs(process.argv.slice(2));
        const receipt = runT0OfflineNegativeE2E(options);
        process.stdout.write(`${JSON.stringify(receipt)}\n`);
    } catch (error) {
        process.stderr.write(`t0 offline-negative e2e: ${error.message}\n`);
        process.exitCode = 1;
    }
}
