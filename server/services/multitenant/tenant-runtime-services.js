import { createHash, createPrivateKey, createPublicKey, timingSafeEqual } from 'node:crypto';
import { CompanyAuthorityResolver } from './company-authority-resolver.js';
import { CredentialBroker } from './credential-broker.js';
import { ContractUsageLedger } from './contract-usage-ledger.js';
import { PostgresCompanyAuthorityRepository } from './postgres-company-authority-repository.js';
import { MultitenantPostgresRepository } from './postgres-repository.js';
import { PostgresContractUsageLedger } from './postgres-contract-usage-ledger.js';
import { TenantContextProducer } from './tenant-context-producer.js';
import { verifyTenantContext } from './tenant-context.js';
import { TenantBoundaryGateway } from './tenant-boundary.js';
import { MigrationPlanAttestor } from './migration-plan-attestor.js';
import { PostgresTenantMigrationAdapter } from './postgres-migration-adapter.js';
import {
    createEnvCredentialMaterializer,
    createTrustedProviderForwardersFromEnv
} from './trusted-provider-forwarder.js';
import {
    createRemoteCredentialMaterializer,
    isRemoteCredentialStoreConfigured
} from './remote-credential-store.js';
import {
    createJwtServiceTokenVerifier,
    createServiceAuthMiddleware
} from './service-auth.js';

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
        req.serviceIdentity = {
            subject: 'mana-runtime',
            capabilities: [
                'tenant_context:resolve',
                'tenant_migration:apply',
                'tenant_migration:rollback'
            ]
        };
        return next();
    };
}

function publicKeyFor(signingKey) {
    if (signingKey.public_key) return signingKey.public_key;
    return createPublicKey(signingKey.private_key);
}

export function createTenantRuntimeServices({
    serviceToken,
    serviceAuth,
    tenantAuthority,
    connectionRegistry,
    credentialBroker = new CredentialBroker(),
    usageLedger = new ContractUsageLedger(),
    tenantBoundaryGateway,
    migrationAdapter,
    resolveContractRevision,
    resolveCanonicalContext,
    companyAuthorityResolver,
    allowTestAuthorityFallback = process.env.NODE_ENV === 'test',
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
        companyAuthorityResolver,
        allowTestAuthorityFallback,
        signingKey,
        audience,
        deploymentId,
        deploymentProfile,
        now
    });
    return {
        serviceAuth: serviceAuth ?? createServiceAuth(serviceToken),
        verificationKeys,
        tenantAuthority: tenantContextProducer,
        connectionRegistry,
        credentialBroker,
        usageLedger,
        tenantBoundaryGateway,
        migrationAdapter,
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

export function createTenantRuntimeServicesFromEnv({
    env = process.env,
    pool,
    now,
    credentialMaterializer,
    providerForwarders = {}
} = {}) {
    if (env.BRAINBASE_TENANT_RUNTIME_ENABLED !== '1') return null;
    if (!pool) throw new Error('Tenant runtime PostgreSQL pool is required');
    const privateJwk = JSON.parse(requiredEnv(env, 'BRAINBASE_TENANT_CONTEXT_SIGNING_KEY_JWK'));
    const privateKey = createPrivateKey({ key: privateJwk, format: 'jwk' });
    const signingKey = {
        key_id: requiredEnv(env, 'BRAINBASE_TENANT_CONTEXT_SIGNING_KEY_ID'),
        private_key: privateKey,
        public_key: createPublicKey(privateKey),
        status: 'current',
        not_before: env.BRAINBASE_TENANT_CONTEXT_KEY_NOT_BEFORE ?? null,
        expires_at: env.BRAINBASE_TENANT_CONTEXT_KEY_EXPIRES_AT ?? null
    };
    const repository = new MultitenantPostgresRepository({ pool, now });
    const companyAuthorityResolver = new CompanyAuthorityResolver({
        repository: new PostgresCompanyAuthorityRepository({ pool, now })
    });
    const resolvedCredentialMaterializer = credentialMaterializer
        ?? (isRemoteCredentialStoreConfigured(env)
            ? createRemoteCredentialMaterializer({ env })
            : createEnvCredentialMaterializer({ env }));
    const resolvedProviderForwarders = Object.keys(providerForwarders).length > 0
        ? providerForwarders
        : createTrustedProviderForwardersFromEnv({ env });
    const usageLedger = new PostgresContractUsageLedger({ repository, now });
    const deploymentId = requiredEnv(env, 'BRAINBASE_TENANT_RUNTIME_DEPLOYMENT_ID');
    const runtimeAudience = env.BRAINBASE_TENANT_RUNTIME_AUDIENCE ?? 'mana-runtime';
    const serviceAudience = env.BRAINBASE_TENANT_RUNTIME_SERVICE_AUDIENCE ?? runtimeAudience;
    const requiredCapabilities = (env.BRAINBASE_TENANT_RUNTIME_REQUIRED_CAPABILITIES ?? 'tenant_context:resolve')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    const expectedServiceToken = requiredEnv(env, 'BRAINBASE_TENANT_RUNTIME_SERVICE_TOKEN');
    const serviceAuth = createServiceAuthMiddleware({
        verifyToken: createJwtServiceTokenVerifier({
            secret: requiredEnv(env, 'BRAINBASE_SERVICE_TOKEN_SECRET'),
            expectedToken: expectedServiceToken
        }),
        issuer: env.BRAINBASE_TENANT_RUNTIME_SERVICE_ISSUER ?? 'brainbase',
        audience: serviceAudience,
        deploymentId,
        requiredCapabilities,
        now
    });
    const tenantBoundaryGateway = new TenantBoundaryGateway({
        resolveResource: (input) => repository.resolveOwnedResource(input)
    });
    const migrationAttestor = new MigrationPlanAttestor(signingKey);
    return createTenantRuntimeServices({
        serviceAuth,
        connectionRegistry: {
            validateRevision: (input) => repository.validateConnectionRevision(input)
        },
        credentialBroker: new CredentialBroker({
            repository,
            now,
            credentialMaterializer: resolvedCredentialMaterializer,
            providerForwarders: resolvedProviderForwarders
        }),
        usageLedger,
        tenantBoundaryGateway,
        migrationAdapter: new PostgresTenantMigrationAdapter({ pool, now, attestor: migrationAttestor }),
        resolveCanonicalContext: (input) => repository.resolveRuntimeContext(input),
        companyAuthorityResolver,
        allowTestAuthorityFallback: false,
        signingKey,
        audience: runtimeAudience,
        deploymentId,
        deploymentProfile: requiredEnv(env, 'BRAINBASE_TENANT_RUNTIME_DEPLOYMENT_PROFILE'),
        now
    });
}
