// @ts-check

import { Router } from 'express';
import { ExternalRunnerContractError } from '../services/external-runner/contract-schema.js';

function normalizeProjectCode(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function canAccessProject(req, projectId) {
    if (!projectId) return true;
    if (req.authSource === 'internal' || req.auth?.sub === 'internal_api' || req.access?.personId === 'internal_api') return true;
    if (['admin', 'ceo'].includes(String(req.access?.role || req.auth?.role || '').toLowerCase())) return true;
    const requested = normalizeProjectCode(projectId);
    const projectCodes = Array.isArray(req.access?.projectCodes) ? req.access.projectCodes : [];
    return projectCodes.some((code) => normalizeProjectCode(code) === requested);
}

function isServerToServerAuth(req) {
    return ['internal', 'service-token', 'bearer', 'insecure-header'].includes(String(req.authSource || ''));
}

function actorPersonId(req) {
    return req.access?.personId || req.auth?.person_id || req.auth?.sub || null;
}

function canDelegateOwnership(req, payload) {
    if (req.authSource === 'internal' || req.authSource === 'service-token') return true;
    if (!payload || typeof payload !== 'object') return true;

    const actorId = actorPersonId(req);
    if (!actorId) return false;

    const loopControl = payload.loop_control;
    const delegatedIds = [
        loopControl?.owner_id,
        loopControl?.cost_owner_id,
        loopControl?.approval_owner_id,
        ...(Array.isArray(payload.human_steps)
            ? payload.human_steps.map((step) => step?.required_by)
            : []),
        ...(Array.isArray(payload.learning_candidates)
            ? payload.learning_candidates.flatMap((candidate) => [
                candidate?.owner_person_id,
                candidate?.actor_person_id,
                candidate?.recommended_owner_person_id
            ])
            : [])
    ].filter((value) => typeof value === 'string' && value.trim() !== '');

    return delegatedIds.every((value) => value === actorId);
}

function normalizeNonServiceActorDefaults(req, payload) {
    if (req.authSource === 'internal' || req.authSource === 'service-token') return payload;
    if (!payload || typeof payload !== 'object') return payload;
    if (!Array.isArray(payload.learning_candidates)) return payload;

    const actorId = actorPersonId(req);
    if (!actorId) return payload;

    let changed = false;
    const learningCandidates = payload.learning_candidates.map((candidate) => {
        if (!candidate || typeof candidate !== 'object' || candidate.actor_person_id) return candidate;
        changed = true;
        return {
            ...candidate,
            actor_person_id: actorId
        };
    });
    if (!changed) return payload;

    return {
        ...payload,
        learning_candidates: learningCandidates
    };
}

export function createExternalRunnerRouter(ingestService) {
    const router = Router();

    router.post('/ingest', async (req, res, next) => {
        try {
            if (!isServerToServerAuth(req)) {
                res.status(403).json({
                    error: 'server_to_server_auth_required',
                    message: 'external runner ingest requires bearer, service token, or internal API key authentication'
                });
                return;
            }
            const projectId = req.body?.run?.project_id;
            if (!canAccessProject(req, projectId)) {
                res.status(403).json({
                    error: 'project_not_accessible',
                    message: `project '${projectId}' is not accessible`
                });
                return;
            }
            if (!canDelegateOwnership(req, req.body)) {
                res.status(403).json({
                    error: 'loop_control_delegation_not_allowed',
                    message: 'non-service external runner credentials cannot delegate owner, cost owner, approval owner, human step approver, or learning candidate owner to another actor'
                });
                return;
            }
            const result = await ingestService.ingest(normalizeNonServiceActorDefaults(req, req.body));
            res.status(result.status === 'duplicate' ? 200 : 201).json(result);
        } catch (error) {
            if (error instanceof ExternalRunnerContractError) {
                res.status(400).json({
                    error: error.message,
                    code: error.code,
                    details: error.details
                });
                return;
            }
            next(error);
        }
    });

    return router;
}
