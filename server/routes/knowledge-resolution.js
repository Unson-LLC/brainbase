import { Router } from 'express';
import { KnowledgeCatalogError } from '../services/knowledge-catalog-service.js';
import { KnowledgeAuthoringError } from '../services/knowledge-authoring-service.js';

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
            const known = error instanceof KnowledgeCatalogError || error instanceof KnowledgeAuthoringError;
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

export function createKnowledgeCatalogRouter({ service, authoringService = null }) {
    const router = Router();
    router.get('/items', catalogRoute((req) => service.list(req.access, req.query)));
    router.get('/items/:id', catalogRoute((req) => service.get(req.access, {
        ...req.query,
        id: req.params.id
    })));
    router.post('/retrieve', catalogRoute((req) => service.retrieve(req.access, req.body || {})));
    router.post('/capture/proposal', catalogRoute((req) => service.captureProposal(req.access, req.body || {})));
    router.post('/preview', catalogRoute((req) => service.preview(req.access, req.body || {})));
    if (authoringService) {
        router.get('/authority-domains', catalogRoute((req) => authoringService.authorityDomains(req.access, req.query)));
        router.post('/drafts', catalogRoute((req) => authoringService.createDraft(req.access, req.body || {})));
        router.get('/drafts/:draftId', catalogRoute((req) => authoringService.getDraft(req.access, {
            ...req.query, draft_id: req.params.draftId
        })));
        router.patch('/drafts/:draftId', catalogRoute((req) => authoringService.updateDraft(req.access, {
            ...(req.body || {}), draft_id: req.params.draftId
        })));
        router.post('/drafts/:draftId/discard', catalogRoute((req) => authoringService.discardDraft(req.access, {
            ...(req.body || {}), draft_id: req.params.draftId
        })));
        router.post('/drafts/:draftId/save', catalogRoute((req) => authoringService.saveDraft(req.access, {
            ...(req.body || {}), draft_id: req.params.draftId
        })));
        router.post('/items/:id/lifecycle', catalogRoute((req) => authoringService.changeLifecycle(req.access, {
            ...(req.body || {}), id: req.params.id
        })));
        router.post('/items/:id/revisions', catalogRoute((req) => authoringService.revise(req.access, {
            ...(req.body || {}), id: req.params.id
        })));
        router.post('/items/:id/supersessions', catalogRoute((req) => authoringService.supersede(req.access, {
            ...(req.body || {}), id: req.params.id
        })));
        router.get('/items/:id/history', catalogRoute((req) => authoringService.history(req.access, {
            ...req.query, id: req.params.id
        })));
    }
    return router;
}
