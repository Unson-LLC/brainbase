import { createHash, createPrivateKey, createPublicKey, timingSafeEqual } from 'node:crypto';
import { CredentialBroker } from './credential-broker.js';
import { ContractUsageLedger } from './contract-usage-ledger.js';
import { MultitenantPostgresRepository } from './postgres-repository.js';
import { PostgresContractUsageLedger } from './postgres-contract-usage-ledger.js';
import { TenantContextProducer } from './tenant-context-producer.js';
import { verifyTenantContext } from './tenant-context.js';
import { TenantBoundaryGateway } from './tenant-boundary.js';

function tokenDigest(value) {
    return createHash('sha256').update(String(value), 'utf8').digest();
}

function createServiceAuth(expectedToken) {
    if (!expectedToken) throw new Error('Tenant runtime service token is required');
    const expectedDigest = tokenDigest(expectedToken);
    return (req, res, next) => {
        const authorization = req.get('authorization') ?? '';
        const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
        const valid = timingSafeEqual(expectedDigest, tokenDigest(supplied));
        if (!valid) return res.status(401).json({ code: 'SERVICE_AUTH_REQUIRED' });
        req.serviceIdentity = 'mana-runtime';
        return next();
    };
}

function publicKeyFor(signingKey) {
    if (signingKey.public_key) return signingKey.public_key;
    return createPublicKey(signingKey.private_key);
}

export function createTenantRuntimeServices({
    serviceToken,
    tenantAuthority,
    connectionRegistry,
    credentialBroker = new CredentialBroker(),
    usageLedger = new ContractUsageLedger(),
    tenantBoundaryGateway,
    resolveContractRevision,
    resolveCanonicalContext,
    signingKey,
    audience = 'mana-runtime',
    deploymentId,
    deploymentProfile,
    now = () => new Date()
}) {
    if (!signingKey?.key_id || !signingKey.private_key || !deploymentId || !deploymentProfile) {
        throw new Error('Tenant runtime signing key and deployment identity are required');
    }
    const publicKey = publicKeyFor(signingKey);
    const verificationKeys = () => [{
        key_id: signingKey.key_id,
        algorithm: 'EdDSA',
        public_key_format: 'jwk',
        public_key: publicKey,
        status: signingKey.status ?? 'current',
        not_before: signingKey.not_before ?? null,
        expires_at: signingKey.expires_at ?? null
    }];
    const tenantContextProducer = new TenantContextProducer({
        tenantAuthority,
        connectionRegistry,
        resolveContractRevision,
        resolveCanonicalContext,
        signingKey,
        audience,
        deploymentId,
        deploymentProfile,
        now
    });
    return {
        serviceAuth: createServiceAuth(serviceToken),
        verificationKeys,
        tenantAuthority: tenantContextProducer,
        connectionRegistry,
        credentialBroker,
        usageLedger,
        tenantBoundaryGateway,
        tenantContextVerifier: (envelope) => verifyTenantContext(envelope, {
            keys: verificationKeys(),
            audience,
            deployment_id: deploymentId,
            now: now()
        }),
        now
    };
}

function requiredEnv(env, name) {
    const value = env[name];
    if (!value) throw new Error(`${name} is required when tenant runtime is enabled`);
    return value;
}

export function createTenantRuntimeServicesFromEnv({ env = process.env, pool, now } = {}) {
    if (env.BRAINBASE_TENANT_RUNTIME_ENABLED !== '1') return null;
    if (!pool) throw new Error('Tenant runtime PostgreSQL pool is required');
    const privateJwk = JSON.parse(requiredEnv(env, 'BRAINBASE_TENANT_CONTEXT_SIGNING_KEY_JWK'));
    const privateKey = createPrivateKey({ key: privateJwk, format: 'jwk' });
    const repository = new MultitenantPostgresRepository({ pool, now });
    const usageLedger = new PostgresContractUsageLedger({ repository, now });
    const tenantBoundaryGateway = new TenantBoundaryGateway({
        resolveResource: (input) => repository.resolveOwnedResource(input)
    });
    return createTenantRuntimeServices({
        serviceToken: requiredEnv(env, 'BRAINBASE_TENANT_RUNTIME_SERVICE_TOKEN'),
        connectionRegistry: {
            validateRevision: (input) => repository.validateConnectionRevision(input)
        },
        credentialBroker: new CredentialBroker({
            repository,
            now
        }),
        usageLedger,
        tenantBoundaryGateway,
        resolveCanonicalContext: (input) => repository.resolveRuntimeContext(input),
        signingKey: {
            key_id: requiredEnv(env, 'BRAINBASE_TENANT_CONTEXT_SIGNING_KEY_ID'),
            private_key: privateKey,
            public_key: createPublicKey(privateKey),
            status: 'current',
            not_before: env.BRAINBASE_TENANT_CONTEXT_KEY_NOT_BEFORE ?? null,
            expires_at: env.BRAINBASE_TENANT_CONTEXT_KEY_EXPIRES_AT ?? null
        },
        audience: env.BRAINBASE_TENANT_RUNTIME_AUDIENCE ?? 'mana-runtime',
        deploymentId: requiredEnv(env, 'BRAINBASE_TENANT_RUNTIME_DEPLOYMENT_ID'),
        deploymentProfile: requiredEnv(env, 'BRAINBASE_TENANT_RUNTIME_DEPLOYMENT_PROFILE'),
        now
    });
}
