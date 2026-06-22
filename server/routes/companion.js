import express from 'express';
import { CompanionController } from '../controllers/companion-controller.js';

const DEFAULT_OWNER_PERSON_ID = 'sato_keigo';

function splitCsv(value) {
    return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function actorPersonId(req) {
    return req.access?.personId || req.auth?.person_id || req.auth?.personId || req.auth?.sub || null;
}

function isServerToServerOrNativeAuth(req) {
    return ['internal', 'service-token', 'bearer', 'insecure-header'].includes(String(req.authSource || ''));
}

function createCompanionAccessGuard({
    ownerPersonId = process.env.BRAINBASE_PERSONAL_KG_OWNER_PERSON_ID || DEFAULT_OWNER_PERSON_ID,
    ownerAliasIds = splitCsv(process.env.BRAINBASE_PERSONAL_KG_OWNER_ALIAS_IDS)
} = {}) {
    const allowedOwnerIds = new Set([ownerPersonId, ...ownerAliasIds].filter(Boolean));
    return (req, res, next) => {
        if (!isServerToServerOrNativeAuth(req)) {
            res.status(403).json({
                error: 'server_to_server_auth_required',
                code: 'server_to_server_auth_required',
                message: 'companion reply draft requires bearer, service token, or internal API key authentication'
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
                message: 'companion reply draft requires the configured Personal KG owner or a service credential'
            });
            return;
        }

        next();
    };
}

export function createCompanionRouter({ replyDraftService, authGuard, accessGuardOptions } = {}) {
    if (!replyDraftService) {
        throw new Error('replyDraftService is required');
    }

    const router = express.Router();
    const controller = new CompanionController(replyDraftService);
    const guards = authGuard ? [authGuard, createCompanionAccessGuard(accessGuardOptions)] : [];

    router.post('/reply-draft', ...guards, controller.createReplyDraft);

    return router;
}

export { createCompanionAccessGuard };
