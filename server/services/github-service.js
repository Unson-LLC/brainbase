import { Octokit } from '@octokit/rest';

/**
 * GitHub API Service
 * GitHub Actionsセルフホストランナーとワークフロー情報を取得
 */
export class GitHubService {
    constructor() {
        this.token = process.env.GITHUB_TOKEN;
        if (!this.token) {
            console.warn('[GitHubService] GITHUB_TOKEN not set. GitHub API features will be limited.');
        }

        this.octokit = new Octokit({
            auth: this.token,
        });

        // デフォルト設定（環境変数で上書き可能）
        this.owner = process.env.GITHUB_OWNER || 'Unson-LLC';
        this.repo = process.env.GITHUB_REPO || 'brainbase';
    }

    /**
     * セルフホストランナーの一覧取得
     * @returns {Promise<Array>} ランナー情報の配列
     */
    async getSelfHostedRunners() {
        if (!this.token) {
            return { error: 'GITHUB_TOKEN not configured', runners: [] };
        }

        try {
            const { data } = await this.octokit.rest.actions.listSelfHostedRunnersForRepo({
                owner: this.owner,
                repo: this.repo,
            });

            const runners = data.runners.map(runner => ({
                id: runner.id,
                name: runner.name,
                os: runner.os,
                status: runner.status, // online, offline
                busy: runner.busy,
                labels: runner.labels.map(l => l.name),
            }));

            return {
                total: data.total_count,
                runners,
                online: runners.filter(r => r.status === 'online').length,
                busy: runners.filter(r => r.busy).length,
            };
        } catch (error) {
            console.error('[GitHubService] Failed to fetch runners:', error.message);
            return { error: error.message, runners: [] };
        }
    }

    /**
     * ワークフロー実行履歴取得
     * @param {number} limit - 取得件数（デフォルト: 10）
     * @returns {Promise<Array>} ワークフロー実行履歴
     */
    async getWorkflowRuns(limit = 10) {
        if (!this.token) {
            return { error: 'GITHUB_TOKEN not configured', runs: [] };
        }

        try {
            const { data } = await this.octokit.rest.actions.listWorkflowRunsForRepo({
                owner: this.owner,
                repo: this.repo,
                per_page: limit,
            });

            const runs = data.workflow_runs.map(run => ({
                id: run.id,
                name: run.name,
                status: run.status, // queued, in_progress, completed
                conclusion: run.conclusion, // success, failure, cancelled, skipped
                createdAt: run.created_at,
                updatedAt: run.updated_at,
                htmlUrl: run.html_url,
                event: run.event, // push, pull_request, schedule, etc.
            }));

            const summary = {
                total: runs.length,
                success: runs.filter(r => r.conclusion === 'success').length,
                failure: runs.filter(r => r.conclusion === 'failure').length,
                inProgress: runs.filter(r => r.status === 'in_progress').length,
            };

            return {
                runs,
                summary,
            };
        } catch (error) {
            console.error('[GitHubService] Failed to fetch workflow runs:', error.message);
            return { error: error.message, runs: [] };
        }
    }

    /**
     * 特定のワークフローの実行履歴取得
     * @param {string} workflowId - ワークフローID（ファイル名 or ID）
     * @param {number} limit - 取得件数
     * @returns {Promise<Array>} ワークフロー実行履歴
     */
    async getWorkflowRunsByName(workflowId, limit = 10) {
        if (!this.token) {
            return { error: 'GITHUB_TOKEN not configured', runs: [] };
        }

        try {
            const { data } = await this.octokit.rest.actions.listWorkflowRuns({
                owner: this.owner,
                repo: this.repo,
                workflow_id: workflowId,
                per_page: limit,
            });

            const runs = data.workflow_runs.map(run => ({
                id: run.id,
                name: run.name,
                status: run.status,
                conclusion: run.conclusion,
                createdAt: run.created_at,
                updatedAt: run.updated_at,
                htmlUrl: run.html_url,
            }));

            return { runs };
        } catch (error) {
            console.error(`[GitHubService] Failed to fetch workflow runs for ${workflowId}:`, error.message);
            return { error: error.message, runs: [] };
        }
    }

    /**
     * [OSS] Healthcheckワークフローの最新実行結果取得
     * mana（Slack Bot）とself-hosted runnersの健全性をチェック
     *
     * コメントアウト理由:
     * - mana (Slack AI PMエージェント) はAWS Lambda上で動作
     * - OSSユーザーはmanaを利用不可のため、このメソッドは無効化
     * - brainbase-workspaceリポジトリへのアクセスも必要
     * - mana連携機能を利用するには、Unson LLCの有償サポートが必要
     *
     * 復元方法: 下記のコメントを解除し、brainbase.jsのエンドポイントも復元する
     *
     * @returns {Promise<Object>} ヘルスチェック結果
     */
    /*
    async getHealthcheckStatus() {
        if (!this.token) {
            return {
                status: 'unknown',
                message: 'GITHUB_TOKEN not configured',
                lastRun: null,
            };
        }

        try {
            // brainbase-workspaceリポジトリのhealthcheckワークフロー取得
            const { data } = await this.octokit.rest.actions.listWorkflowRuns({
                owner: this.owner,
                repo: 'brainbase-workspace',
                workflow_id: 'actions-healthcheck.yml',
                per_page: 1,
                branch: 'main',
            });

            if (data.workflow_runs.length === 0) {
                return {
                    status: 'unknown',
                    message: 'No healthcheck runs found',
                    lastRun: null,
                };
            }

            const latestRun = data.workflow_runs[0];

            // Job情報を取得して詳細を確認
            const { data: jobsData } = await this.octokit.rest.actions.listJobsForWorkflowRun({
                owner: this.owner,
                repo: 'brainbase-workspace',
                run_id: latestRun.id,
            });

            const failedSteps = [];
            const allSteps = [];
            const jobSummary = jobsData.jobs.map(job => {
                const failed = job.steps.filter(step => step.conclusion === 'failure');
                failedSteps.push(...failed.map(step => ({
                    jobName: job.name,
                    stepName: step.name,
                    conclusion: step.conclusion,
                })));

                allSteps.push(...job.steps.map(step => ({
                    jobName: job.name,
                    stepName: step.name,
                    conclusion: step.conclusion,
                    status: step.status,
                })));

                return {
                    name: job.name,
                    conclusion: job.conclusion,
                    failedSteps: failed.length,
                    steps: job.steps.map(s => ({
                        name: s.name,
                        conclusion: s.conclusion,
                        status: s.status,
                    })),
                };
            });

            const status = latestRun.conclusion === 'success' ? 'healthy' :
                          latestRun.conclusion === 'failure' ? 'error' : 'warning';

            const manaStep = allSteps.find(s => s.stepName === 'Check Lambda errors');
            const runnersStep = allSteps.find(s => s.stepName === 'Check workflows and runners');

            const manaStatus = manaStep ?
                (manaStep.conclusion === 'success' ? 'healthy' :
                 manaStep.conclusion === 'failure' ? 'error' : 'warning') : 'unknown';

            const runnersStatus = runnersStep ?
                (runnersStep.conclusion === 'success' ? 'healthy' :
                 runnersStep.conclusion === 'failure' ? 'error' : 'warning') : 'unknown';

            return {
                status,
                lastRun: {
                    id: latestRun.id,
                    created_at: latestRun.created_at,
                    updated_at: latestRun.updated_at,
                    conclusion: latestRun.conclusion,
                    html_url: latestRun.html_url,
                },
                jobs: jobSummary,
                failedSteps: failedSteps,
                allSteps: allSteps,
                mana: {
                    status: manaStatus,
                    step: manaStep || null,
                },
                runners: {
                    status: runnersStatus,
                    step: runnersStep || null,
                },
                summary: {
                    totalJobs: jobsData.jobs.length,
                    failedJobs: jobsData.jobs.filter(j => j.conclusion === 'failure').length,
                    failedStepsCount: failedSteps.length,
                },
            };
        } catch (error) {
            console.error('[GitHubService] Failed to fetch healthcheck status:', error.message);
            return {
                status: 'error',
                message: error.message,
                lastRun: null,
            };
        }
    }
    */
}
