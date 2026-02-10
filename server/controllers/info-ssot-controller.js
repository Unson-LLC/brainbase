import { logger } from '../utils/logger.js';

function parseCsv(value) {
    if (!value || typeof value !== 'string') {
        return [];
    }
    return value.split(',').map(v => v.trim()).filter(Boolean);
}

function allowHeaderAccess() {
    if (process.env.ALLOW_INSECURE_SSOT_HEADERS === 'true') {
        return true;
    }
    if (process.env.BRAINBASE_TEST_MODE === 'true') {
        return true;
    }
    if (process.env.NODE_ENV === 'test') {
        return true;
    }
    return false;
}

function buildAccessContext(req) {
    if (req.access) {
        return req.access;
    }
    if (!allowHeaderAccess()) {
        throw new Error('Slack OAuth token required');
    }
    const role = (req.get('x-brainbase-role') || req.get('x-role') || '').toLowerCase();
    const projectHeader = req.get('x-brainbase-projects') || req.get('x-projects') || '';
    const clearanceHeader = req.get('x-brainbase-clearance') || req.get('x-clearance') || '';
    const projectCodes = parseCsv(projectHeader);
    const clearance = parseCsv(clearanceHeader);

    return {
        role,
        projectCodes,
        clearance
    };
}

function assertAccessContext(access) {
    if (!access.role) {
        throw new Error('Access role is required (x-brainbase-role)');
    }
    if (!access.projectCodes.length) {
        throw new Error('Access project list is required (x-brainbase-projects)');
    }
    if (!access.clearance.length) {
        throw new Error('Access clearance is required (x-brainbase-clearance)');
    }
}

function resolveErrorStatus(error) {
    const message = String(error?.message || '');
    if (message.includes('Slack OAuth token required')) {
        return 401;
    }
    if (message.includes('Access denied')) {
        return 403;
    }
    if (message.includes('Decision authority missing')) {
        return 403;
    }
    if (message.includes('Seed is not accessible')) {
        return 403;
    }
    if (message.includes('Decision domain is required')) {
        return 400;
    }
    if (message.includes('projectCode is required') || message.includes('seed is required')) {
        return 400;
    }
    if (message.includes('Sensitive data requires role_min')) {
        return 400;
    }
    if (message.includes('required') || message.includes('Invalid') || message.includes('Unknown')) {
        return 400;
    }
    return 500;
}

export class InfoSSOTController {
    constructor(infoSSOTService) {
        this.infoSSOTService = infoSSOTService;
    }

    listDecisions = async (req, res) => {
        try {
            res.status(410).json({ error: 'Decisions are read via Graph SSOT only' });
        } catch (error) {
            logger.error('Failed to list decisions', { error });
            res.status(resolveErrorStatus(error)).json({ error: error.message || 'Failed to list decisions' });
        }
    };

    listRaci = async (req, res) => {
        try {
            res.status(410).json({ error: 'RACI is read via Graph SSOT only' });
        } catch (error) {
            logger.error('Failed to list raci', { error });
            res.status(resolveErrorStatus(error)).json({ error: error.message || 'Failed to list raci' });
        }
    };

    listEvents = async (req, res) => {
        try {
            res.status(410).json({ error: 'Events are read via Graph SSOT only' });
        } catch (error) {
            logger.error('Failed to list events', { error });
            res.status(resolveErrorStatus(error)).json({ error: error.message || 'Failed to list events' });
        }
    };

    listGraphEntities = async (req, res) => {
        try {
            const access = buildAccessContext(req);
            assertAccessContext(access);
            const projectCode = req.query.project || null;
            const entityType = req.query.type || null;
            const records = await this.infoSSOTService.listGraphEntities(access, { projectCode, entityType });
            res.json({ records });
        } catch (error) {
            logger.error('Failed to list graph entities', { error });
            res.status(resolveErrorStatus(error)).json({ error: error.message || 'Failed to list graph entities' });
        }
    };

    listGraphEdges = async (req, res) => {
        try {
            const access = buildAccessContext(req);
            assertAccessContext(access);
            const projectCode = req.query.project || null;
            const relType = req.query.type || null;
            const fromId = req.query.from || null;
            const toId = req.query.to || null;
            const records = await this.infoSSOTService.listGraphEdges(access, { projectCode, relType, fromId, toId });
            res.json({ records });
        } catch (error) {
            logger.error('Failed to list graph edges', { error });
            res.status(resolveErrorStatus(error)).json({ error: error.message || 'Failed to list graph edges' });
        }
    };

    getContext = async (req, res) => {
        try {
            const access = buildAccessContext(req);
            assertAccessContext(access);

            const projectCode = req.query.project || null;
            const entityTypes = req.query.types || 'all';
            const limit = req.query.limit || null;
            const humanReadable = String(req.query.humanReadable || '').toLowerCase() === 'true';
            const includeEdges = String(req.query.includeEdges || '').toLowerCase() === 'true';

            const result = await this.infoSSOTService.getContext(access, {
                projectCode,
                entityTypes,
                limit,
                humanReadable,
                includeEdges
            });

            res.json(result);
        } catch (error) {
            logger.error('Failed to get context', { error });
            res.status(resolveErrorStatus(error)).json({
                error: error.message || 'Failed to get context'
            });
        }
    };

    expandGraph = async (req, res) => {
        try {
            const access = buildAccessContext(req);
            assertAccessContext(access);
            const projectCode = req.query.project || null;
            const seedId = req.query.seed || null;
            const depth = req.query.depth || null;
            const limit = req.query.limit || null;
            const humanReadable = String(req.query.humanReadable || '').toLowerCase() === 'true';
            const result = await this.infoSSOTService.expandGraph(access, {
                projectCode,
                seedId,
                depth,
                limit,
                humanReadable
            });
            res.json(result);
        } catch (error) {
            logger.error('Failed to expand graph', { error });
            res.status(resolveErrorStatus(error)).json({ error: error.message || 'Failed to expand graph' });
        }
    };

    createEvent = async (req, res) => {
        try {
            const access = buildAccessContext(req);
            assertAccessContext(access);
            const result = await this.infoSSOTService.createEvent(access, req.body || {});
            res.status(201).json(result);
        } catch (error) {
            logger.error('Failed to create event', { error });
            res.status(resolveErrorStatus(error)).json({ error: error.message || 'Failed to create event' });
        }
    };

    createDecision = async (req, res) => {
        try {
            const access = buildAccessContext(req);
            assertAccessContext(access);
            const result = await this.infoSSOTService.createDecision(access, req.body || {});
            res.status(201).json(result);
        } catch (error) {
            logger.error('Failed to create decision', { error });
            res.status(resolveErrorStatus(error)).json({ error: error.message || 'Failed to create decision' });
        }
    };

    createRaci = async (req, res) => {
        try {
            const access = buildAccessContext(req);
            assertAccessContext(access);
            const result = await this.infoSSOTService.createRaci(access, req.body || {});
            res.status(201).json(result);
        } catch (error) {
            logger.error('Failed to create raci', { error });
            res.status(resolveErrorStatus(error)).json({ error: error.message || 'Failed to create raci' });
        }
    };

    createGlossaryTerm = async (req, res) => {
        try {
            const access = buildAccessContext(req);
            assertAccessContext(access);
            const result = await this.infoSSOTService.createGlossaryTerm(access, req.body || {});
            res.status(201).json(result);
        } catch (error) {
            logger.error('Failed to create glossary term', { error });
            res.status(resolveErrorStatus(error)).json({ error: error.message || 'Failed to create glossary term' });
        }
    };

    createKpi = async (req, res) => {
        try {
            const access = buildAccessContext(req);
            assertAccessContext(access);
            const result = await this.infoSSOTService.createKpi(access, req.body || {});
            res.status(201).json(result);
        } catch (error) {
            logger.error('Failed to create kpi', { error });
            res.status(resolveErrorStatus(error)).json({ error: error.message || 'Failed to create kpi' });
        }
    };

    createInitiative = async (req, res) => {
        try {
            const access = buildAccessContext(req);
            assertAccessContext(access);
            const result = await this.infoSSOTService.createInitiative(access, req.body || {});
            res.status(201).json(result);
        } catch (error) {
            logger.error('Failed to create initiative', { error });
            res.status(resolveErrorStatus(error)).json({ error: error.message || 'Failed to create initiative' });
        }
    };

    createAiQuery = async (req, res) => {
        try {
            const access = buildAccessContext(req);
            assertAccessContext(access);
            const result = await this.infoSSOTService.createAiQuery(access, req.body || {});
            res.status(200).json(result);
        } catch (error) {
            logger.error('Failed to create ai query', { error });
            res.status(resolveErrorStatus(error)).json({ error: error.message || 'Failed to create ai query' });
        }
    };

    createAiDecisionLog = async (req, res) => {
        try {
            const access = buildAccessContext(req);
            assertAccessContext(access);
            const result = await this.infoSSOTService.createAiDecisionLog(access, req.body || {});
            res.status(201).json(result);
        } catch (error) {
            logger.error('Failed to create ai decision log', { error });
            res.status(resolveErrorStatus(error)).json({ error: error.message || 'Failed to create ai decision log' });
        }
    };
}
