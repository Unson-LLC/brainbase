import { logger } from '../utils/logger.js';

/**
 * Setup API Controller
 * ユーザーのプロジェクト設定を取得し、config.ymlを生成する
 */
export class SetupController {
    constructor(authService, infoSsotService, configParser) {
        this.authService = authService;
        this.infoSsotService = infoSsotService;
        this.configParser = configParser;
    }

    /**
     * GET /api/setup/config
     * 認証済みユーザーのセットアップ設定を返す
     */
    getSetupConfig = async (req, res) => {
        try {
            const access = req.access;
            if (!access || !access.slackUserId || !access.workspaceId) {
                return res.status(401).json({ ok: false, error: 'Unauthorized' });
            }

            const { slackUserId, workspaceId } = access;

            // 1. 人物情報を取得
            const person = await this.infoSsotService.getPersonBySlackId(slackUserId, workspaceId);
            if (!person) {
                logger.warn('Person not found in setup', { slackUserId, workspaceId });
                return res.status(404).json({ ok: false, error: 'Person not found' });
            }

            // 2. プロジェクト割り当てを取得（RACI権限ベース）
            const assignments = await this.infoSsotService.getProjectAssignments(person.id);

            // 3. config.ymlのプロジェクト一覧を取得
            const { projects: allProjects } = await this.configParser.getProjects();

            // 4. 権限のあるプロジェクトのみフィルタリング
            const projectIds = assignments.map(a => a.project_id);
            const assignedProjects = allProjects.filter(p => projectIds.includes(p.id));

            // 5. config.yaml を生成
            const configYaml = this.generateConfigYaml(person, assignedProjects);

            logger.info('Setup config generated', {
                personId: person.id,
                projectCount: assignedProjects.length
            });

            res.json({
                ok: true,
                user: {
                    id: person.id,
                    name: person.name,
                    slackUserId,
                    workspaceId
                },
                projects: assignedProjects.map(p => ({
                    id: p.id,
                    name: p.name,
                    description: p.description || ''
                })),
                configYaml
            });
        } catch (error) {
            logger.error('Setup config error', { error: error.message });
            res.status(500).json({ ok: false, error: 'Failed to generate setup config' });
        }
    };

    /**
     * YAML生成ヘルパー
     */
    generateConfigYaml(person, projects) {
        const yamlContent = `# brainbase config.yml
# Generated for: ${person.name} (${person.id})

# Workspace root (adjust for your environment)
workspace_root: \${HOME}/workspace

# Projects
projects:
${projects.map(p => {
    let projectYaml = `  - id: ${p.id}\n    name: ${p.name}`;
    if (p.description) {
        projectYaml += `\n    description: ${p.description}`;
    }
    if (p.local && p.local.path) {
        projectYaml += `\n    local:\n      path: ${p.local.path}`;
    }
    return projectYaml;
}).join('\n\n')}
`;
        return yamlContent;
    }
}
