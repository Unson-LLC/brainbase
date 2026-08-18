import { ContractError } from '../services/multitenant/errors.js';
import { toProblem } from '../services/multitenant/protocol-contract.js';

function decodeJsonHeader(req, name, errorCode) {
    const value = req.get(name);
    if (!value || value.length > 32_768) {
        throw new ContractError(errorCode, { status: 400, fault_domain: 'protocol' });
    }
    try {
        const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
        if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('invalid object');
        return decoded;
    } catch {
        throw new ContractError(errorCode, { status: 400, fault_domain: 'protocol' });
    }
}

export function createTenantEntrypointGuard(services, entryPoint) {
    if (typeof services?.tenantContextVerifier !== 'function'
        || typeof services?.tenantBoundaryGateway?.authorize !== 'function') {
        throw new Error('Tenant entrypoint guard requires context verification and boundary authorization');
    }
    const serviceIdentity = `brainbase-${entryPoint.replaceAll('_', '-')}`;
    return async (req, res, next) => {
        let context;
        try {
            const envelope = decodeJsonHeader(req, 'Brainbase-Tenant-Context', 'TENANT_CONTEXT_INVALID');
            const resourceRef = decodeJsonHeader(req, 'Brainbase-Resource-Ref', 'TENANT_BOUNDARY_INVALID');
            context = await services.tenantContextVerifier(envelope, { service_identity: serviceIdentity });
            req.tenantContext = context;
            req.tenantAuthorization = await services.tenantBoundaryGateway.authorize({
                tenant_context: context,
                entry_point: entryPoint,
                resource_ref: resourceRef
            });
            next();
        } catch (error) {
            const problem = toProblem(error, context?.correlation_id ?? null);
            res.status(problem.status).type('application/problem+json').json(problem);
        }
    };
}

export function createUnavailableTenantEntrypointGuard() {
    return (_req, res) => {
        const problem = toProblem(new ContractError('UPSTREAM_UNAVAILABLE', {
            status: 503,
            retryable: true,
            fault_domain: 'brainbase_cloud'
        }), null);
        res.status(problem.status).type('application/problem+json').json(problem);
    };
}
