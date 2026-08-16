import { deepFreeze } from './canonical-json.js';
import { ContractError } from './errors.js';

export const PROTOCOL_ID = 'mana-brainbase-tenant-context';
export const CURRENT_PROTOCOL_VERSION = '1.0';
export const SUPPORTED_PROTOCOL_RANGE = '>=1.0 <2.0';

export const REQUIRED_CAPABILITIES = Object.freeze([
    'signed_tenant_context',
    'connection_revision_recheck',
    'tenant_scoped_authorization',
    'credential_broker_v1',
    'usage_receipt_v1',
    'idempotent_effects_v1'
]);

const OPTIONAL_CAPABILITIES = new Set([
    'cloud_billing_export', 'managed_operations', 'shared_cloud_rls_conformance', 'cloud_standard_credential'
]);

function parseVersion(value) {
    const match = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(value);
    return match ? match.slice(1).map((part) => Number(part ?? 0)) : null;
}

function compareVersion(left, right) {
    for (let index = 0; index < 3; index += 1) {
        if (left[index] !== right[index]) return left[index] - right[index];
    }
    return 0;
}

function supportsV1(range) {
    if (typeof range !== 'string') return false;
    const tokens = range.trim().split(/\s+/);
    if (tokens.length !== 2) return false;
    const constraints = tokens.map((token) => /^(>=|>|<=|<)(\d+\.\d+(?:\.\d+)?)$/.exec(token));
    if (constraints.some((constraint) => !constraint)) return false;
    const version = [1, 0, 0];
    return constraints.every(([, operator, raw]) => {
        const candidate = parseVersion(raw);
        const comparison = compareVersion(version, candidate);
        return operator === '>=' ? comparison >= 0
            : operator === '>' ? comparison > 0
                : operator === '<=' ? comparison <= 0
                    : comparison < 0;
    });
}

export function negotiateProtocol(input, { now = new Date() } = {}) {
    if (!supportsV1(input.supported_range)) {
        throw new ContractError('PROTOCOL_VERSION_UNSUPPORTED', { status: 409, fault_domain: 'protocol' });
    }
    const unsupported = (input.required_capabilities ?? []).filter((capability) => !REQUIRED_CAPABILITIES.includes(capability));
    if (unsupported.length > 0) {
        throw new ContractError('PROTOCOL_CAPABILITY_UNSUPPORTED', { status: 409, fault_domain: 'protocol', details: { capabilities: unsupported } });
    }
    if (!['shared_cloud', 'dedicated_cloud', 'customer_managed_oss'].includes(input.deployment_profile)) {
        throw new ContractError('PROTOCOL_CAPABILITY_UNSUPPORTED', { status: 409, fault_domain: 'protocol' });
    }
    const optional = {};
    for (const capability of input.optional_capabilities ?? []) {
        if (!OPTIONAL_CAPABILITIES.has(capability)) {
            optional[capability] = { status: 'non_applicable', reason: 'capability_not_advertised_by_brainbase_v1' };
        } else if (input.deployment_profile === 'customer_managed_oss') {
            optional[capability] = { status: 'non_applicable', reason: 'cloud_only_optional_capability' };
        } else {
            optional[capability] = { status: 'available' };
        }
    }
    return deepFreeze({
        protocol_id: PROTOCOL_ID,
        selected_version: CURRENT_PROTOCOL_VERSION,
        supported_range: SUPPORTED_PROTOCOL_RANGE,
        compatibility_until: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        required_capabilities: [...REQUIRED_CAPABILITIES],
        optional_capabilities: optional,
        deployment_id: input.deployment_id,
        deployment_profile: input.deployment_profile
    });
}

export function faultDomainForCode(code) {
    if (code.startsWith('PROTOCOL_') || code.startsWith('TENANT_CONTEXT_')) return 'protocol';
    if (code === 'WORKSPACE_CONNECTION_UNAVAILABLE' || code === 'UPSTREAM_UNAVAILABLE') return 'brainbase_cloud';
    if (code === 'TIMEOUT' || code === 'RETRY_EXHAUSTED') return 'mana_runtime';
    return 'customer_environment';
}

export function toProblem(error, correlationId = null) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    return {
        type: `https://brainbase.example/problems/${String(error.code ?? 'INTERNAL_ERROR').toLowerCase().replaceAll('_', '-')}`,
        status,
        code: error.code ?? 'INTERNAL_ERROR',
        title: '要求を処理できません',
        retryable: error.retryable ?? false,
        fault_domain: error.fault_domain ?? faultDomainForCode(error.code ?? ''),
        correlation_id: correlationId,
        details: error.details ?? { required_action: 'none' }
    };
}
