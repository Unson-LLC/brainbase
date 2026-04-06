import express from 'express';
import { logger } from '../../utils/logger.js';
import { asyncHandler } from '../../lib/async-handler.js';

/**
 * プロジェクトポータルAPI
 * 1リクエストでポータルに必要な全データ（方向性・課題・進捗・チーム）を返す
 */
export function createBrainbasePortalRouter(options = {}) {
    const router = express.Router();
    const {
        nocodbService,
        configParser,
        infoSSOTService,
        wikiService
    } = options;

    /**
     * GET /api/brainbase/portal/:projectCode/value-loop
     * Value Loopデータ（Decision/Work/Ship/Learn）を返す
     */
    router.get('/portal/:projectCode/value-loop', asyncHandler(async (req, res) => {
        const { projectCode } = req.params;
        const config = await configParser.getAll();
        const projectConfig = (config.projects?.projects || []).find(p => p.id === projectCode && !p.archived);
        if (!projectConfig) return res.status(404).json({ error: 'Project not found' });
        const nocodbBaseId = projectConfig.nocodb?.project_id || null;
        if (!nocodbBaseId) return res.json({ decision: {}, work: {}, ship: {}, learn: {} });
        const valueLoop = await fetchValueLoop(nocodbBaseId, projectCode);
        res.json(valueLoop);
    }));

    /**
     * GET /api/brainbase/portal/:projectCode
     * プロジェクトポータルの全データを集約して返す
     */
    router.get('/portal/:projectCode', asyncHandler(async (req, res) => {
        const { projectCode } = req.params;

        // config.yml からプロジェクト情報を取得
        const config = await configParser.getAll();
        const projectConfig = (config.projects?.projects || [])
            .find(p => p.id === projectCode && !p.archived);

        if (!projectConfig) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const nocodbBaseId = projectConfig.nocodb?.project_id || null;

        // 全データを並行取得（既存）
        const [direction, issues, milestones, tasks, members, health] = await Promise.all([
            fetchDirection(projectCode),
            nocodbBaseId ? fetchIssues(nocodbBaseId) : { items: [], stats: { open: 0, highImpact: 0 } },
            nocodbBaseId ? fetchMilestones(nocodbBaseId) : [],
            nocodbBaseId ? fetchTasks(nocodbBaseId) : { items: [], stats: { total: 0, completed: 0, inProgress: 0, overdue: 0 } },
            fetchMembers(projectCode),
            nocodbBaseId ? fetchHealth(nocodbBaseId) : { score: 0 }
        ]);

        // 新規データを並行取得
        const [frame, sprints, ships, events] = await Promise.all([
            fetchFrame(projectCode),
            nocodbBaseId ? fetchSprints(nocodbBaseId) : [],
            nocodbBaseId ? fetchShips(nocodbBaseId) : [],
            fetchEvents(projectCode)
        ]);

        const valueLoop = nocodbBaseId
            ? {
                decision: { milestones: milestones.filter(m => m.status !== '完了'), issues: issues.items?.filter(i => i.impact === 'high') || [], decisions: [] },
                work: { currentSprint: sprints[0] || null, tasks: tasks.items?.filter(t => t.status !== '完了') || [] },
                ship: { items: ships },
                learn: { retrospectives: sprints.filter(s => s.learnings).map(s => ({ period: s.period, learnings: s.learnings })).slice(0, 3) }
            }
            : { decision: {}, work: {}, ship: {}, learn: {} };

        const stories = await fetchStories(projectCode);
        const storyMap = { milestones, sprints, stories };

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
            meta: { timestamp: new Date().toISOString() },
            timestamp: new Date().toISOString()
        });
    }));

    /**
     * GET /api/brainbase/portal/:projectCode/members
     * プロジェクトメンバー詳細
     */
    router.get('/portal/:projectCode/members', asyncHandler(async (req, res) => {
        const { projectCode } = req.params;
        const members = await fetchMembers(projectCode);
        res.json({ members });
    }));

    // ==================== データ取得関数 ====================

    async function fetchDirection(projectCode) {
        try {
            if (!wikiService) return { title: '', content: '', available: false };
            const access = { role: 'member', roleRank: 1, clearance: ['internal'], projectCodes: [projectCode] };
            const result = await wikiService.getPage(access, `${projectCode}/project.md`);
            if (result.error) {
                const fallback = await wikiService.getPage(access, `${projectCode}/README.md`);
                if (fallback.error) return { title: 'project.md', content: '', available: false };
                return { title: fallback.title || 'README.md', content: fallback.content, available: true };
            }
            return { title: result.title || 'project.md', content: result.content, available: true };
        } catch (error) {
            logger.warn('Portal: Failed to fetch direction', { projectCode, error: error.message });
            return { title: '', content: '', available: false };
        }
    }

    async function fetchStories(projectCode) {
        try {
            if (!wikiService) return [];
            const access = { role: 'member', roleRank: 1, clearance: ['internal'], projectCodes: [projectCode] };
            const result = await wikiService.getPage(access, `${projectCode}/stories.md`);
            if (result.error || !result.content) return [];
            // Parse YAML code blocks from stories.md
            const stories = [];
            const yamlBlocks = result.content.match(/```yaml\n([\s\S]*?)```/g) || [];
            for (const block of yamlBlocks) {
                const yaml = block.replace(/```yaml\n/, '').replace(/```/, '').trim();
                const story = {};
                for (const line of yaml.split('\n')) {
                    const match = line.match(/^(\w[\w_]*)\s*:\s*(.+)/);
                    if (match) {
                        const [, key, val] = match;
                        story[key] = val.replace(/^["']|["']$/g, '').trim();
                    }
                }
                if (story.story_id && story.horizon && story.name) {
                    stories.push(story);
                }
            }
            return stories;
        } catch (error) {
            logger.warn('Portal: Failed to fetch stories', { projectCode, error: error.message });
            return [];
        }
    }

    async function fetchFrame(projectCode) {
        try {
            if (!wikiService) return { title: '', content: '', available: false, frames: [] };
            const access = { role: 'member', roleRank: 1, clearance: ['internal'], projectCodes: [projectCode] };
            const result = await wikiService.getPage(access, `${projectCode}/frame.md`);
            if (result.error) {
                const fallback = await wikiService.getPage(access, `${projectCode}/project.md`);
                if (fallback.error) {
                    const readmeFallback = await wikiService.getPage(access, `${projectCode}/README.md`);
                    if (readmeFallback.error) return { title: 'frame.md', content: '', available: false, frames: [] };
                    return { title: readmeFallback.title || 'README.md', content: readmeFallback.content, available: true, frames: [] };
                }
                return { title: fallback.title || 'project.md', content: fallback.content, available: true, frames: [] };
            }
            // Parse multiple frames from YAML blocks
            const frames = _parseFrameBlocks(result.content);
            return { title: result.title || 'frame.md', content: result.content, available: true, frames };
        } catch (error) {
            logger.warn('Portal: Failed to fetch frame', { projectCode, error: error.message });
            return { title: '', content: '', available: false, frames: [] };
        }
    }

    function _parseFrameBlocks(content) {
        const blocks = content.match(/```yaml\n([\s\S]*?)```/g) || [];
        return blocks.map(block => {
            const yaml = block.replace(/```yaml\n/, '').replace(/```/, '').trim();
            const frame = {};
            for (const line of yaml.split('\n')) {
                const m = line.match(/^(\w[\w_]*)\s*:\s*"?(.+?)"?\s*$/);
                if (m) frame[m[1]] = m[2];
            }
            return frame;
        }).filter(f => f.frame_id);
    }

    async function fetchIssues(baseId) {
        try {
            const records = await nocodbService._fetchRecords(baseId, '課題');
            const items = records.map(r => ({
                id: r.Id ?? r.id,
                title: r['タイトル'] || '',
                type: r['種別'] || '',
                status: r['ステータス'] || 'open',
                impact: r['影響度'] || 'medium',
                reporter: r['起票者'] || '',
                assignee: r['担当者'] || '',
                decisionLog: r['判断ログ'] || '',
                description: r['説明'] || '',
                storyUrl: r['関連ストーリー'] || ''
            }));
            const openItems = items.filter(i => i.status !== 'resolved');
            return { items: openItems, stats: { open: openItems.length, highImpact: openItems.filter(i => i.impact === 'high').length } };
        } catch (error) {
            logger.warn('Portal: Failed to fetch issues', { baseId, error: error.message });
            return { items: [], stats: { open: 0, highImpact: 0 } };
        }
    }

    async function fetchMilestones(baseId) {
        try {
            const records = await nocodbService._fetchRecords(baseId, 'マイルストーン');
            return records.map(r => ({ id: r.Id ?? r.id, name: r['マイルストーン名'] || r['タイトル'] || '', progress: r['進捗率'] ?? 0, status: r['ステータス'] || '' }));
        } catch (error) {
            logger.warn('Portal: Failed to fetch milestones', { baseId, error: error.message });
            return [];
        }
    }

    async function fetchTasks(baseId) {
        try {
            const records = await nocodbService._fetchRecords(baseId, 'タスク');
            const items = records.map(r => ({ id: r.Id ?? r.id, title: r['タイトル'] || '', status: r['ステータス'] || '', assignee: r['担当者'] || '', priority: r['優先度'] || '', due: r['期限'] || '' }));
            const now = new Date();
            const completed = items.filter(i => i.status === '完了').length;
            const inProgress = items.filter(i => i.status === '進行中').length;
            const overdue = items.filter(i => { if (i.status === '完了' || !i.due) return false; return new Date(i.due) < now; }).length;
            return { items, stats: { total: items.length, completed, inProgress, overdue } };
        } catch (error) {
            logger.warn('Portal: Failed to fetch tasks', { baseId, error: error.message });
            return { items: [], stats: { total: 0, completed: 0, inProgress: 0, overdue: 0 } };
        }
    }

    async function fetchSprints(baseId) {
        try {
            const records = await nocodbService._fetchRecords(baseId, 'スプリント');
            const items = records.map(r => ({ id: r.Id ?? r.id, period: r['期間'] || '', startDate: r['開始日'] || '', endDate: r['終了日'] || '', goals: r['目標'] || '', completed: r['完了事項'] || '', blockers: r['ブロッカー'] || '', learnings: r['学び'] || '', nextWeek: r['来週の予定'] || '' }));
            return items.sort((a, b) => { if (!a.startDate && !b.startDate) return 0; if (!a.startDate) return 1; if (!b.startDate) return -1; return new Date(b.startDate) - new Date(a.startDate); });
        } catch (error) {
            logger.warn('Portal: Failed to fetch sprints', { baseId, error: error.message });
            return [];
        }
    }

    async function fetchShips(baseId) {
        try {
            const records = await nocodbService._fetchRecords(baseId, 'シップ');
            return records.map(r => ({ id: r.Id ?? r.id, title: r['タイトル'] || '', type: r['Ship種別'] || '', status: r['ステータス'] || '', assignee: r['担当者'] || '', shippedAt: r['出荷日'] || '', evidenceUrl: r['証跡URL'] || '', description: r['説明'] || '' }));
        } catch (error) {
            logger.warn('Portal: Failed to fetch ships', { baseId, error: error.message });
            return [];
        }
    }

    async function fetchValueLoop(baseId, projectCode) {
        try {
            const [vMilestones, vIssues, vTasks, vSprints, vShips] = await Promise.all([
                fetchMilestones(baseId), fetchIssues(baseId), fetchTasks(baseId), fetchSprints(baseId), fetchShips(baseId)
            ]);
            const activeMilestones = vMilestones.filter(m => m.status !== '完了');
            const highImpactIssues = (vIssues.items || []).filter(i => i.impact === 'high');
            let recentDecisions = [];
            if (infoSSOTService?.pool) {
                try {
                    const client = await infoSSOTService.pool.connect();
                    try {
                        const { rows } = await client.query('SELECT title, chosen, reason, decided_at FROM decisions WHERE project_id IN (SELECT id FROM projects WHERE code = $1) ORDER BY decided_at DESC LIMIT 5', [projectCode]);
                        recentDecisions = rows.map(r => ({ title: r.title, chosen: r.chosen, reason: r.reason, decidedAt: r.decided_at }));
                    } finally { client.release(); }
                } catch (err) { logger.warn('Portal: Failed to fetch decisions for value loop', { projectCode, error: err.message }); }
            }
            const currentSprint = vSprints[0] || null;
            const activeTasks = (vTasks.items || []).filter(t => t.status === '進行中' || t.status === '未着手');
            const now = new Date();
            const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            const activeShips = vShips.filter(s => { if (s.status === 'in_progress' || s.status === 'in_review') return true; if (s.shippedAt && new Date(s.shippedAt) >= weekAgo) return true; return false; });
            const learnings = vSprints.filter(s => s.learnings).map(s => ({ period: s.period, learnings: s.learnings })).slice(0, 3);
            return { decision: { milestones: activeMilestones, issues: highImpactIssues, decisions: recentDecisions }, work: { currentSprint, tasks: activeTasks }, ship: { items: activeShips }, learn: { retrospectives: learnings } };
        } catch (error) {
            logger.warn('Portal: Failed to fetch value loop', { baseId, projectCode, error: error.message });
            return { decision: {}, work: {}, ship: {}, learn: {} };
        }
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

    async function fetchHealth(baseId) {
        try {
            const stat = await nocodbService.getProjectStats(baseId);
            const taskCompletion = stat.completionRate || 0;
            const overdueScore = Math.max(0, 100 - (stat.overdue * 10));
            const blockedScore = Math.max(0, 100 - (stat.blocked * 20));
            const milestoneProgress = stat.averageProgress || 0;
            const score = Math.round((taskCompletion * 0.3) + (overdueScore * 0.2) + (blockedScore * 0.2) + (milestoneProgress * 0.3));
            return { score, ...stat };
        } catch (error) {
            logger.warn('Portal: Failed to fetch health', { baseId, error: error.message });
            return { score: 0 };
        }
    }

    return router;
}
