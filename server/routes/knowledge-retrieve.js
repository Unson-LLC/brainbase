import { Router } from 'express';
import { KnowledgeCatalogError } from '../services/knowledge-catalog-service.js';
import {
    KNOWLEDGE_RETRIEVE_CAPABILITY,
    createKnowledgeRetrieveServiceAuthMiddleware
} from '../middleware/knowledge-retrieve-service-auth.js';

export const KNOWLEDGE_RETRIEVE_REQUEST_CONTRACT = Object.freeze({
    method: 'POST',
    path: '/api/knowledge/retrieve',
    required: ['project_code', 'refs', 'outcome_contract_id', 'run_id'],
    properties: Object.freeze({
        project_code: Object.freeze({ type: 'string', minLength: 1 }),
        refs: Object.freeze({
            type: 'array',
            minItems: 1,
            maxItems: 50,
            items: Object.freeze({
                type: 'object',
                required: ['id', 'version'],
                properties: Object.freeze({ id: 'string', version: 'string' })
            })
        }),
        outcome_contract_id: Object.freeze({ type: 'string', minLength: 1 }),
        run_id: Object.freeze({ type: 'string', minLength: 1 })
    }),
    capability: KNOWLEDGE_RETRIEVE_CAPABILITY
});

export const KNOWLEDGE_RETRIEVE_RESPONSE_CONTRACT = Object.freeze({
    type: 'object',
    required: ['project_code', 'results'],
    properties: Object.freeze({
        project_code: Object.freeze({ type: 'string' }),
        results: Object.freeze({ type: 'array' })
    })
});

function catalogRoute(handler) {
    return async (req, res) => {
        try {
            res.json(await handler(req, res));
        } catch (error) {
            const known = error instanceof KnowledgeCatalogError;
            const repositoryError = typeof error?.code === 'string'
                && error.code.startsWith('knowledge_')
                && Number.isInteger(error?.status);
            res.status(known || repositoryError ? error.status : 500).json({
                error: {
                    code: known || repositoryError ? error.code : 'knowledge_catalog_failed',
                    message: known || repositoryError ? error.message : 'Knowledge catalog request failed',
                    ...(error?.details && Object.keys(error.details).length ? { details: error.details } : {})
                }
            });
        }
    };
}

/**
 * Dedicated retrieve-only router. It is mounted before the general catalog
 * router so that the latter cannot service this endpoint with an internal key,
 * insecure headers, a user session, or token self-claims.
 */
export function createKnowledgeRetrieveRouter({
    service,
    serviceAuthMiddleware = createKnowledgeRetrieveServiceAuthMiddleware()
}) {
    const router = Router();
    router.post('/retrieve', serviceAuthMiddleware, catalogRoute((req) => service.retrieve(req.access, req.body || {})));
    return router;
}
