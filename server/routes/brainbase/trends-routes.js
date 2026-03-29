import express from 'express';
import { logger } from '../../utils/logger.js';
import { cacheMiddleware } from '../../middleware/cache.js';
import { asyncHandler } from '../../lib/async-handler.js';

/**
 * トレンド分析APIルーター
 */
export function createBrainbaseTrendsRouter(options = {}) {
    const router = express.Router();
    const { nocodbService, configParser } = options;

    /**
     * GET /api/brainbase/trends
     * プロジェクトの健全性トレンド取得（過去N日間の履歴データ）
     *
     * @query {string} project_id - プロジェクトID（必須）
     * @query {number} days - 取得日数（デフォルト: 30日）
     *
     * @returns {Object} トレンドデータ
     *   - project_id: プロジェクトID
     *   - snapshots: 過去N日間のスナップショット一覧
     *   - trend_analysis: トレンド分析結果（up/down/stable, health_score変化量, alert_level）
     */
    router.get('/trends', asyncHandler(async (req, res) => {
        const projectId = req.query.project_id;
        const days = parseInt(req.query.days) || 30;

        if (!projectId) {
            return res.status(400).json({
                error: 'project_id is required',
                message: 'Please provide a project_id query parameter'
            });
        }

        const trends = await nocodbService.getTrends(projectId, days);

        res.json(trends);
    }));

    /**
     * GET /api/brainbase/trends/heatmap
     * 全プロジェクトの8週分トレンドをヒートマップ形式で返す
     * Story 4: 構造的な問題を見抜く
     *
     * @query {number} weeks - 取得週数（デフォルト: 8週）
     * @query {string} test - 'true'でテストデータを返す
     *
     * @returns {Object} ヒートマップデータ
     *   - heatmap: 各プロジェクトの週次データ配列
     *   - chronic_alerts: 慢性的止まりプロジェクトのアラート配列
     */
    router.get('/trends/heatmap', cacheMiddleware(600), asyncHandler(async (req, res) => {
        const weeks = parseInt(req.query.weeks) || 8;

        if (req.query.test === 'true') {
            const generateTestHeatmap = (projectId, baseHealth, trend) => {
                const weekData = [];
                let health = baseHealth;
                for (let i = 1; i <= weeks; i++) {
                    health += trend === 'up' ? Math.floor(Math.random() * 5) :
                        trend === 'down' ? -Math.floor(Math.random() * 8) :
                            (Math.random() > 0.5 ? 2 : -2);
                    health = Math.max(20, Math.min(100, health));
                    weekData.push({
                        week: `W${i}`,
                        health_score: health,
                        status: health >= 80 ? 'healthy' : health >= 60 ? 'warning' : 'critical',
                        data_points: 7
                    });
                }
                return {
                    project_id: projectId,
                    weeks: weekData,
                    trend_analysis: {
                        trend,
                        health_score_change: weekData[weeks - 1].health_score - weekData[0].health_score,
                        alert_level: trend === 'down' && health < 60 ? 'chronic' : 'none',
                        chronic_stall: trend === 'down' && health < 60 ? { days: 18, threshold: 60 } : null
                    }
                };
            };

            const testHeatmap = [
                generateTestHeatmap('salestailor', 75, 'up'),
                generateTestHeatmap('zeims', 65, 'stable'),
                generateTestHeatmap('tech-knight', 55, 'down'),
                generateTestHeatmap('baao', 80, 'up'),
                generateTestHeatmap('brainbase', 70, 'stable'),
                generateTestHeatmap('dialogai', 45, 'down'),
            ];

            const chronicAlerts = testHeatmap
                .filter(p => p.trend_analysis.chronic_stall)
                .map(p => ({ project_id: p.project_id, stall_info: p.trend_analysis.chronic_stall }));

            return res.json({
                heatmap: testHeatmap,
                chronic_alerts: chronicAlerts,
                weeks_requested: weeks,
                generated_at: new Date().toISOString()
            });
        }

        const days = weeks * 7;
        const config = await configParser.getAll();
        const projects = (config.projects?.projects || [])
            .filter(p => !p.archived && p.nocodb?.project_id)
            .map(p => ({ id: p.id, project_id: p.nocodb.project_id }));

        const heatmapData = await Promise.all(
            projects.map(async (project) => {
                try {
                    const trends = await nocodbService.getTrends(project.project_id, days);
                    const weeklyData = aggregateToWeekly(trends.snapshots, weeks);
                    return {
                        project_id: project.id,
                        weeks: weeklyData,
                        trend_analysis: trends.trend_analysis
                    };
                } catch (error) {
                    logger.error(`Failed to get trends for project ${project.id}`, { error });
                    return {
                        project_id: project.id,
                        weeks: [],
                        trend_analysis: {
                            trend: 'unknown',
                            health_score_change: 0,
                            alert_level: 'none',
                            chronic_stall: null
                        }
                    };
                }
            })
        );

        const chronicAlerts = heatmapData
            .filter(p => p.trend_analysis.chronic_stall)
            .map(p => ({
                project_id: p.project_id,
                stall_info: p.trend_analysis.chronic_stall
            }));

        res.json({
            heatmap: heatmapData,
            chronic_alerts: chronicAlerts,
            weeks_requested: weeks,
            generated_at: new Date().toISOString()
        });
    }));

    return router;
}

/**
 * 日次データを週次に集約
 * @param {Array} snapshots - 日次スナップショット（降順）
 * @param {number} numWeeks - 週数
 * @returns {Array} 週次集約データ
 */
function aggregateToWeekly(snapshots, numWeeks) {
    const weeks = [];

    for (let w = 0; w < numWeeks; w++) {
        const startIdx = w * 7;
        const endIdx = startIdx + 7;
        const weekSnapshots = snapshots.slice(startIdx, endIdx);

        if (weekSnapshots.length === 0) {
            weeks.push({
                week: `W${w + 1}`,
                health_score: null,
                status: 'no_data',
                data_points: 0
            });
            continue;
        }

        const scores = weekSnapshots.map(s => s.health_score || 0);
        const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

        let status = 'healthy';
        if (avgScore < 60) {
            status = 'critical';
        } else if (avgScore < 80) {
            status = 'warning';
        }

        weeks.push({
            week: `W${w + 1}`,
            health_score: avgScore,
            status,
            data_points: weekSnapshots.length
        });
    }

    return weeks;
}
