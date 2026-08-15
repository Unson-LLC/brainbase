// @ts-check

import { Router } from 'express';

import { asyncHandler } from '../lib/async-handler.js';
import { MeetingMinutesContextReceiptError } from '../services/meeting-minutes/context-receipt-service.js';

function isServerToServer(req) {
    return ['internal', 'service-token'].includes(String(req.authSource || ''))
        || req.auth?.sub === 'internal_api'
        || req.access?.personId === 'internal_api';
}

function actorFromRequest(req) {
    return {
        ...(req.auth || {}),
        person_id: req.access?.personId || req.auth?.person_id || req.auth?.sub || null,
        projectCodes: Array.isArray(req.access?.projectCodes) ? req.access.projectCodes : [],
        role: req.access?.role || req.auth?.role || null,
        authType: req.authSource === 'internal' ? 'internal_api' : req.authSource
    };
}

function identityFromQuery(query = {}) {
    return {
        run_id: query.run_id || query.runId,
        project_code: query.project_code || query.projectCode,
        transcript_sha256: query.transcript_sha256 || query.transcriptSha256
    };
}

function sendError(error, res) {
    if (error instanceof MeetingMinutesContextReceiptError || error?.code?.startsWith?.('meeting_minutes_context_') || error?.code === 'project_not_accessible') {
        res.status(error.statusCode || 400).json({
            error: error.code,
            message: error.message,
            ...(error.details && Object.keys(error.details).length ? { details: error.details } : {})
        });
        return true;
    }
    return false;
}

export function createMeetingMinutesContextReceiptRouter({ service }) {
    const router = Router();
    router.use((req, res, next) => {
        if (!isServerToServer(req)) {
            res.status(403).json({
                error: 'server_to_server_auth_required',
                message: 'meeting minutes context receipts require service token or internal API authentication'
            });
            return;
        }
        next();
    });

    router.post('/', asyncHandler(async (req, res) => {
        try {
            res.status(201).json(await service.create(req.body, actorFromRequest(req)));
        } catch (error) {
            if (!sendError(error, res)) throw error;
        }
    }));

    router.get('/:receiptId', asyncHandler(async (req, res) => {
        try {
            res.json(await service.get(
                req.params.receiptId,
                identityFromQuery(req.query),
                actorFromRequest(req)
            ));
        } catch (error) {
            if (!sendError(error, res)) throw error;
        }
    }));

    return router;
}
