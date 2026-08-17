import express from 'express';

import { createTenantRuntimeRouter } from '../routes/tenant-runtime.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

function assertPort(port, { allowEphemeral = false } = {}) {
    if (!Number.isInteger(port)
        || port < (allowEphemeral ? 0 : 1)
        || port > 65535) {
        throw new Error('BRAINBASE_TENANT_RUNTIME_PORT must be an integer between 1 and 65535');
    }
}

export function createTenantRuntimeInternalApp(services) {
    if (!services?.serviceAuth || !services?.tenantContextVerifier) {
        throw new Error('Tenant runtime internal service dependencies are required');
    }
    const app = express();
    app.disable('x-powered-by');
    app.use(express.json({ limit: '256kb' }));
    app.use('/api/v1/runtime', createTenantRuntimeRouter(services));
    return app;
}

export async function startTenantRuntimeInternalServer({
    services,
    host = '127.0.0.1',
    port,
    allowNonLoopback = false,
    log = console
}) {
    assertPort(port, { allowEphemeral: true });
    if (!LOOPBACK_HOSTS.has(host) && !allowNonLoopback) {
        throw new Error('Tenant runtime non-loopback binding requires an explicit private-network opt-in');
    }
    const app = createTenantRuntimeInternalApp(services);
    const server = await new Promise((resolve, reject) => {
        const candidate = app.listen(port, host);
        candidate.once('listening', () => resolve(candidate));
        candidate.once('error', reject);
    });
    const address = server.address();
    const boundPort = typeof address === 'object' && address ? address.port : port;
    log.log(`[tenant-runtime] internal service listening on ${host}:${boundPort}`);
    return server;
}

export async function startTenantRuntimeInternalServerFromEnv({
    services,
    env = process.env,
    log = console
} = {}) {
    if (env.BRAINBASE_TENANT_RUNTIME_ENABLED !== '1') return null;
    if (!services) throw new Error('Tenant runtime services are required when tenant runtime is enabled');
    const portValue = env.BRAINBASE_TENANT_RUNTIME_PORT;
    if (!portValue) throw new Error('BRAINBASE_TENANT_RUNTIME_PORT is required when tenant runtime is enabled');
    const port = Number(portValue);
    assertPort(port);
    return startTenantRuntimeInternalServer({
        services,
        host: env.BRAINBASE_TENANT_RUNTIME_HOST ?? '127.0.0.1',
        port,
        allowNonLoopback: env.BRAINBASE_TENANT_RUNTIME_ALLOW_NON_LOOPBACK === '1',
        log
    });
}
