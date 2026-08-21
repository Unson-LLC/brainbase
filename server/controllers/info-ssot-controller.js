// @ts-check
import { logger } from '../utils/logger.js';
import { isInsecureHeaderAuthAllowed, parseCsv } from '../lib/validation.js';
import { OntologyError } from '../services/ontology-kernel.js';
import { GraphMaintenanceService } from '../services/graph-maintenance-service.js';

/** @typedef {any} Request */
/** @typedef {any} Response */
/** @typedef {{ role: string, projectCodes: string[], clearance: string[], organizationId?: string | null, tenantId?: string | null, personId?: string | null, authSource?: string | null, workspace?: string | null, channelId?: string | null, sessionId?: string | null }} AccessContext */

/** @param {unknown} error */
function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error || '');
}

/** @param {Request & { access?: AccessContext }} req */
function buildAccessContext(req) {
    if (req.access) {
        return req.access;
    }
    if (!isInsecureHeaderAuthAllowed()) {
        throw new Error('Slack OAuth token required');
    }
    const role = (req.get('x-brainbase-role') || req.get('x-role') || '').toLowerCase();
    const projectHeader = req.get('x-brainbase-projects') || req.get('x-projects') || '';
    const clearanceHeader = req.get('x-brainbase-clearance') || req.get('x-clearance') || '';
    const projectCodes = parseCsv(projectHeader);
    const clearance = parseCsv(clearanceHeader);
    const personId = req.get('x-brainbase-person-id') || req.get('x-person-id') || null;
    const workspace = req.get('x-brainbase-workspace') || req.get('x-workspace') || null;
    const channelId = req.get('x-brainbase-channel-id') || req.get('x-channel-id') || null;
    const sessionId = req.get('x-brainbase-session-id') || req.get('x-session-id') || null;

    return {
        role,
        projectCodes,
        clearance,
        personId,
        workspace,
        channelId,
        sessionId
    };
}

/** @param {AccessContext} access */
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

/** @param {unknown} error */
function resolveErrorStatus(error) {
    const message = getErrorMessage(error);
    if (message.includes('Slack OAuth token required')) {
        return 401;
    }
    if (message.includes('Bearer authorization')) {
        return 401;
    }
    if (message.includes('Signed tenant authorization')) {
        return 401;
    }
    if (message.includes('conflict') || message.includes('not applicable')) {
        return 409;
    }
    if (message.includes('Access denied')) {
        return 403;
    }
    if (message.includes('requires gm or ceo')) {
        return 403;
    }
    if (message.includes('signed human Bearer principal')) {
        return 403;
    }
    if (message.includes('Human Gate receipt id conflict')) {
        return 409;
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

function sendOntologyError(res, error, { operation = 'read' } = {}) {
    if (!(error instanceof OntologyError)) {
        res.status(resolveErrorStatus(error)).json({ error: getErrorMessage(error) || 'Ontology operation failed' });
        return;
    }
    const status = error.details?.http_status || (error.code === 'ONTOLOGY_CURRENT_UNAVAILABLE'
        ? (operation === 'read' ? 404 : 503)
        : error.code === 'ONTOLOGY_VERSION_UNKNOWN'
            ? 404
            : error.code === 'ONTOLOGY_INPUT_REQUIRED'
                || error.code === 'ONTOLOGY_VALIDATION_FAILED'
                || error.code === 'ONTOLOGY_EDGE_ENDPOINT_NOT_FOUND'
                || error.code === 'ONTOLOGY_CONTEXT_ENTITY_TYPE_MISMATCH'
                ? 400
                : 500);
    res.status(status).json({
        error: error.message,
        code: error.code,
        details: error.details
    });
}

export class InfoSSOTController {
    /** @param {any} infoSSOTService */
    constructor(infoSSOTService) {
        this.infoSSOTService = infoSSOTService;
        this.graphMaintenanceService = new GraphMaintenanceService({ infoSSOTService });
    }

    maintenanceAccess(req) {
        // Graph maintenance is deliberately restricted to a user Bearer token.
        // Internal/service-token principals use separate machine APIs and must not
        // reach a write-capable maintenance surface, even when they carry a
        // project scope. The CSRF middleware has the same exact boundary.
        if (String(req.authSource || '') !== 'bearer') {
            throw new Error('Bearer authorization is required');
        }
        const access = buildAccessContext(req);
        assertAccessContext(access);
        if (!access.organizationId && !access.tenantId) throw new Error('Signed tenant authorization with organization is required');
        return { ...access, authSource: String(req.authSource || access.authSource || '') };
    }

    recordGraphHumanGateReceipt = async (req, res) => {
        try {
            res.status(201).json(await this.graphMaintenanceService.recordHumanGateReceipt(this.maintenanceAccess(req), {
                projectCode: req.body?.project_code,
                decisionId: req.body?.decision_id,
                receiptId: req.body?.receipt_id,
                evidence: req.body?.evidence
            }));
        } catch (error) {
            logger.error('Failed to record Graph Human Gate receipt', { error });
            res.status(resolveErrorStatus(error)).json({ error: getErrorMessage(error) });
        }
    };

    exportGraphSnapshot = async (req, res) => {
        try {
            res.status(201).json(await this.graphMaintenanceService.exportSnapshot(this.maintenanceAccess(req), {
                projectCode: req.body?.project_code,
                includeProjectCodes: req.body?.include_project_codes
            }));
        } catch (error) {
            logger.error('Failed to export Graph maintenance snapshot', { error });
            res.status(resolveErrorStatus(error)).json({ error: getErrorMessage(error) });
        }
    };

    planGraphMutations = async (req, res) => {
        try {
            res.status(201).json(await this.graphMaintenanceService.planMutations(this.maintenanceAccess(req), {
                projectCode: req.body?.project_code, snapshotId: req.body?.snapshot_id,
                idempotencyKey: req.body?.idempotency_key, reason: req.body?.reason,
                operations: req.body?.operations, humanGateReceipt: req.body?.human_gate_receipt
            }));
        } catch (error) {
            logger.error('Failed to plan Graph maintenance mutations', { error });
            res.status(resolveErrorStatus(error)).json({ error: getErrorMessage(error) });
        }
    };

    applyGraphPlan = async (req, res) => {
        try {
            res.json(await this.graphMaintenanceService.applyPlan(this.maintenanceAccess(req), {
                projectCode: req.body?.project_code, planId: req.params.planId,
                snapshotHash: req.body?.snapshot_hash
            }));
        } catch (error) {
            logger.error('Failed to apply Graph maintenance plan', { error });
            res.status(resolveErrorStatus(error)).json({ error: getErrorMessage(error) });
        }
    };

    getGraphPlanReceipt = async (req, res) => {
        try {
            res.json(await this.graphMaintenanceService.getPlanReceipt(this.maintenanceAccess(req), {
                projectCode: req.query.project_code, planId: req.params.planId
            }));
        } catch (error) {
            logger.error('Failed to read Graph maintenance receipt', { error });
            res.status(resolveErrorStatus(error)).json({ error: getErrorMessage(error) });
        }
    };

    rollbackGraphPlan = async (req, res) => {
        try {
            res.json(await this.graphMaintenanceService.rollbackPlan(this.maintenanceAccess(req), {
                projectCode: req.body?.project_code, planId: req.params.planId,
                applyReceiptId: req.body?.apply_receipt_id
            }));
        } catch (error) {
            logger.error('Failed to rollback Graph maintenance plan', { error });
            res.status(resolveErrorStatus(error)).json({ error: getErrorMessage(error) });
        }
    };

    validateGraphMaintenance = async (req, res) => {
        try {
            res.json(await this.graphMaintenanceService.validate(this.maintenanceAccess(req), {
                projectCode: req.body?.project_code,
                includeProjectCodes: req.body?.include_project_codes
            }));
        } catch (error) {
            logger.error('Failed to validate maintained Graph', { error });
            sendOntologyError(res, error, { operation: 'validate' });
        }
    };

    appendOntologyGuard(result) {
        return { ...result, ...this.infoSSOTService.getOntologyGuard() };
    }

    getOntology = async (req, res) => {
        try {
            assertAccessContext(buildAccessContext(req));
            res.json(this.infoSSOTService.describeOntology({
                version: req.query.version || undefined,
                asOf: req.query.asOf || req.query.as_of || undefined
            }));
        } catch (error) {
            logger.error('Failed to describe ontology', { error });
            sendOntologyError(res, error, { operation: 'read' });
        }
    };

    getOntologyRelease = async (req, res) => {
        try {
            assertAccessContext(buildAccessContext(req));
            res.json(this.infoSSOTService.describeOntology({ version: req.params.version }));
        } catch (error) {
            logger.error('Failed to describe ontology release', { error });
            sendOntologyError(res, error, { operation: 'read' });
        }
    };

    getOntologyType = async (req, res) => {
        try {
            assertAccessContext(buildAccessContext(req));
            res.json(this.infoSSOTService.describeOntologyType(req.params.id, {
                version: req.query.version || undefined,
                asOf: req.query.asOf || req.query.as_of || undefined
            }));
        } catch (error) {
            logger.error('Failed to describe ontology type', { error });
            sendOntologyError(res, error, { operation: 'read' });
        }
    };

    getOntologyRelation = async (req, res) => {
        try {
            assertAccessContext(buildAccessContext(req));
            res.json(this.infoSSOTService.describeOntologyRelation(req.params.id, {
                version: req.query.version || undefined,
                asOf: req.query.asOf || req.query.as_of || undefined
            }));
        } catch (error) {
            logger.error('Failed to describe ontology relation', { error });
            sendOntologyError(res, error, { operation: 'read' });
        }
    };

    validateOntology = async (req, res) => {
        try {
            assertAccessContext(buildAccessContext(req));
            res.json(this.infoSSOTService.validateOntology(req.body || {}));
        } catch (error) {
            logger.error('Failed to validate ontology input', { error });
            sendOntologyError(res, error, { operation: 'validate' });
        }
    };

    inferOntology = async (req, res) => {
        try {
            assertAccessContext(buildAccessContext(req));
            res.json(this.infoSSOTService.inferOntology(req.body || {}));
        } catch (error) {
            logger.error('Failed to run ontology inference', { error });
            sendOntologyError(res, error, { operation: 'infer' });
        }
    };

    impactOntology = async (req, res) => {
        try {
            assertAccessContext(buildAccessContext(req));
            res.json(this.infoSSOTService.impactOntology(req.body || {}));
        } catch (error) {
            logger.error('Failed to analyze ontology impact', { error });
            sendOntologyError(res, error, { operation: 'impact' });
        }
    };

    auditOntology = async (req, res) => {
        try {
            const access = buildAccessContext(req);
            assertAccessContext(access);
            res.json(await this.infoSSOTService.auditOntology(access, req.body || {}));
        } catch (error) {
            logger.error('Failed to audit ontology', { error });
            sendOntologyError(res, error, { operation: 'audit' });
        }
    };

    commitOntologyGraph = async (req, res) => {
        try {
            const access = buildAccessContext(req);
            assertAccessContext(access);
            res.status(201).json(await this.infoSSOTService.commitOntologyGraph(access, req.body || {}));
        } catch (error) {
            logger.error('Failed to commit ontology graph', { error });
            sendOntologyError(res, error, { operation: 'commit' });
        }
    };

    authorizeOntologyPublication = async (req, res) => {
        try {
            const access = buildAccessContext(req);
            assertAccessContext(access);
            res.status(201).json(await this.infoSSOTService.authorizeOntologyPublication(access, req.body || {}));
        } catch (error) {
            logger.error('Failed to authorize ontology publication', { error });
            sendOntologyError(res, error, { operation: 'authorize' });
        }
    };

    /** @param {Request} req @param {Response} res */
    listDecisions = async (req, res) => {
        try {
            res.status(410).json({ error: 'Decisions are read via Graph SSOT only' });
        } catch (error) {
            logger.error('Failed to list decisions', { error });
            res.status(resolveErrorStatus(error)).json({ error: getErrorMessage(error) || 'Failed to list decisions' });
        }
    };

    /** @param {Request} req @param {Response} res */
    listRaci = async (req, res) => {
        try {
            res.status(410).json({ error: 'RACI is read via Graph SSOT only' });
        } catch (error) {
            logger.error('Failed to list raci', { error });
            res.status(resolveErrorStatus(error)).json({ error: getErrorMessage(error) || 'Failed to list raci' });
        }
    };

    /** @param {Request} req @param {Response} res */
    listEvents = async (req, res) => {
        try {
            res.status(410).json({ error: 'Events are read via Graph SSOT only' });
        } catch (error) {
            logger.error('Failed to list events', { error });
            res.status(resolveErrorStatus(error)).json({ error: getErrorMessage(error) || 'Failed to list events' });
        }
    };

    listGraphEntities = async (req, res) => {
        try {
            const access = buildAccessContext(req);
            assertAccessContext(access);
            const id = req.query.id || null;
            const ids = typeof req.query.ids === 'string' ? parseCsv(req.query.ids) : [];
            const projectCode = req.query.project || null;
            const entityType = req.query.type || null;
            const query = req.query.query || null;
            const limit = req.query.limit || null;
            const records = await this.infoSSOTService.listGraphEntities(
                access,
                { id, ids, projectCode, entityType, query, limit }
            );
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
            const includePhilosophy = String(req.query.includePhilosophy || '').toLowerCase() === 'true';
            const scope = req.query.scope || null;
            const objectType = req.query.objectType || null;
            const operation = req.query.operation || null;
            const maxRecommended = req.query.maxRecommended || null;
            const includeMemory = String(req.query.includeMemory || req.query.include_memory || '').toLowerCase() === 'true';
            const personId = req.query.personId || req.query.person_id || access.personId || null;
            const workspace = req.query.workspace || access.workspace || null;
            const channelId = req.query.channelId || req.query.channel_id || access.channelId || null;
            const sessionId = req.query.sessionId || req.query.session_id || access.sessionId || null;

            const result = await this.infoSSOTService.getContext(access, {
                projectCode,
                entityTypes,
                limit,
                humanReadable,
                includeEdges,
                includePhilosophy,
                scope,
                objectType,
                operation,
                maxRecommended,
                includeMemory,
                memoryAccessContext: {
                    person_id: personId,
                    workspace,
                    channel_id: channelId,
                    session_id: sessionId,
                    roles: [access.role],
                    project_codes: access.projectCodes,
                    clearance: access.clearance
                }
            });

            res.json(result);
        } catch (error) {
            logger.error('Failed to get context', { error });
            res.status(resolveErrorStatus(error)).json({
                error: error.message || 'Failed to get context'
            });
        }
    };

    getPersonBySlack = async (req, res) => {
        try {
            const access = buildAccessContext(req);
            assertAccessContext(access);

            if (!['service-token', 'internal'].includes(String(req.authSource || ''))) {
                return res.status(403).json({ error: 'Service authentication required' });
            }

            const workspaceId = String(req.query.workspaceId || '').trim();
            const slackUserId = String(req.query.slackUserId || '').trim();
            const projectCode = String(req.query.project || '').trim();
            if (!workspaceId || !slackUserId || !projectCode) {
                return res.status(400).json({ error: 'workspaceId, slackUserId and project are required' });
            }
            if (!access.projectCodes.includes(projectCode)) {
                return res.status(403).json({ error: 'Access denied for project' });
            }

            const person = await this.infoSSOTService.getPersonBySlackId(slackUserId, workspaceId);
            if (!person) {
                return res.status(404).json({ error: 'Person not found' });
            }

            return res.json({
                person: {
                    id: person.id,
                    name: person.name || null
                }
            });
        } catch (error) {
            logger.error('Failed to resolve Slack person', { error });
            return res.status(resolveErrorStatus(error)).json({ error: getErrorMessage(error) || 'Failed to resolve Slack person' });
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

    upsertGraphEntity = async (req, res) => {
        try {
            const access = buildAccessContext(req);
            assertAccessContext(access);
            const result = await this.infoSSOTService.createOrUpdateGraphEntity(access, req.body || {});
            res.status(201).json(result);
        } catch (error) {
            logger.error('Failed to upsert graph entity', { error });
            sendOntologyError(res, error, { operation: 'validate' });
        }
    };

    upsertGraphEdge = async (req, res) => {
        try {
            const access = buildAccessContext(req);
            assertAccessContext(access);
            const result = await this.infoSSOTService.createOrUpdateGraphEdge(access, req.body || {});
            res.status(201).json(result);
        } catch (error) {
            logger.error('Failed to upsert graph edge', { error });
            sendOntologyError(res, error, { operation: 'validate' });
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
            res.status(201).json(this.appendOntologyGuard(result));
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
            res.status(201).json(this.appendOntologyGuard(result));
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
            res.status(201).json(this.appendOntologyGuard(result));
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
            res.status(201).json(this.appendOntologyGuard(result));
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
            res.status(201).json(this.appendOntologyGuard(result));
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
            res.status(200).json(this.appendOntologyGuard(result));
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
            res.status(201).json(this.appendOntologyGuard(result));
        } catch (error) {
            logger.error('Failed to create ai decision log', { error });
            res.status(resolveErrorStatus(error)).json({ error: error.message || 'Failed to create ai decision log' });
        }
    };
}
