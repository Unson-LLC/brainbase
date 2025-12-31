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
}
