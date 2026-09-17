import { Router } from 'express';
import { KnowledgeCatalogError } from '../services/knowledge-catalog-service.js';

function route(handler) {
    return async (req, res) => {
        try {
            await handler(req, res);
        } catch (error) {
            const invalid = error instanceof TypeError;
            res.status(invalid ? 400 : 500).json({
                error: {
                    code: invalid ? 'knowledge_resolution_input_invalid' : 'knowledge_resolution_failed',
                    message: error instanceof Error ? error.message : String(error)
                }
            });
        }
    };
}

export function createKnowledgeResolutionRouter({ service }) {
    const router = Router();
    router.post('/resolve', route(async (req, res) => {
        const projectCode = req.body?.project_code;
        const allowedProjects = Array.isArray(req.access?.projectCodes) ? req.access.projectCodes : [];
        if (projectCode && !allowedProjects.includes(projectCode)) {
            res.status(403).json({
                error: {
                    code: 'knowledge_resolution_project_not_accessible',
                    message: `project '${projectCode}' is not accessible`
                }
            });
            return;
        }
        res.json(service.resolve(req.body));
    }));
    return router;
}

function catalogRoute(handler) {
    return async (req, res) => {
        try {
            res.json(await handler(req, res));
        } catch (error) {
            const known = error instanceof KnowledgeCatalogError;
            res.status(known ? error.status : 500).json({
                error: {
                    code: known ? error.code : 'knowledge_catalog_failed',
                    message: known ? error.message : 'Knowledge catalog request failed',
                }
            });
        }
    };
}

export function createKnowledgeCatalogRouter({ service }) {
    const router = Router();
    router.get('/items', catalogRoute((req) => service.list(req.access, req.query)));
    router.get('/items/:id', catalogRoute((req) => service.get(req.access, {
        ...req.query,
        id: req.params.id
    })));
    router.post('/retrieve', catalogRoute((req) => service.retrieve(req.access, req.body || {})));
    router.post('/preview', catalogRoute((req) => service.preview(req.access, req.body || {})));
    return router;
}
