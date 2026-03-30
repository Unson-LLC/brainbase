import express from 'express';
import { execSync } from 'child_process';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { fromIni } from '@aws-sdk/credential-providers';
import { logger } from '../../utils/logger.js';
import { cacheMiddleware } from '../../middleware/cache.js';
import { asyncHandler } from '../../lib/async-handler.js';

export function createBrainbaseManaRouter(options = {}) {
    const router = express.Router();
    const { manaRepoPath } = options;
    const manaHistoryConfig = {
        tableName: process.env.MANA_MESSAGE_HISTORY_TABLE || process.env.MESSAGE_HISTORY_TABLE_NAME || 'mana-message-history',
        region: process.env.MANA_AWS_REGION || process.env.AWS_REGION || 'us-east-1',
        profile: process.env.MANA_AWS_PROFILE || process.env.AWS_PROFILE || null
    };
    let manaHistoryClient = null;

    const getManaHistoryClient = () => {
        if (manaHistoryClient) return manaHistoryClient;
        const clientConfig = { region: manaHistoryConfig.region };
        if (manaHistoryConfig.profile) {
            clientConfig.credentials = fromIni({ profile: manaHistoryConfig.profile });
        }
        const dynamoClient = new DynamoDBClient(clientConfig);
        manaHistoryClient = DynamoDBDocumentClient.from(dynamoClient);
        return manaHistoryClient;
    };

    /**
     * GET /api/brainbase/mana-workflow-stats
     * Manaワークフロー統計を取得（GitHub Actions履歴から）
     * @query {string} workflow_id - ワークフローID（オプション: 指定なしで全体統計）
     */
    // TTL: 5分（GitHub API rate limit対策）
    router.get('/mana-workflow-stats', cacheMiddleware(300), asyncHandler(async (req, res) => {
        const { workflow_id } = req.query;

        // workflow_id → GitHub Actionsファイル名のマッピング
        const WORKFLOW_MAPPING = {
            'm1': { file: 'mana-m1-morning.yml', name: 'M1: 朝のブリーフィング' },
            'm2': { file: 'mana-m2-blocker.yml', name: 'M2: ブロッカー早期発見' },
            'm3': { file: 'mana-m3-reminder.yml', name: 'M3: 期限前リマインド' },
            'm4': { file: 'mana-m4-overdue.yml', name: 'M4: 期限超過アラート' },
            'm5': { file: 'mana-m5-context.yml', name: 'M5: コンテキスト収集' },
            'm6': { file: 'mana-m6-progress.yml', name: 'M6: 進捗レポート' },
            'm7': { file: 'mana-m7-executive.yml', name: 'M7: エグゼクティブサマリー' },
            'm8': { file: 'mana-m8-gm.yml', name: 'M8: GM向けレポート' },
            'm9': { file: 'mana-m9-weekly.yml', name: 'M9: 週次レポート' },
            'm10': { file: 'mana-m10-reminder.yml', name: 'M10: リマインダー' },
            'm11': { file: 'mana-m11-followup.yml', name: 'M11: フォローアップ' },
            'm12': { file: 'mana-m12-onboarding.yml', name: 'M12: オンボーディング' }
        };

        // バリデーション: workflow_idが空文字列の場合はエラー
        if (workflow_id === '') {
            return res.status(400).json({
                error: 'Invalid workflow_id',
                message: 'workflow_id cannot be an empty string'
            });
        }

        // テストモード: モックデータを返す
        if (req.query.test === 'true') {
            const mapping = WORKFLOW_MAPPING[workflow_id];
            // テスト用: ランダムな成功率を生成
            const successRate = Math.floor(Math.random() * 40) + 60; // 60-100%
            const totalExecutions = Math.floor(Math.random() * 50) + 10; // 10-60
            const successCount = Math.floor(totalExecutions * successRate / 100);
            const failureCount = totalExecutions - successCount;

            return res.json({
                workflow_id: workflow_id,
                workflow_name: mapping?.name || workflow_id,
                stats: {
                    success_rate: successRate,
                    total_executions: totalExecutions,
                    total_success: successCount,
                    total_failure: failureCount,
                    avg_duration_ms: Math.floor(Math.random() * 2000) + 500
                }
            });
        }

        // GitHub Actions履歴を取得
        const mapping = WORKFLOW_MAPPING[workflow_id];
        if (!mapping) {
            return res.status(400).json({
                error: 'Unknown workflow_id',
                message: `workflow_id '${workflow_id}' is not recognized`
            });
        }

        const ghCommand = `gh run list --workflow=${mapping.file} --limit 30 --json conclusion,createdAt,status`;

        let runs = [];
        try {
            // manaリポジトリで実行（GitHub Actionsがある場所）
            const execOptions = {
                encoding: 'utf-8',
                timeout: 10000
            };
            if (manaRepoPath) {
                execOptions.cwd = manaRepoPath;
            }
            const output = execSync(ghCommand, execOptions);
            runs = JSON.parse(output);
        } catch (ghError) {
            logger.warn('gh CLI failed, returning empty stats', { error: ghError.message, workflow_id });
            // gh CLIが失敗した場合は空のデータを返す
            return res.json({
                workflow_id: workflow_id,
                workflow_name: mapping.name,
                stats: {
                    success_rate: 0,
                    total_executions: 0,
                    total_success: 0,
                    total_failure: 0,
                    avg_duration_ms: 0
                }
            });
        }

        // 統計を計算
        const total = runs.length;
        const success = runs.filter(r => r.conclusion === 'success').length;
        const failure = runs.filter(r => r.conclusion === 'failure').length;
        const successRate = total > 0 ? Math.round((success / total) * 100) : 0;

        res.json({
            workflow_id: workflow_id,
            workflow_name: mapping.name,
            stats: {
                success_rate: successRate,
                total_executions: total,
                total_success: success,
                total_failure: failure,
                avg_duration_ms: 0 // GitHub APIでは取得不可
            }
        });
    }));

    /**
     * GET /api/brainbase/mana-message-history
     * Manaメッセージ送信履歴を取得（DynamoDB）
     * @query {string} workflow_id - ワークフローID（例: m1, m2）
     * @query {number} limit - 取得件数（デフォルト: 20, 最大: 200）
     * @query {string} target_id - 送信先ID（任意）
     * @query {string} status - statusフィルタ（任意）
     */
    router.get('/mana-message-history', cacheMiddleware(30), asyncHandler(async (req, res) => {
        const workflowId = req.query.workflow_id || req.query.workflowId;
        if (!workflowId || typeof workflowId !== 'string') {
            return res.status(400).json({
                error: 'Invalid workflow_id',
                message: 'workflow_id is required'
            });
        }

        const limitRaw = parseInt(req.query.limit, 10);
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 20;
        const targetId = req.query.target_id || req.query.targetId || null;
        const status = req.query.status || null;

        const client = getManaHistoryClient();

        const expressionValues = { ':pk': workflowId };
        const expressionNames = {};
        const filters = [];

        if (targetId) {
            expressionValues[':target_id'] = targetId;
            filters.push('target_id = :target_id');
        }
        if (status) {
            expressionValues[':status'] = status;
            expressionNames['#status'] = 'status';
            filters.push('#status = :status');
        }

        const queryInput = {
            TableName: manaHistoryConfig.tableName,
            KeyConditionExpression: 'pk = :pk',
            ExpressionAttributeValues: expressionValues,
            ScanIndexForward: false,
            Limit: limit
        };

        if (filters.length > 0) {
            queryInput.FilterExpression = filters.join(' AND ');
            if (Object.keys(expressionNames).length > 0) {
                queryInput.ExpressionAttributeNames = expressionNames;
            }
        }

        const result = await client.send(new QueryCommand(queryInput));
        const items = (result.Items || []).map((item) => ({
            workflow_id: item.mx_id || item.pk,
            sent_at: item.sent_at,
            target_type: item.target_type,
            target_id: item.target_id,
            status: item.status,
            text: item.text,
            excerpt: item.excerpt,
            error: item.error,
            project_id: item.project_id,
            message_ts: item.message_ts,
            channel_id: item.channel_id,
            thread_ts: item.thread_ts,
            workspace: item.workspace,
            run_id: item.run_id,
            task_ids: item.task_ids
        }));

        res.json({
            workflow_id: workflowId,
            count: items.length,
            items
        });
    }));

    return router;
}
