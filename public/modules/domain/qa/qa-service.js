/**
 * QA Loop Service - Auto-Claude QA Loop pattern implementation
 *
 * CLAUDE.md Section 6.3 Orchestrator Review Frameworkの実装
 *
 * 機能:
 * - 4ステップレビュー（ファイル存在、Success Criteria、差分分析、リスク判定）
 * - リプラン実行（5ステップ）
 * - MAX_QA_ITERATIONS管理（3回でエスカレーション）
 * - 類似問題検出（ISSUE_SIMILARITY_THRESHOLD）
 */

import { EVENTS } from '/modules/core/event-bus.js';

/**
 * QA設定値
 */
export const QA_CONFIG = {
    MAX_QA_ITERATIONS: 3,
    ISSUE_SIMILARITY_THRESHOLD: 0.8,
    REVIEW_STEPS: ['file_exists', 'success_criteria', 'diff_analysis', 'risk_assessment']
};

/**
 * QA状態
 */
export const QA_STATUS = {
    PENDING: 'pending',
    RUNNING: 'running',
    REVIEW: 'review',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    REPLAN: 'replan',
    FIXES_APPLIED: 'fixes_applied',
    ESCALATED: 'escalated'
};

/**
 * リスクレベル
 */
export const RISK_LEVEL = {
    NONE: 'none',
    MINOR: 'minor',
    CRITICAL: 'critical'
};

/**
 * QAサービスクラス
 */
export class QAService {
    constructor({ eventBus, store, httpClient }) {
        this.eventBus = eventBus;
        this.store = store;
        this.httpClient = httpClient;
        this.iterations = new Map(); // taskId -> count
        this.issueHistory = new Map(); // taskId -> issues[]
    }

    /**
     * 4ステップレビューを実行
     * @param {string} taskId - タスクID
     * @param {Object} artifacts - 成果物情報
     * @returns {Promise<{status: string, results: Object, riskLevel: string}>}
     */
    async review(taskId, artifacts) {
        await this.eventBus.emit(EVENTS.QA_REVIEW_STARTED, { taskId, artifacts });

        const results = {
            fileExists: await this._checkFileExists(artifacts),
            successCriteria: await this._checkSuccessCriteria(artifacts),
            diffAnalysis: await this._analyzeDiff(artifacts),
            riskAssessment: await this._assessRisk(artifacts)
        };

        const riskLevel = this._determineRiskLevel(results);
        const status = this._determineStatus(riskLevel);

        // Store更新
        const { qa } = this.store.getState();
        const review = {
            taskId,
            timestamp: new Date().toISOString(),
            results,
            riskLevel,
            status
        };
        this.store.setState({
            qa: {
                ...qa,
                currentReviews: [...qa.currentReviews, review],
                history: [...qa.history, review]
            }
        });

        await this.eventBus.emit(EVENTS.QA_REVIEW_COMPLETED, {
            taskId,
            results,
            status,
            riskLevel
        });

        return { status, results, riskLevel };
    }

    /**
     * Step 1: ファイル存在確認
     * @private
     */
    async _checkFileExists(artifacts) {
        const results = [];
        const { files = [] } = artifacts;

        for (const file of files) {
            const exists = file.exists !== undefined ? file.exists : true;
            const notEmpty = file.size > 0;
            const recentlyModified = file.modifiedAfterStart !== undefined
                ? file.modifiedAfterStart
                : true;

            results.push({
                path: file.path,
                exists,
                notEmpty,
                recentlyModified,
                pass: exists && notEmpty && recentlyModified
            });
        }

        return {
            pass: results.every(r => r.pass),
            details: results
        };
    }

    /**
     * Step 2: Success Criteria チェック
     * @private
     */
    async _checkSuccessCriteria(artifacts) {
        const { successCriteria = [] } = artifacts;
        const results = [];

        for (const criteria of successCriteria) {
            results.push({
                id: criteria.id,
                description: criteria.description,
                expected: criteria.expected,
                actual: criteria.actual,
                pass: criteria.actual === criteria.expected
            });
        }

        const passCount = results.filter(r => r.pass).length;
        const totalCount = results.length;

        return {
            pass: passCount === totalCount,
            passCount,
            totalCount,
            details: results
        };
    }

    /**
     * Step 3: 差分分析（要件との整合性）
     * @private
     */
    async _analyzeDiff(artifacts) {
        const { diffs = [] } = artifacts;
        const results = [];

        for (const diff of diffs) {
            const isWithinTolerance = diff.severity !== 'critical';
            results.push({
                area: diff.area,
                expected: diff.expected,
                actual: diff.actual,
                severity: diff.severity || 'none',
                isWithinTolerance
            });
        }

        const criticalDiffs = results.filter(r => r.severity === 'critical');

        return {
            pass: criticalDiffs.length === 0,
            criticalCount: criticalDiffs.length,
            minorCount: results.filter(r => r.severity === 'minor').length,
            details: results
        };
    }

    /**
     * Step 4: リスク判定
     * @private
     */
    async _assessRisk(artifacts) {
        const { risks = [] } = artifacts;
        const results = [];

        for (const risk of risks) {
            results.push({
                type: risk.type,
                description: risk.description,
                level: risk.level || RISK_LEVEL.NONE,
                mitigation: risk.mitigation
            });
        }

        const criticalRisks = results.filter(r => r.level === RISK_LEVEL.CRITICAL);
        const minorRisks = results.filter(r => r.level === RISK_LEVEL.MINOR);

        return {
            pass: criticalRisks.length === 0,
            criticalCount: criticalRisks.length,
            minorCount: minorRisks.length,
            details: results
        };
    }

    /**
     * リスクレベルを判定
     * @private
     */
    _determineRiskLevel(results) {
        // ファイル存在確認失敗 → Critical
        if (!results.fileExists.pass) {
            return RISK_LEVEL.CRITICAL;
        }

        // Success Criteria 重要項目失敗 → Critical
        if (results.successCriteria.passCount < results.successCriteria.totalCount * 0.5) {
            return RISK_LEVEL.CRITICAL;
        }

        // 差分分析でCritical検出 → Critical
        if (results.diffAnalysis.criticalCount > 0) {
            return RISK_LEVEL.CRITICAL;
        }

        // リスク評価でCritical検出 → Critical
        if (results.riskAssessment.criticalCount > 0) {
            return RISK_LEVEL.CRITICAL;
        }

        // Minor検出あり → Minor
        if (results.diffAnalysis.minorCount > 0 || results.riskAssessment.minorCount > 0) {
            return RISK_LEVEL.MINOR;
        }

        // 全てパス → None
        return RISK_LEVEL.NONE;
    }

    /**
     * リスクレベルからステータスを決定
     * @private
     */
    _determineStatus(riskLevel) {
        switch (riskLevel) {
            case RISK_LEVEL.CRITICAL:
                return QA_STATUS.REJECTED;
            case RISK_LEVEL.MINOR:
                return QA_STATUS.APPROVED; // 警告付き承認
            case RISK_LEVEL.NONE:
                return QA_STATUS.APPROVED;
            default:
                return QA_STATUS.PENDING;
        }
    }

    /**
     * リプラン実行
     * @param {string} taskId - タスクID
     * @param {Object} feedback - フィードバック情報
     * @returns {Promise<{status: string, replanPrompt?: string}>}
     */
    async replan(taskId, feedback) {
        const count = this.iterations.get(taskId) || 0;
        const { qa } = this.store.getState();

        // Max Retries チェック
        if (count >= QA_CONFIG.MAX_QA_ITERATIONS) {
            await this.eventBus.emit(EVENTS.QA_ESCALATED, {
                taskId,
                reason: 'max_iterations',
                attemptCount: count
            });

            this.store.setState({
                qa: {
                    ...qa,
                    escalations: [...qa.escalations, {
                        taskId,
                        reason: 'max_iterations',
                        timestamp: new Date().toISOString()
                    }]
                }
            });

            return { status: QA_STATUS.ESCALATED };
        }

        // イテレーションカウント更新
        this.iterations.set(taskId, count + 1);

        await this.eventBus.emit(EVENTS.QA_REPLAN_STARTED, {
            taskId,
            feedback,
            attemptCount: count + 1
        });

        // Issue Detection
        const issues = this._detectIssues(feedback);

        // 類似問題検出
        const similarIssues = this._findSimilarIssues(taskId, issues);
        if (similarIssues.length >= 3) {
            // 同じ問題が3回以上 → エスカレーション
            await this.eventBus.emit(EVENTS.QA_ESCALATED, {
                taskId,
                reason: 'recurring_issues',
                issues: similarIssues
            });

            return { status: QA_STATUS.ESCALATED };
        }

        // Issue履歴更新
        const existingIssues = this.issueHistory.get(taskId) || [];
        this.issueHistory.set(taskId, [...existingIssues, ...issues]);

        // Replan Prompt生成
        const replanPrompt = this._generateReplanPrompt(feedback, issues);

        return {
            status: QA_STATUS.REPLAN,
            replanPrompt,
            attemptCount: count + 1
        };
    }

    /**
     * 問題検出
     * @private
     */
    _detectIssues(feedback) {
        const issues = [];
        const { failedCriteria = [], diffs = [] } = feedback;

        for (const criteria of failedCriteria) {
            issues.push({
                type: 'success_criteria',
                id: criteria.id,
                description: criteria.description,
                expected: criteria.expected,
                actual: criteria.actual
            });
        }

        for (const diff of diffs) {
            if (diff.severity === 'critical') {
                issues.push({
                    type: 'diff',
                    area: diff.area,
                    description: `Expected: ${diff.expected}, Actual: ${diff.actual}`
                });
            }
        }

        return issues;
    }

    /**
     * 類似問題検出
     * @private
     */
    _findSimilarIssues(taskId, newIssues) {
        const existingIssues = this.issueHistory.get(taskId) || [];
        const similarIssues = [];

        for (const newIssue of newIssues) {
            for (const existingIssue of existingIssues) {
                const similarity = this._calculateSimilarity(newIssue, existingIssue);
                if (similarity >= QA_CONFIG.ISSUE_SIMILARITY_THRESHOLD) {
                    similarIssues.push({
                        newIssue,
                        existingIssue,
                        similarity
                    });
                }
            }
        }

        return similarIssues;
    }

    /**
     * 類似度計算（簡易版：キーマッチング）
     * @private
     */
    _calculateSimilarity(issue1, issue2) {
        // 同じtype かつ 同じ id/area の場合は高類似度
        if (issue1.type !== issue2.type) {
            return 0;
        }

        if (issue1.id && issue2.id && issue1.id === issue2.id) {
            return 1.0;
        }

        if (issue1.area && issue2.area && issue1.area === issue2.area) {
            return 0.9;
        }

        // description の部分一致
        const desc1 = (issue1.description || '').toLowerCase();
        const desc2 = (issue2.description || '').toLowerCase();

        if (desc1 === desc2) {
            return 1.0;
        }

        // 部分一致チェック
        if (desc1.includes(desc2) || desc2.includes(desc1)) {
            return 0.8;
        }

        return 0;
    }

    /**
     * リプランプロンプト生成
     * @private
     */
    _generateReplanPrompt(feedback, issues) {
        const lines = [
            '## リプラン指示',
            '',
            '以下の問題が検出されました。修正してください。',
            ''
        ];

        for (const issue of issues) {
            lines.push(`### ${issue.type}: ${issue.id || issue.area || 'unknown'}`);
            lines.push(`- 説明: ${issue.description}`);
            if (issue.expected) {
                lines.push(`- 期待値: ${issue.expected}`);
            }
            if (issue.actual) {
                lines.push(`- 実際: ${issue.actual}`);
            }
            lines.push('');
        }

        if (feedback.suggestions) {
            lines.push('## 修正の方向性');
            lines.push(feedback.suggestions);
        }

        return lines.join('\n');
    }

    /**
     * 修正完了を記録
     * @param {string} taskId - タスクID
     */
    async recordFixesApplied(taskId) {
        await this.eventBus.emit(EVENTS.QA_FIXES_APPLIED, { taskId });

        const { qa } = this.store.getState();
        const review = qa.currentReviews.find(r => r.taskId === taskId);
        if (review) {
            review.status = QA_STATUS.FIXES_APPLIED;
            this.store.setState({ qa: { ...qa } });
        }
    }

    /**
     * レビュー履歴を取得
     * @param {string} taskId - タスクID
     * @returns {Array} レビュー履歴
     */
    getReviewHistory(taskId) {
        const { qa } = this.store.getState();
        return qa.history.filter(r => r.taskId === taskId);
    }

    /**
     * イテレーションカウントを取得
     * @param {string} taskId - タスクID
     * @returns {number} イテレーション数
     */
    getIterationCount(taskId) {
        return this.iterations.get(taskId) || 0;
    }

    /**
     * イテレーションカウントをリセット
     * @param {string} taskId - タスクID
     */
    resetIterationCount(taskId) {
        this.iterations.delete(taskId);
        this.issueHistory.delete(taskId);
    }
}
