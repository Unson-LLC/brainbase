import { deepFreeze } from './canonical-json.js';
import { validateCanonicalWire } from './canonical-wire-validator.js';
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
    'idempotent_effects_v1',
    'container_sanitization_v1'
]);

const OPTIONAL_CAPABILITIES = new Set([
    'cloud_billing_export', 'managed_operations', 'shared_cloud_rls_conformance', 'cloud_standard_credential'
]);

const COMPATIBILITY_UNTIL = '2027-08-16T00:00:00Z';

function optionalCapability(capability, deploymentProfile) {
    if (deploymentProfile === 'customer_managed_oss') {
        const reasons = {
            cloud_billing_export: 'Brainbase Cloud billing export is not present in a customer-managed deployment.',
            managed_operations: 'Deployment operations are customer-owned.',
            shared_cloud_rls_conformance: 'The deployment is not a shared Cloud database.'
        };
        return {
            capability,
            status: 'non_applicable',
            reason: reasons[capability] ?? 'The optional Cloud capability is not present in a customer-managed deployment.'
        };
    }
    return { capability, status: OPTIONAL_CAPABILITIES.has(capability) ? 'supported' : 'non_applicable',
        ...(OPTIONAL_CAPABILITIES.has(capability) ? {} : { reason: 'capability_not_advertised_by_brainbase_v1' }) };
}

export function negotiateProtocol(input) {
    if (input?.message_type !== 'protocol_negotiation_request' || input.protocol_id !== PROTOCOL_ID
        || input.supported_range !== SUPPORTED_PROTOCOL_RANGE || !Array.isArray(input.supported_versions)
        || !input.supported_versions.includes(CURRENT_PROTOCOL_VERSION)) {
        throw new ContractError('PROTOCOL_VERSION_UNSUPPORTED', { status: 409, fault_domain: 'protocol' });
    }
    if (!Array.isArray(input.required_capabilities)) {
        throw new ContractError('PROTOCOL_CAPABILITY_UNSUPPORTED', { status: 409, fault_domain: 'protocol' });
    }
    const unsupported = input.required_capabilities.filter((capability) => !REQUIRED_CAPABILITIES.includes(capability));
    const missing = REQUIRED_CAPABILITIES.filter((capability) => !input.required_capabilities.includes(capability));
    if (unsupported.length > 0 || missing.length > 0) {
        throw new ContractError('PROTOCOL_CAPABILITY_UNSUPPORTED', {
            status: 409,
            fault_domain: 'protocol',
            details: { capabilities: [...unsupported, ...missing] }
        });
    }
    if (!['shared_cloud', 'dedicated_cloud', 'customer_managed_oss'].includes(input.deployment_profile)) {
        throw new ContractError('PROTOCOL_CAPABILITY_UNSUPPORTED', { status: 409, fault_domain: 'protocol' });
    }
    validateCanonicalWire('ProtocolNegotiationRequest', input);
    const response = {
        message_type: 'protocol_negotiation_response',
        protocol_id: PROTOCOL_ID,
        selected_version: CURRENT_PROTOCOL_VERSION,
        supported_range: SUPPORTED_PROTOCOL_RANGE,
        supported_versions: [CURRENT_PROTOCOL_VERSION],
        required_capabilities: [...REQUIRED_CAPABILITIES],
        optional_capabilities: (input.optional_capabilities ?? [])
            .map((capability) => optionalCapability(capability, input.deployment_profile)),
        compatibility_until: COMPATIBILITY_UNTIL
    };
    validateCanonicalWire('ProtocolNegotiationResponse', response);
    return deepFreeze(response);
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
