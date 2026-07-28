// @ts-check
import { logger } from '../utils/logger.js';

/** @typedef {any} Request */
/** @typedef {any} Response */
/** @typedef {{ id: string, name: string, local?: { path?: string }, description?: string }} SetupProject */
/** @typedef {{ id: string, name: string }} SetupPerson */

/**
 * Setup API Controller
 * ユーザーのプロジェクト設定を取得し、config.ymlを生成する
 */
export class SetupController {
    /**
     * @param {any} authService
     * @param {any} infoSsotService
     * @param {any} configParser
     */
    constructor(authService, infoSsotService, configParser) {
        this.authService = authService;
        this.infoSsotService = infoSsotService;
        this.configParser = configParser;
    }

    /**
     * GET /api/setup/config
     * 認証済みユーザーのセットアップ設定を返す
     */
    /** @param {Request & { access?: { slackUserId?: string, slackWorkspaceId?: string, projectCodes?: string[] } }} req @param {Response} res */
    getSetupConfig = async (req, res) => {
        try {
            const access = req.access;
            if (!access || !access.slackUserId || !access.slackWorkspaceId) {
                return res.status(401).json({ ok: false, error: 'Unauthorized' });
            }

            const { slackUserId, slackWorkspaceId: workspaceId } = access;

            // 1. 人物情報を取得
            const person = await this.infoSsotService.getPersonBySlackId(slackUserId, workspaceId);
            if (!person) {
                logger.warn('Person not found in setup', { slackUserId, workspaceId });
                return res.status(404).json({ ok: false, error: 'Person not found' });
            }

            // 2. 認証時にGraph auth_grantsから検証済みのプロジェクト権限を使う。
            // 本番サーバーの個人用config.ymlやRACI表示情報には依存させない。
            const projectCodes = Array.from(new Set(access.projectCodes || []));
            const assignedProjects = /** @type {SetupProject[]} */ (projectCodes.map((code) => ({
                id: code,
                name: code
            })));

            // 3. config.yaml を生成
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
                projects: assignedProjects.map((p) => ({
                    id: p.id,
                    name: p.name,
                    description: p.description || ''
                })),
                configYaml
            });
        } catch (error) {
            logger.error('Setup config error', { error: error instanceof Error ? error.message : String(error) });
            res.status(500).json({ ok: false, error: 'Failed to generate setup config' });
        }
    };

    /**
     * YAML生成ヘルパー
     */
    /** @param {SetupPerson} person @param {SetupProject[]} projects */
    generateConfigYaml(person, projects) {
        const yamlContent = `# brainbase config.yml
# Generated for: ${person.name} (${person.id})

# Workspace root (adjust for your environment)
workspace_root: \${HOME}/workspace

# Projects
projects:
${projects.map((p) => {
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
