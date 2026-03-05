/**
 * SessionMonitor
 *
 * ゴール付きセッションの出力をリアルタイムで監視し、
 * 問題検知・対話代理・進捗サマリーを行う。
 *
 * Goal Seek V2の核心コンポーネント。
 */

import { logger } from '../utils/logger.js';

export class SessionMonitor {
    /**
     * @param {Object} options
     * @param {Object} options.sessionManager - SessionManagerインスタンス
     * @param {Object} options.problemDetector - ProblemDetectorインスタンス
     * @param {Object} options.managerAI - ManagerAIServiceインスタンス
     * @param {Object} options.goalStore - GoalSeekStoreインスタンス
     * @param {Object} options.eventBus - サーバーサイドイベントemitter
     * @param {number} [options.pollIntervalMs=5000] - ポーリング間隔（ms）
     */
    constructor({ sessionManager, problemDetector, managerAI, goalStore, eventBus, pollIntervalMs }) {
        this.sessionManager = sessionManager;
        this.problemDetector = problemDetector;
        this.managerAI = managerAI;
        this.goalStore = goalStore;
        this.eventBus = eventBus;
        this.pollIntervalMs = pollIntervalMs || 5000;

        this._intervals = new Map();
        this._lastContentLength = new Map();
        this._monitoringMeta = new Map();
    }

    /**
     * ゴール付きセッションの監視を開始
     */
    startMonitoring(sessionId, goal) {
        if (this._intervals.has(sessionId)) {
            logger.warn('SessionMonitor: already monitoring', { sessionId });
            return;
        }

        logger.info('SessionMonitor: start monitoring', { sessionId, goalId: goal.id });

        this._lastContentLength.set(sessionId, 0);
        this._monitoringMeta.set(sessionId, {
            goalId: goal.id,
            startedAt: Date.now(),
            pollCount: 0,
            problemCount: 0
        });

        const intervalId = setInterval(async () => {
            await this._pollSession(sessionId, goal);
        }, this.pollIntervalMs);

        this._intervals.set(sessionId, intervalId);

        this.goalStore.addTimelineEntry({
            goalId: goal.id,
            type: 'progress',
            summary: '監視開始',
            details: `セッション ${sessionId} の監視を開始しました`
        });
    }

    /**
     * 監視を停止
     */
    stopMonitoring(sessionId) {
        const intervalId = this._intervals.get(sessionId);
        if (intervalId) {
            clearInterval(intervalId);
            this._intervals.delete(sessionId);
        }
        this._lastContentLength.delete(sessionId);

        const meta = this._monitoringMeta.get(sessionId);
        if (meta) {
            const goal = this.goalStore.getGoal(meta.goalId);
            if (goal) {
                this.goalStore.addTimelineEntry({
                    goalId: meta.goalId,
                    type: 'progress',
                    summary: '監視停止',
                    details: `ポーリング ${meta.pollCount} 回、問題 ${meta.problemCount} 件`
                });
            }
        }
        this._monitoringMeta.delete(sessionId);
        this.problemDetector.clearSession(sessionId);

        logger.info('SessionMonitor: stop monitoring', { sessionId });
    }

    /**
     * 全監視を停止（graceful shutdown用）
     */
    stopAll() {
        for (const sessionId of this._intervals.keys()) {
            this.stopMonitoring(sessionId);
        }
    }

    /**
     * 監視中のセッションIDリストを取得
     */
    getMonitoredSessions() {
        return Array.from(this._intervals.keys());
    }

    /**
     * セッション出力をポーリング
     * @private
     */
    async _pollSession(sessionId, goal) {
        const meta = this._monitoringMeta.get(sessionId);
        if (meta) meta.pollCount++;

        try {
            const content = await this.sessionManager.getContent(sessionId, 200);

            if (!this.problemDetector.hasOutputChanged(sessionId, content)) {
                const stuckProblems = this.problemDetector.analyze([], goal, sessionId);
                if (stuckProblems.length > 0) {
                    await this._handleProblems(sessionId, goal, stuckProblems);
                }
                return;
            }

            const prevLength = this._lastContentLength.get(sessionId) || 0;
            const newContent = content.slice(prevLength);
            this._lastContentLength.set(sessionId, content.length);

            if (!newContent.trim()) return;

            const newLines = newContent.split('\n').filter(l => l.trim());
            const problems = this.problemDetector.analyze(newLines, goal, sessionId);

            if (problems.length > 0) {
                await this._handleProblems(sessionId, goal, problems);
            }

            const questionProblem = problems.find(p => p.type === 'escalation');
            if (questionProblem && this.managerAI) {
                await this._handleQuestion(sessionId, goal, questionProblem);
            }
        } catch (err) {
            if (err.message?.includes('session not found') || err.message?.includes('no server running')) {
                logger.warn('SessionMonitor: session no longer available', { sessionId });
                this.stopMonitoring(sessionId);
                this.goalStore.updateGoal(goal.id, { status: 'failed' });
            } else {
                logger.error('SessionMonitor: poll error', { sessionId, error: err.message });
            }
        }
    }

    /**
     * @private
     */
    async _handleProblems(sessionId, goal, problems) {
        const meta = this._monitoringMeta.get(sessionId);

        for (const problem of problems) {
            if (meta) meta.problemCount++;

            const stored = this.goalStore.addProblem({
                goalId: goal.id,
                sessionId,
                ...problem
            });

            if (problem.type === 'error' || problem.type === 'stuck') {
                this.goalStore.updateGoal(goal.id, { status: 'problem' });
            }

            this.goalStore.addTimelineEntry({
                goalId: goal.id,
                type: 'problem',
                summary: `[${problem.severity}] ${problem.title}`,
                details: problem.description
            });

            if (this.eventBus) {
                this.eventBus.emit('goal:problem-detected', {
                    sessionId,
                    goalId: goal.id,
                    problem: stored
                });
            }
        }
    }

    /**
     * @private
     */
    async _handleQuestion(sessionId, goal, questionProblem) {
        if (!this.managerAI) return;

        try {
            const response = await this.managerAI.answerQuestion(
                questionProblem.description,
                goal
            );

            if (response.canAnswer) {
                await this.sessionManager.sendInput(sessionId, response.answer, 'text');
                await this.sessionManager.sendInput(sessionId, 'Enter', 'key');

                this.goalStore.addTimelineEntry({
                    goalId: goal.id,
                    type: 'progress',
                    summary: 'Manager AI 代理回答',
                    details: `質問: ${questionProblem.description.slice(0, 100)}\n回答: ${response.answer}`
                });
            } else {
                const escalation = this.goalStore.addEscalation({
                    goalId: goal.id,
                    sessionId,
                    question: questionProblem.description,
                    context: response.analysis || '',
                    options: response.suggestedOptions || []
                });

                this.goalStore.updateGoal(goal.id, { status: 'problem' });

                this.goalStore.addTimelineEntry({
                    goalId: goal.id,
                    type: 'escalation',
                    summary: 'エスカレーション発生',
                    details: `質問: ${questionProblem.description.slice(0, 200)}\n理由: ${response.reason || 'Manager AI判断不能'}`
                });

                if (this.eventBus) {
                    this.eventBus.emit('goal:escalation-required', {
                        sessionId,
                        goalId: goal.id,
                        escalation
                    });
                }
            }
        } catch (err) {
            logger.error('SessionMonitor: Manager AI error', { sessionId, error: err.message });
        }
    }
}
