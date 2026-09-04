import express from 'express';
import { CompanionController } from '../controllers/companion-controller.js';

function splitCsv(value) {
    return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function actorPersonId(req) {
    return req.access?.personId || req.auth?.person_id || req.auth?.personId || req.auth?.sub || null;
}

function canonicalizeOwnerIdentity(req, ownerPersonId) {
    if (req.access) req.access = { ...req.access, personId: ownerPersonId };
    if (req.auth) {
        req.auth = {
            ...req.auth,
            person_id: ownerPersonId,
            personId: ownerPersonId
        };
    }
}

function isServerToServerOrNativeAuth(req) {
    return ['internal', 'service-token', 'bearer', 'insecure-header'].includes(String(req.authSource || ''));
}

function createCompanionAccessGuard({
    ownerPersonId = process.env.BRAINBASE_PERSONAL_KG_OWNER_PERSON_ID || null,
    ownerAliasIds = splitCsv(process.env.BRAINBASE_PERSONAL_KG_OWNER_ALIAS_IDS)
} = {}) {
    const allowedOwnerIds = new Set([ownerPersonId, ...ownerAliasIds].filter(Boolean));
    return (req, res, next) => {
        if (!isServerToServerOrNativeAuth(req)) {
            res.status(403).json({
                error: 'server_to_server_auth_required',
                code: 'server_to_server_auth_required',
                message: 'companion API requires bearer, service token, or internal API key authentication'
            });
            return;
        }

        if (req.authSource === 'internal' || req.authSource === 'service-token') {
            next();
            return;
        }

        const actorId = actorPersonId(req);
        if (!actorId || !allowedOwnerIds.has(actorId)) {
            res.status(403).json({
                error: 'personal_kg_owner_required',
                code: 'personal_kg_owner_required',
                message: 'companion API requires the configured Personal KG owner or a service credential'
            });
            return;
        }

        next();
    };
}

function createCanonicalTaskAccessGuard({
    ownerPersonId = process.env.BRAINBASE_PERSONAL_KG_OWNER_PERSON_ID || null,
    ownerAliasIds = splitCsv(process.env.BRAINBASE_PERSONAL_KG_OWNER_ALIAS_IDS)
} = {}) {
    const allowedOwnerIds = new Set([ownerPersonId, ...ownerAliasIds].filter(Boolean));
    return (req, res, next) => {
        const source = String(req.authSource || '');
        if (source === 'cookie') {
            res.status(403).json({ code: 'task_bearer_required', message: 'Canonical Task API requires bearer authentication' });
            return;
        }
        if (source === 'insecure-header') {
            res.status(403).json({ code: 'task_owner_identity_required', message: 'Canonical Task API requires an authoritative owner identity' });
            return;
        }
        if (source === 'internal' || source === 'service-token') {
            next();
            return;
        }
        const personId = actorPersonId(req);
        if (source !== 'bearer' || !personId || !allowedOwnerIds.has(personId)) {
            res.status(403).json({ code: 'personal_kg_owner_required', message: 'Canonical Task API requires the configured Personal KG owner' });
            return;
        }
        canonicalizeOwnerIdentity(req, ownerPersonId);
        next();
    };
}

export function createCompanionRouter({
    replyDraftService,
    companionApprovalInboxService,
    infoSSOTService,
    decisionEventService,
    canonicalTaskService,
    authGuard,
    accessGuardOptions
} = {}) {
    if (!replyDraftService) {
        throw new Error('replyDraftService is required');
    }

    const router = express.Router();
    const controller = new CompanionController(replyDraftService, {
        companionApprovalInboxService,
        infoSSOTService,
        decisionEventService,
        canonicalTaskService
    });
    const guards = authGuard ? [authGuard, createCompanionAccessGuard(accessGuardOptions)] : [];
    const taskGuards = authGuard ? [authGuard, createCanonicalTaskAccessGuard(accessGuardOptions)] : [];

    if (canonicalTaskService) {
        router.get('/tasks', ...taskGuards, controller.listTasks);
        router.get('/tasks/search', ...taskGuards, controller.searchTasks);
        router.get('/tasks/:taskId', ...taskGuards, controller.getTask);
        router.post('/tasks', ...taskGuards, controller.createTask);
        router.patch('/tasks/:taskId', ...taskGuards, controller.updateTask);
        router.post('/tasks/:taskId/transitions', ...taskGuards, controller.transitionTask);
        router.delete('/tasks/:taskId', ...taskGuards, controller.deleteTask);
    }

    router.get('/approval-inbox', ...guards, controller.listApprovalInbox);
    router.get('/people', ...guards, controller.listPeople);
    router.post('/people', ...guards, controller.createPerson);
    router.post('/reply-context', ...guards, controller.createReplyContext);
    router.post('/reply-draft', ...guards, controller.createReplyDraft);
    router.post('/decision-events', ...guards, controller.createDecisionEvent);
    router.get('/decision-events', ...guards, controller.listDecisionEvents);

    return router;
}

export { createCompanionAccessGuard, createCanonicalTaskAccessGuard };
