const FAILURE_CODES_BY_STAGE = Object.freeze({
    oauth_exchange: new Set([
        'UPSTREAM_UNAVAILABLE',
        'OAUTH_EXCHANGE_UNAVAILABLE', 'OAUTH_EXCHANGE_INVALID', 'OAUTH_EXCHANGE_REJECTED',
        'OAUTH_CREDENTIAL_MISSING', 'OAUTH_EXCHANGE_FAILED'
    ]),
    exchange_normalize: new Set([
        'UPSTREAM_UNAVAILABLE',
        'WORKSPACE_CONNECTION_INVALID', 'WORKSPACE_CONNECTION_CONFLICT',
        'EXCHANGE_NORMALIZATION_FAILED'
    ]),
    connection_reserve: new Set([
        'INSTALLATION_STATE_INVALID', 'INSTALLATION_BINDING_MISMATCH',
        'INSTALLATION_STATE_REPLAYED', 'INSTALLATION_STATE_EXPIRED',
        'INSTALLATION_CLAIM_STALE', 'INSTALLATION_IN_PROGRESS',
        'WORKSPACE_CONNECTION_STALE_REVISION', 'CONNECTION_RESERVATION_FAILED',
        'TENANT_UNKNOWN', 'CONTRACT_UNAVAILABLE', 'UPSTREAM_UNAVAILABLE'
    ]),
    credential_store: new Set([
        'CREDENTIAL_REF_INVALID', 'CREDENTIAL_STORE_UNAVAILABLE',
        'CREDENTIAL_STORE_INVALID', 'CREDENTIAL_STORE_REJECTED', 'CREDENTIAL_STORE_FAILED',
        'UPSTREAM_UNAVAILABLE'
    ]),
    db_register: new Set([
        'INSTALLATION_CLAIM_STALE', 'WORKSPACE_CONNECTION_STALE_REVISION',
        'TENANT_UNKNOWN', 'CONTRACT_UNAVAILABLE', 'DB_REGISTRATION_FAILED',
        'UPSTREAM_UNAVAILABLE'
    ])
});

const FALLBACK_BY_STAGE = Object.freeze({
    oauth_exchange: 'OAUTH_EXCHANGE_FAILED',
    exchange_normalize: 'EXCHANGE_NORMALIZATION_FAILED',
    connection_reserve: 'CONNECTION_RESERVATION_FAILED',
    credential_store: 'CREDENTIAL_STORE_FAILED',
    db_register: 'DB_REGISTRATION_FAILED'
});

export function normalizeSlackInstallationFailureStage(value) {
    return Object.hasOwn(FAILURE_CODES_BY_STAGE, value) ? value : null;
}

export function normalizeSlackInstallationFailureCode(value, stage) {
    const safeStage = normalizeSlackInstallationFailureStage(stage);
    if (!safeStage) return 'INSTALLATION_EXCHANGE_FAILED';
    const code = String(value ?? '');
    return FAILURE_CODES_BY_STAGE[safeStage].has(code) ? code : FALLBACK_BY_STAGE[safeStage];
}
