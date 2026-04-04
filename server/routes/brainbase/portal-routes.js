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
     * GET /api/brainbase/portal/:projectCode
     * プロ��ェクトポータルの全データを集約して返す
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

        // 全データを並行取得
        const [direction, issues, milestones, tasks, members, health] = await Promise.all([
            fetchDirection(projectCode),
            nocodbBaseId ? fetchIssues(nocodbBaseId) : { items: [], stats: { open: 0, highImpact: 0 } },
            nocodbBaseId ? fetchMilestones(nocodbBaseId) : [],
            nocodbBaseId ? fetchTasks(nocodbBaseId) : { items: [], stats: { total: 0, completed: 0, inProgress: 0, overdue: 0 } },
            fetchMembers(projectCode),
            nocodbBaseId ? fetchHealth(nocodbBaseId) : { score: 0 }
        ]);

        res.json({
            project: { code: projectCode, name: projectConfig.name || projectCode },
            direction,
            issues,
            milestones,
            tasks,
            members,
            health,
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

            // member権限でアクセス（ポータルは全メンバー閲覧��能）
            const access = { role: 'member', roleRank: 1, clearance: ['internal'], projectCodes: [projectCode] };
            const result = await wikiService.getPage(access, `${projectCode}/project.md`);

            if (result.error) {
                // project.md が無い場合はフォールバック
                const fallback = await wikiService.getPage(access, `${projectCode}/README.md`);
                if (fallback.error) {
                    return { title: 'project.md', content: '', available: false };
                }
                return { title: fallback.title || 'README.md', content: fallback.content, available: true };
            }

            return { title: result.title || 'project.md', content: result.content, available: true };
        } catch (error) {
            logger.warn('Portal: Failed to fetch direction', { projectCode, error: error.message });
            return { title: '', content: '', available: false };
        }
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
            return {
                items: openItems,
                stats: {
                    open: openItems.length,
                    highImpact: openItems.filter(i => i.impact === 'high').length
                }
            };
        } catch (error) {
            logger.warn('Portal: Failed to fetch issues', { baseId, error: error.message });
            return { items: [], stats: { open: 0, highImpact: 0 } };
        }
    }

    async function fetchMilestones(baseId) {
        try {
            const records = await nocodbService._fetchRecords(baseId, 'マイルストーン');
            return records.map(r => ({
                id: r.Id ?? r.id,
                name: r['マイルストー���名'] || r['タイトル'] || '',
                progress: r['進捗率'] ?? 0
            }));
        } catch (error) {
            logger.warn('Portal: Failed to fetch milestones', { baseId, error: error.message });
            return [];
        }
    }

    async function fetchTasks(baseId) {
        try {
            const records = await nocodbService._fetchRecords(baseId, 'タスク');
            const items = records.map(r => ({
                id: r.Id ?? r.id,
                title: r['タイトル'] || '',
                status: r['���テータス'] || '',
                assignee: r['担当者'] || '',
                priority: r['優先度'] || '',
                due: r['期限'] || ''
            }));

            const now = new Date();
            const completed = items.filter(i => i.status === '完了').length;
            const inProgress = items.filter(i => i.status === '進行��').length;
            const overdue = items.filter(i => {
                if (i.status === '完了' || !i.due) return false;
                return new Date(i.due) < now;
            }).length;

            return {
                items,
                stats: {
                    total: items.length,
                    completed,
                    inProgress,
                    overdue
                }
            };
        } catch (error) {
            logger.warn('Portal: Failed to fetch tasks', { baseId, error: error.message });
            return { items: [], stats: { total: 0, completed: 0, inProgress: 0, overdue: 0 } };
        }
    }

    async function fetchMembers(projectCode) {
        try {
            if (!infoSSOTService?.pool) return [];

            const client = await infoSSOTService.pool.connect();
            try {
                // auth_grantsからプロジェクトメンバーを取得
                const { rows: grantRows } = await client.query(
                    `SELECT person_id, person_name, role
                     FROM auth_grants
                     WHERE $1 = ANY(project_codes) AND active = true
                     ORDER BY person_name`,
                    [projectCode]
                );

                // projectsテーブルからproject_idを取得
                const { rows: projectRows } = await client.query(
                    'SELECT id FROM projects WHERE code = $1 LIMIT 1',
                    [projectCode]
                );
                const projectId = projectRows[0]?.id || null;

                // RACI情報を取得
                let raciMap = new Map();
                if (projectId) {
                    const { rows: raciRows } = await client.query(
                        `SELECT person_id, role_code, authority_scope
                         FROM raci_assignments
                         WHERE project_id = $1`,
                        [projectId]
                    );
                    for (const row of raciRows) {
                        if (!raciMap.has(row.person_id)) raciMap.set(row.person_id, []);
                        raciMap.get(row.person_id).push({
                            roleCode: row.role_code,
                            authorityScope: row.authority_scope
                        });
                    }
                }

                return grantRows.map(row => ({
                    personId: row.person_id,
                    name: row.person_name,
                    role: row.role,
                    raciRoles: raciMap.get(row.person_id) || []
                }));
            } finally {
                client.release();
            }
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

            const score = Math.round(
                (taskCompletion * 0.3) +
                (overdueScore * 0.2) +
                (blockedScore * 0.2) +
                (milestoneProgress * 0.3)
            );

            return { score, ...stat };
        } catch (error) {
            logger.warn('Portal: Failed to fetch health', { baseId, error: error.message });
            return { score: 0 };
        }
    }

    return router;
}
