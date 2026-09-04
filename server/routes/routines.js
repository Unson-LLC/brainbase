import { Router } from 'express';

import { asyncHandler } from '../lib/async-handler.js';

const ROUTINES = new Set(['ohayo', 'oyasumi', 'retro']);

function actorFrom(req) {
    return {
        ...(req.auth || {}),
        person_id: req.access?.actorPersonId || req.access?.personId || req.auth?.sub || null,
        projectCodes: Array.isArray(req.access?.projectCodes) ? req.access.projectCodes : [],
        role: req.access?.role || req.auth?.role || null,
        authSource: req.authSource || null,
        authority_resolution_receipt_id: req.access?.authorityResolutionReceiptId || null,
        identity_resolution_receipt_id: req.access?.identityResolutionReceiptId || null
    };
}

export function createRoutineRouter({ routineCycleExecutor }) {
    if (!routineCycleExecutor?.execute) throw new Error('routineCycleExecutor.execute is required');
    const router = Router();
    router.post('/:routine/execute', asyncHandler(async (req, res) => {
        const routine = req.params.routine;
        if (!ROUTINES.has(routine)) {
            res.status(404).json({ error: 'routine_not_found' });
            return;
        }
        const projectId = req.body?.input?.project_id || 'brainbase';
        if (projectId !== 'brainbase') {
            res.status(403).json({ error: 'routine_project_not_supported' });
            return;
        }
        if (!req.access?.projectCodes?.includes(projectId)) {
            res.status(403).json({ error: 'project_not_accessible' });
            return;
        }
        const result = await routineCycleExecutor.execute(
            { routine, input: req.body?.input || {} },
            {
                actor: actorFrom(req),
                access: req.access,
                external_run_id: req.body?.thread_id || null
            }
        );
        res.json(result);
    }));
    return router;
}
