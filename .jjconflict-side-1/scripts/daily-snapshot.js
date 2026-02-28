import path from 'path';
import { NocoDBService } from '../server/services/nocodb-service.js';
import { ConfigParser } from '../lib/config-parser.js';
import { logger } from '../server/utils/logger.js';

/**
 * 毎日のプロジェクト健全性スナップショット収集スクリプト
 * GitHub Actionsから実行される
 */

async function main() {
    try {
        logger.info('Starting daily snapshot collection...');

        // 1. ConfigParserを初期化（環境変数優先）
        const brainbaseRoot = process.env.BRAINBASE_ROOT || path.resolve(process.cwd(), 'shared');
        const configPath = process.env.BRAINBASE_CONFIG_PATH || path.join(brainbaseRoot, 'config.yml');
        const codexPath = path.join(brainbaseRoot, '_codex');
        const projectsRoot = process.env.PROJECTS_ROOT || path.join(path.dirname(brainbaseRoot), 'projects');
        const configParser = new ConfigParser(codexPath, configPath, brainbaseRoot, projectsRoot);

        // 2. NocoDBServiceを初期化
        const nocodbService = new NocoDBService();

        // 3. 全プロジェクトの取得
        const config = await configParser.getAll();
        const projects = (config.projects?.projects || [])
            .filter(p => !p.archived && p.nocodb?.project_id)
            .map(p => ({ id: p.id, project_id: p.nocodb.project_id }));

        logger.info(`Found ${projects.length} active projects with NocoDB configuration`);

        // 4. 各プロジェクトのスナップショット収集
        const today = new Date().toISOString().split('T')[0];
        let successCount = 0;
        let errorCount = 0;

        for (const project of projects) {
            try {
                logger.info(`Processing project: ${project.id}`);

                // 統計取得
                const stats = await nocodbService.getProjectStats(project.project_id);

                // 健全性スコア計算
                const healthScore = calculateHealthScore(stats);

                // スナップショットデータ準備
                const snapshotData = {
                    project_id: project.id,
                    snapshot_date: today,
                    total_tasks: stats.total || 0,
                    completed_tasks: stats.completed || 0,
                    overdue_tasks: stats.overdue || 0,
                    blocked_tasks: stats.blocked || 0,
                    completion_rate: stats.completionRate || 0,
                    milestone_progress: stats.averageProgress || 0,
                    health_score: healthScore
                };

                // NocoDBに挿入
                await nocodbService.insertSnapshot(snapshotData);

                logger.info(`Successfully saved snapshot for project: ${project.id} (health score: ${healthScore})`);
                successCount++;
            } catch (error) {
                logger.error(`Failed to process project: ${project.id}`, { error });
                errorCount++;
            }
        }

        logger.info(`Snapshot collection completed: ${successCount} succeeded, ${errorCount} failed`);

        // 5. 終了ステータス
        if (errorCount > 0) {
            process.exit(1); // 一部失敗
        }
        process.exit(0); // 全成功

    } catch (error) {
        logger.error('Fatal error in daily snapshot script', { error });
        process.exit(1);
    }
}

/**
 * 健全性スコア計算
 * @param {Object} stats - プロジェクト統計
 * @returns {number} 健全性スコア (0-100)
 */
function calculateHealthScore(stats) {
    const taskCompletion = stats.completionRate || 0;
    const overdueScore = Math.max(0, 100 - (stats.overdue * 10));
    const blockedScore = Math.max(0, 100 - (stats.blocked * 20));
    const milestoneProgress = stats.averageProgress || 0;

    return Math.round(
        (taskCompletion * 0.3) +
        (overdueScore * 0.2) +
        (blockedScore * 0.2) +
        (milestoneProgress * 0.3)
    );
}

// スクリプト実行
main().catch(error => {
    logger.error('Unhandled error in daily snapshot script', { error });
    process.exit(1);
});
