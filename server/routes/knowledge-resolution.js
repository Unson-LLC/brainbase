import { Router } from 'express';

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
