import express from 'express';
import { logger } from '../../utils/logger.js';
import { asyncHandler } from '../../lib/async-handler.js';
import {
    catalogTechnicalMetadataUnavailable,
    catalogUnavailableResponse,
    loadRuntimeProjectCatalog
} from '../../services/project-access/runtime-project-catalog.js';

const RETIRED_LEGACY_PROJECTION = Object.freeze({
    status: 'retired',
    source: 'nocodb'
});

function retiredLegacyProjection() {
    return { ...RETIRED_LEGACY_PROJECTION };
}

function emptyRetiredValueLoop() {
    return {
        decision: {},
        work: {},
        ship: {},
        learn: {},
        meta: retiredLegacyProjection()
    };
}

/**
 * プロジェクトポータルAPI
 * 1リクエストでポータルに必要な全データ（方向性・課題・進捗・チーム）を返す
 */
export function createBrainbasePortalRouter(options = {}) {
    const router = express.Router();
    const {
        configParser,
        projectCatalogParser = configParser,
        projectCatalogAuthGuard = (_req, _res, next) => next(),
        infoSSOTService
    } = options;
    const catalogReadGuard = typeof projectCatalogParser?.runForOrganization === 'function'
        ? projectCatalogAuthGuard
        : (_req, _res, next) => next();

    /**
     * GET /api/brainbase/portal/:projectCode/value-loop
     * Value Loopデータ（Decision/Work/Ship/Learn）を返す
     */
    router.get('/portal/:projectCode/value-loop', catalogReadGuard, asyncHandler(async (req, res) => {
        const { projectCode } = req.params;
        const catalog = await loadRuntimeProjectCatalog(projectCatalogParser, req.access || {});
        if (catalog.source && catalog.source.status !== 'loaded') return catalogUnavailableResponse(res, catalog.source);
        if (catalogTechnicalMetadataUnavailable(catalog)) return catalogUnavailableResponse(res, catalog.source);
        const projectConfig = catalog.projects.find(p => p.id === projectCode);
        if (!projectConfig) return res.status(404).json({ error: 'Project not found' });
        // The legacy NocoDB value-loop projection is retired. Keep the route
        // shape for clients while making the absence explicit and side-effect
        // free; Graph/Postgres-backed routes own current data instead.
        res.json(emptyRetiredValueLoop());
    }));

    /**
     * GET /api/brainbase/portal/:projectCode
     * プロジェクトポータルの全データを集約して返す
     */
    router.get('/portal/:projectCode', catalogReadGuard, asyncHandler(async (req, res) => {
        const { projectCode } = req.params;

        const catalog = await loadRuntimeProjectCatalog(projectCatalogParser, req.access || {});
        if (catalog.source && catalog.source.status !== 'loaded') return catalogUnavailableResponse(res, catalog.source);
        if (catalogTechnicalMetadataUnavailable(catalog)) return catalogUnavailableResponse(res, catalog.source);
        const projectConfig = catalog.projects.find(p => p.id === projectCode);

        if (!projectConfig) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Graph/Postgres-backed content is fetched in parallel. NocoDB
        // projections are retired and therefore never queried here.
        const [direction, members] = await Promise.all([
            fetchDirection(projectCode),
            fetchMembers(projectCode)
        ]);

        const [frame, events] = await Promise.all([
            fetchFrame(projectCode),
            fetchEvents(projectCode)
        ]);

        // These fields retain their response shape for compatibility, but the
        // retired NocoDB source cannot establish any counts. `null` preserves
        // unknown/unavailable rather than presenting a false zero.
        const issues = { items: [], stats: { open: null, highImpact: null } };
        const milestones = [];
        const tasks = { items: [], stats: { total: null, completed: null, inProgress: null, overdue: null } };
        const health = { score: null };
        const sprints = [];
        const ships = [];
        const valueLoop = emptyRetiredValueLoop();

        const graphStoryResult = await fetchGraphStories(projectCode);
        const mergedStories = graphStoryResult.status === 'available'
            ? _mergeStoriesAndMilestones(graphStoryResult.stories, [])
            : [];
        const storyMap = {
            stories: mergedStories,
            sprints,
            milestones: milestones.filter(m => !m.story_id && m.name),
            meta: {
                storySource: graphStoryResult.status === 'available' ? 'graph' : 'unavailable',
                storyStatus: graphStoryResult.status,
                graphStoryCount: graphStoryResult.status === 'available' ? graphStoryResult.stories.length : null,
                wikiStoryCount: null,
                projectionSource: null
            }
        };

        res.json({
            project: { code: projectCode, name: projectConfig.name || projectCode },
            // New framework-driven fields
            frame,
            storyMap,
            valueLoop,
            events,
            // Existing fields (backward compat)
            direction,
            issues,
            milestones,
            tasks,
            members,
            health,
            meta: {
                timestamp: new Date().toISOString(),
                legacyProjection: retiredLegacyProjection()
            },
            timestamp: new Date().toISOString()
        });
    }));

    /**
     * GET /api/brainbase/portal/:projectCode/members
     * プロジェクトメンバー詳細
     */
    router.get('/portal/:projectCode/members', catalogReadGuard, asyncHandler(async (req, res) => {
        const { projectCode } = req.params;
        const catalog = await loadRuntimeProjectCatalog(projectCatalogParser, req.access || {});
        if (catalog.source && catalog.source.status !== 'loaded') return catalogUnavailableResponse(res, catalog.source);
        if (!catalog.projects.some((project) => project.id === projectCode)) {
            return res.status(404).json({ error: 'Project not found' });
        }
        const members = await fetchMembers(projectCode);
        res.json({ members });
    }));

    // ==================== データ取得関数 ====================

    async function fetchGraphStories(projectCode) {
        if (typeof infoSSOTService?.listGraphEntities !== 'function') {
            logger.warn('Portal: Graph story source is unavailable', { projectCode, reason: 'service_not_configured' });
            return { status: 'unavailable', stories: [] };
        }

        try {
            const access = {
                role: 'gm',
                projectCodes: Array.from(new Set([projectCode, 'brainbase', 'unson'].filter(Boolean))),
                clearance: ['internal', 'restricted', 'finance', 'hr', 'contract']
            };
            const records = await infoSSOTService.listGraphEntities(access, {
                projectCode: null,
                entityType: 'story'
            });
            const hasMalformedRecords = Array.isArray(records) && records.some(record => {
                if (!record || typeof record !== 'object' || Array.isArray(record)) return true;
                if (_graphStoryProjectScope(record, projectCode) === 'other') return false;
                return record.entity_type !== 'story'
                    || !record.payload
                    || typeof record.payload !== 'object'
                    || Array.isArray(record.payload);
            });
            if (!Array.isArray(records) || hasMalformedRecords) {
                logger.warn('Portal: Graph story source returned an invalid response', { projectCode });
                return { status: 'unavailable', stories: [] };
            }
            const stories = records
                .filter(record => _isGraphStoryForProject(record, projectCode))
                .map(_normalizeGraphStory)
                .filter(story => story.story_id && story.name);
            return { status: 'available', stories };
        } catch (error) {
            logger.warn('Portal: Failed to fetch graph stories', { projectCode, error: error.message });
            return { status: 'unavailable', stories: [] };
        }
    }

    function _isGraphStoryForProject(record, projectCode) {
        const payload = record?.payload || {};
        const source = String(payload.source || '');
        const projectCandidates = []
            .concat(payload.project_codes || [])
            .concat(payload.projects || [])
            .concat(payload.project_code || [])
            .concat(record?.project_code || [])
            .filter(Boolean)
            .map(value => String(value).toLowerCase());
        const normalizedProject = String(projectCode || '').toLowerCase();
        if (projectCandidates.includes(normalizedProject)) return true;
        if (source.startsWith(`${projectCode}/`)) return true;
        return source === 'common/00_stories.md' || source.startsWith('common/');
    }

    function _graphStoryProjectScope(record, projectCode) {
        const candidatePayload = record?.payload
            && typeof record.payload === 'object'
            && !Array.isArray(record.payload)
            ? record.payload
            : {};
        const source = String(candidatePayload.source || '');
        const projectCandidates = []
            .concat(candidatePayload.project_codes || [])
            .concat(candidatePayload.projects || [])
            .concat(candidatePayload.project_code || [])
            .concat(record?.project_code || [])
            .filter(Boolean)
            .map(value => String(value).toLowerCase());
        const normalizedProject = String(projectCode || '').toLowerCase();
        if (projectCandidates.includes(normalizedProject)) return 'target';
        if (source.startsWith(`${projectCode}/`) || source.startsWith('common/')) return 'target';
        if (projectCandidates.length || source.includes('/')) return 'other';
        return 'unknown';
    }

    function _normalizeGraphStory(record) {
        const payload = record?.payload || {};
        const storyId = payload.story_id || payload.storyId || record?.id || '';
        return {
            story_id: storyId,
            frame_id: payload.frame_id || payload.frameId || '',
            horizon: payload.horizon || '',
            view: payload.view || '',
            name: payload.name || payload.title || storyId,
            status: payload.status || '',
            period: payload.period || '',
            started_at: payload.started_at || payload.startedAt || '',
            due_at: payload.due_at || payload.dueAt || '',
            enemy: payload.enemy || '',
            context: payload.context || payload.description || '',
            criteria: payload.criteria || undefined,
            beat_map: payload.beat_map || undefined,
            source: 'graph',
            graphEntityId: record?.id || record?.entity_id || '',
            graphProjectCode: record?.project_code || '',
            graphSource: payload.source || ''
        };
    }

    // Direction and frame used to be read from Wiki. The route remains stable,
    // but the retired source is explicitly unavailable and has no fallback.
    async function fetchDirection() {
        return { title: '', content: '', available: false };
    }

    async function fetchFrame() {
        return { title: '', content: '', available: false, frames: [] };
    }

    function _mergeStoriesAndMilestones(stories, milestones) {
        const msMap = new Map();
        for (const m of milestones) {
            if (m.story_id) msMap.set(m.story_id, m);
        }
        return stories.map(s => {
            const ms = msMap.get(s.story_id);
            return {
                ...s,
                progress: ms?.progress ?? null,
                nocodbStatus: ms?.status ?? null,
                milestoneId: ms?.id ?? null,
                assignee: ms?.assignee || s.assignee || null,
                startedAt: s.started_at || ms?.startedAt || null,
                dueAt: s.due_at || ms?.dueAt || null
            };
        });
    }

    async function fetchEvents(projectCode) {
        try {
            if (!infoSSOTService?.pool) return { items: [], stats: { thisWeek: 0 } };
            const client = await infoSSOTService.pool.connect();
            try {
                const { rows } = await client.query('SELECT event_type, payload, occurred_at, source FROM events WHERE project_id IN (SELECT id FROM projects WHERE code = $1) ORDER BY occurred_at DESC LIMIT 20', [projectCode]);
                const now = new Date();
                const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                const thisWeek = rows.filter(r => r.occurred_at && new Date(r.occurred_at) >= weekAgo).length;
                return { items: rows.map(r => ({ eventType: r.event_type, payload: r.payload, occurredAt: r.occurred_at, source: r.source })), stats: { thisWeek } };
            } finally { client.release(); }
        } catch (error) {
            logger.warn('Portal: Failed to fetch events', { projectCode, error: error.message });
            return { items: [], stats: { thisWeek: 0 } };
        }
    }

    async function fetchMembers(projectCode) {
        try {
            if (!infoSSOTService?.pool) return [];
            const client = await infoSSOTService.pool.connect();
            try {
                const { rows: grantRows } = await client.query('SELECT person_id, person_name, role FROM auth_grants WHERE $1 = ANY(project_codes) AND active = true ORDER BY person_name', [projectCode]);
                const { rows: projectRows } = await client.query('SELECT id FROM projects WHERE code = $1 LIMIT 1', [projectCode]);
                const projectId = projectRows[0]?.id || null;
                let raciMap = new Map();
                if (projectId) {
                    const { rows: raciRows } = await client.query('SELECT person_id, role_code, authority_scope FROM raci_assignments WHERE project_id = $1', [projectId]);
                    for (const row of raciRows) { if (!raciMap.has(row.person_id)) raciMap.set(row.person_id, []); raciMap.get(row.person_id).push({ roleCode: row.role_code, authorityScope: row.authority_scope }); }
                }
                return grantRows.map(row => ({ personId: row.person_id, name: row.person_name, role: row.role, raciRoles: raciMap.get(row.person_id) || [] }));
            } finally { client.release(); }
        } catch (error) {
            logger.warn('Portal: Failed to fetch members', { projectCode, error: error.message });
            return [];
        }
    }

    return router;
}
