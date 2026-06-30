import { logger } from '../utils/logger.js';
import { ReplyDraftServiceError } from '../services/companion/reply-draft-service.js';

function serializeError(error) {
    if (error instanceof ReplyDraftServiceError) {
        return {
            status: error.status || 500,
            body: {
                error: error.message,
                code: error.code || 'reply_draft_error',
                details: error.details || {}
            }
        };
    }
    return {
        status: 500,
        body: {
            error: 'Failed to create reply draft',
            code: 'reply_draft_error'
        }
    };
}

function actorAccess(req) {
    const access = req.access || {};
    const auth = req.auth || {};
    const role = String(access.role || auth.role || '').toLowerCase();
    return {
        role: ['member', 'gm', 'ceo'].includes(role) ? role : 'ceo',
        projectCodes: Array.isArray(access.projectCodes) && access.projectCodes.length
            ? access.projectCodes
            : ['brainbase'],
        clearance: Array.isArray(access.clearance) && access.clearance.length
            ? access.clearance
            : ['internal'],
        personId: access.personId || auth.person_id || auth.personId || auth.sub || null
    };
}

function firstString(...values) {
    return values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
}

function stringList(value) {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item) => typeof item === 'string' && item.trim())
        .map((item) => item.trim());
}

function isSpeakerLabel(name) {
    return /^speaker\s*\d+$/i.test(String(name || '').trim());
}

function normalizeSearchText(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function matchesPersonQuery(person, query) {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) return true;
    return [
        person.display_name,
        person.name,
        person.email,
        person.org,
        person.role,
        ...(Array.isArray(person.aliases) ? person.aliases : [])
    ].some((value) => normalizeSearchText(value).includes(normalizedQuery));
}

function normalizePerson(record) {
    const payload = record?.payload && typeof record.payload === 'object' ? record.payload : {};
    const id = firstString(record?.id, record?.entity_id, record?.entityId, payload.id, payload.person_id, payload.personId);
    const displayName = firstString(payload.display_name, payload.displayName, payload.name, record?.display_name, record?.name);
    if (!id || !displayName || isSpeakerLabel(displayName)) return null;
    return {
        id,
        entity_id: id,
        person_id: firstString(payload.person_id, payload.personId, id),
        display_name: displayName,
        name: displayName,
        aliases: stringList(payload.aliases),
        email: firstString(payload.email),
        org: firstString(payload.org, payload.organization, payload.company),
        role: firstString(payload.role, payload.title),
        status: firstString(payload.status, 'active'),
        source: 'graph_ssot'
    };
}

export class CompanionController {
    constructor(replyDraftService, { workflowService = null, infoSSOTService = null } = {}) {
        this.replyDraftService = replyDraftService;
        this.workflowService = workflowService;
        this.infoSSOTService = infoSSOTService;
    }

    createReplyDraft = async (req, res) => {
        try {
            const result = await this.replyDraftService.createDraft(req.body || {}, {
                access: req.access || null,
                auth: req.auth || null,
                authSource: req.authSource || null
            });
            res.json(result);
        } catch (error) {
            logger.error('Failed to create companion reply draft', { error });
            const serialized = serializeError(error);
            res.status(serialized.status).json(serialized.body);
        }
    };

    createReplyContext = async (req, res) => {
        try {
            const result = await this.replyDraftService.createContext(req.body || {}, {
                access: req.access || null,
                auth: req.auth || null,
                authSource: req.authSource || null
            });
            res.json(result);
        } catch (error) {
            logger.error('Failed to create companion reply context', { error });
            const serialized = serializeError(error);
            res.status(serialized.status).json(serialized.body);
        }
    };

    listApprovalInbox = async (req, res) => {
        if (!this.workflowService?.listCompanionApprovalInbox) {
            res.status(503).json({
                error: 'Workflow service is not configured',
                code: 'workflow_service_unconfigured'
            });
            return;
        }
        const actor = {
            ...(req.auth || {}),
            person_id: req.access?.personId || req.auth?.person_id || req.auth?.sub || null,
            projectCodes: Array.isArray(req.access?.projectCodes) ? req.access.projectCodes : [],
            role: req.access?.role || req.auth?.role || null,
            authSource: req.authSource || null
        };
        const projectId = req.query.project_id || req.query.projectId || null;
        const limit = Number.parseInt(String(req.query.limit || '100'), 10);
        try {
            const result = await this.workflowService.listCompanionApprovalInbox({
                projectId,
                limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 500) : 100
            }, actor);
            res.json(result);
        } catch (error) {
            logger.error('Failed to list companion approval inbox', { error });
            res.status(error.statusCode || 500).json({
                error: error.message || 'Failed to list companion approval inbox',
                code: error.code || 'approval_inbox_error',
                details: error.details || {}
            });
        }
    };

    listPeople = async (req, res) => {
        if (!this.infoSSOTService?.listGraphEntities) {
            res.status(503).json({
                error: 'Info SSOT service is not configured',
                code: 'info_ssot_service_unconfigured'
            });
            return;
        }

        const source = String(req.query.source || 'graph_ssot');
        const type = String(req.query.type || 'person');
        if (source !== 'graph_ssot' || type !== 'person') {
            res.status(400).json({
                error: 'Companion people can only be read from Brainbase Graph SSOT person entities',
                code: 'unsupported_people_source',
                details: { source, type }
            });
            return;
        }

        try {
            const limit = Number.parseInt(String(req.query.limit || '500'), 10);
            const records = await this.infoSSOTService.listGraphEntities(actorAccess(req), {
                projectCode: req.query.project || req.query.project_id || null,
                entityType: 'person',
                query: firstString(req.query.query, req.query.q, req.query.search),
                limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 1000) : 500
            });
            const query = firstString(req.query.query, req.query.q, req.query.search);
            const people = records
                .map(normalizePerson)
                .filter(Boolean)
                .filter((person) => matchesPersonQuery(person, query))
                .sort((left, right) => left.display_name.localeCompare(right.display_name, 'ja'));
            res.json({
                source: 'graph_ssot',
                type: 'person',
                count: people.length,
                people
            });
        } catch (error) {
            logger.error('Failed to list companion people from Info SSOT', { error });
            res.status(error.statusCode || 500).json({
                error: error.message || 'Failed to list companion people',
                code: error.code || 'companion_people_error',
                details: error.details || {}
            });
        }
    };

    createPerson = async (req, res) => {
        if (!this.infoSSOTService?.createOrUpdatePerson) {
            res.status(503).json({
                error: 'Info SSOT person registration is not configured',
                code: 'info_ssot_person_registration_unconfigured'
            });
            return;
        }

        const source = String(req.body?.source || req.query.source || 'graph_ssot');
        const type = String(req.body?.type || req.query.type || 'person');
        if (source !== 'graph_ssot' || type !== 'person') {
            res.status(400).json({
                error: 'Companion people can only be registered as Brainbase Graph SSOT person entities',
                code: 'unsupported_people_source',
                details: { source, type }
            });
            return;
        }

        try {
            const result = await this.infoSSOTService.createOrUpdatePerson(actorAccess(req), {
                ...(req.body || {}),
                projectCode: req.body?.projectCode || req.body?.project_code || req.query.project || req.query.project_id || null
            });
            res.status(201).json({
                source: 'graph_ssot',
                type: 'person',
                person: normalizePerson({
                    id: result.entity_id || result.person_id,
                    entity_type: 'person',
                    payload: {
                        name: result.name || result.display_name,
                        display_name: result.display_name || result.name,
                        aliases: result.aliases || [],
                        status: result.status || 'active'
                    }
                })
            });
        } catch (error) {
            logger.error('Failed to register companion person in Info SSOT', { error });
            res.status(error.statusCode || 500).json({
                error: error.message || 'Failed to register companion person',
                code: error.code || 'companion_people_registration_error',
                details: error.details || {}
            });
        }
    };
}
