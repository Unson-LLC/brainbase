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

        // 既存のMap
        this._intervals = new Map();
        this._lastContentLength = new Map();
        this._monitoringMeta = new Map();

        // ✅ Phase 2: アイドル検知用
        this._lastOutputHash = new Map();  // sessionId -> lastHash
        this._unchangedPollCount = new Map();  // sessionId -> count

        // ✅ Phase 2: 設定値
        this.IDLE_THRESHOLD_POLLS = 6;  // 30秒（5秒 × 6回）
        this.LARGE_OUTPUT_THRESHOLD = 100;  // 100行以上で抽出
        this.MAX_IMPORTANT_LINES = 20;  // 最大20行
    }

    /**
     * ゴール付きセッションの監視を開始
     */
    startMonitoring(sessionId, goal) {
        if (this._intervals.has(sessionId)) {
            logger.warn('SessionMonitor: already monitoring', { sessionId });
            return;
        }

        logger.info('SessionMonitor: start autopilot monitoring', { sessionId, goalId: goal.id, goalTitle: goal.title });

        this._lastContentLength.set(sessionId, 0);
        this._monitoringMeta.set(sessionId, {
            goalId: goal.id,
            startedAt: Date.now(),
            pollCount: 0,
            problemCount: 0
        });

        // ✅ Phase 1: 初回プロンプト自動送信
        this._sendInitialPrompt(sessionId, goal).catch(err => {
            logger.error('SessionMonitor: failed to send initial prompt', { sessionId, error: err.message });
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

            // 既存の問題検知ロジック
            if (!this.problemDetector.hasOutputChanged(sessionId, content)) {
                const stuckProblems = this.problemDetector.analyze([], goal, sessionId);
                if (stuckProblems.length > 0) {
                    await this._handleProblems(sessionId, goal, stuckProblems);
                }
            } else {
                const prevLength = this._lastContentLength.get(sessionId) || 0;
                const newContent = content.slice(prevLength);
                this._lastContentLength.set(sessionId, content.length);

                if (newContent.trim()) {
                    const newLines = newContent.split('\n').filter(l => l.trim());
                    const problems = this.problemDetector.analyze(newLines, goal, sessionId);

                    if (problems.length > 0) {
                        await this._handleProblems(sessionId, goal, problems);
                    }

                    const questionProblem = problems.find(p => p.type === 'escalation');
                    if (questionProblem && this.managerAI) {
                        await this._handleQuestion(sessionId, goal, questionProblem);
                    }
                }
            }

            // ✅ Phase 3: ゴール達成検知（問題検知より前に実行）
            if (this._checkGoalCompletion(content, goal)) {
                logger.info('SessionMonitor: goal completed detected', { sessionId, goalId: goal.id });

                // Goalのステータスを完了に更新
                await this.goalStore.updateGoal(goal.id, {
                    status: 'completed',
                    completedAt: new Date().toISOString()
                });

                // 監視停止
                this.stopMonitoring(sessionId);

                // Event発火
                if (this.eventBus) {
                    this.eventBus.emit('goal:completed', { goalId: goal.id, sessionId });
                }

                await this.goalStore.addTimelineEntry({
                    goalId: goal.id,
                    type: 'progress',
                    summary: 'ゴール達成',
                    details: `ゴール「${goal.title}」が達成されました`
                });

                return;
            }

            // ✅ Phase 2: アイドル検知 + 次ステッププロンプト
            const currentHash = this._generateHash(content);
            const lastHash = this._lastOutputHash.get(sessionId);

            if (currentHash === lastHash) {
                // 出力が変化していない → カウント増加
                const count = (this._unchangedPollCount.get(sessionId) || 0) + 1;
                this._unchangedPollCount.set(sessionId, count);

                if (count >= this.IDLE_THRESHOLD_POLLS) {
                    logger.info('SessionMonitor: idle detected, prompting next step', { sessionId, count });
                    await this._promptNextStep(sessionId, goal, content);
                    this._unchangedPollCount.set(sessionId, 0);  // リセット
                }
            } else {
                // 出力が変化した → カウントリセット
                this._lastOutputHash.set(sessionId, currentHash);
                this._unchangedPollCount.set(sessionId, 0);
            }
        } catch (err) {
            if (err.message?.includes('session not found') || err.message?.includes('no server running')) {
                logger.warn('SessionMonitor: session no longer available', { sessionId });
                this.stopMonitoring(sessionId);
                await this.goalStore.updateGoal(goal.id, { status: 'failed' });
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

    /**
     * 初回プロンプト自動送信（Phase 1）
     * @private
     */
    async _sendInitialPrompt(sessionId, goal) {
        const prompt = this._buildGoalPrompt(goal);
        logger.info('SessionMonitor: sending initial prompt', { sessionId, promptLength: prompt.length });

        try {
            // brainbase CLI経由でプロンプト送信
            await this.sessionManager.sendInput(sessionId, prompt, 'text');
            await this.sessionManager.sendInput(sessionId, 'Enter', 'key');

            await this.goalStore.addTimelineEntry({
                goalId: goal.id,
                type: 'progress',
                summary: '初回プロンプト送信',
                details: `ゴール「${goal.title}」の達成に向けたプロンプトを送信しました`
            });
        } catch (err) {
            logger.error('SessionMonitor: failed to send initial prompt', { sessionId, error: err.message });
            throw err;
        }
    }

    /**
     * ゴール達成プロンプトを生成（Phase 1）
     * @private
     */
    _buildGoalPrompt(goal) {
        const commitCriteria = goal.criteria?.commit || [];
        const signalCriteria = goal.criteria?.signal || [];
        const allCriteria = [...commitCriteria, ...signalCriteria];

        const parts = [
            `## Goal: ${goal.title}`,
            '',
            goal.description || '',
            ''
        ];

        if (allCriteria.length > 0) {
            parts.push('## Success Criteria');
            parts.push(...allCriteria.map(c => `- ${c}`));
            parts.push('');
        }

        parts.push(
            '## Instructions',
            'Please work on achieving this goal. I will monitor your progress and assist when needed.',
            'If you complete the goal, please clearly state "Goal completed" or "Task completed".'
        );

        return parts.filter(Boolean).join('\n');
    }

    /**
     * 出力のハッシュを生成（Phase 2）
     * @private
     */
    _generateHash(content) {
        return `${content.length}:${content.slice(-100)}`;
    }

    /**
     * 次ステッププロンプト送信（Phase 2）
     * @private
     */
    async _promptNextStep(sessionId, goal, recentOutput) {
        const lines = recentOutput.split('\n');

        // ✅ 効率化: 100行以上の場合のみ重要な行を抽出
        const importantLines = lines.length > this.LARGE_OUTPUT_THRESHOLD
            ? this._extractImportantLines(recentOutput)
            : lines.slice(-20);  // 最後の20行

        const prompt = [
            '## Progress Check',
            '',
            '**Recent Output**:',
            '```',
            ...importantLines,
            '```',
            '',
            `**Goal**: ${goal.title}`,
            '',
            '**Question**: What is the next step to achieve this goal?',
            'Please analyze the current state and proceed with the next action.'
        ].join('\n');

        logger.info('SessionMonitor: prompting next step', { sessionId, linesExtracted: importantLines.length });

        try {
            await this.sessionManager.sendInput(sessionId, prompt, 'text');
            await this.sessionManager.sendInput(sessionId, 'Enter', 'key');

            await this.goalStore.addTimelineEntry({
                goalId: goal.id,
                type: 'progress',
                summary: '次ステッププロンプト送信',
                details: `アイドル検知後、次のステップを促すプロンプトを送信しました`
            });
        } catch (err) {
            logger.error('SessionMonitor: failed to send next step prompt', { sessionId, error: err.message });
        }
    }

    /**
     * 重要な行を抽出（キーワードフィルタリング、Phase 2）
     * @private
     */
    _extractImportantLines(output) {
        const lines = output.split('\n');
        const keywords = [
            'error', 'fail', 'exception', 'completed', 'success', 'done',
            'goal', 'task', 'blocked', 'waiting', 'ready', 'finished'
        ];

        // キーワードマッチング（大文字小文字区別なし）
        const important = lines.filter(line => {
            const lower = line.toLowerCase();
            return keywords.some(kw => lower.includes(kw));
        });

        // 最大MAX_IMPORTANT_LINES行に制限
        const result = important.slice(-this.MAX_IMPORTANT_LINES);

        // 重要な行が少なすぎる場合は最後の20行を追加
        if (result.length < 10) {
            const recentLines = lines.slice(-20);
            return [...new Set([...result, ...recentLines])].slice(-this.MAX_IMPORTANT_LINES);
        }

        return result;
    }

    /**
     * ゴール達成検知（堅牢版 - 文ベース除外 + 厳格キーワード検知）
     * @private
     */
    _checkGoalCompletion(output, goal) {
        // ✅ 最小経過時間チェック（監視開始から60秒以上経過している場合のみ検知）
        const meta = this._monitoringMeta.get(goal.sessionId);
        if (meta) {
            const elapsedMs = Date.now() - meta.startedAt;
            if (elapsedMs < 60000) {
                return false; // 60秒未満は検知しない
            }
        }

        // ✅ 文単位で分割（改行・句点で区切る）
        const sentences = output
            .split(/[\n。！？\.]+/)
            .map(s => s.trim())
            .filter(s => s.length > 0);

        // ✅ 除外パターン（指示文・質問文・引用）
        const excludePatterns = [
            /please/i,
            /if you/i,
            /when you/i,
            /you should/i,
            /make sure/i,
            /don't forget/i,
            /remember to/i,
            /clearly state/i,
            /\?$/, // 質問文
            /["「『][^"」』]*["」』]/ // 引用符内
        ];

        // 指示文・質問文・引用を除外
        const relevantSentences = sentences.filter(sentence => {
            return !excludePatterns.some(pattern => pattern.test(sentence));
        });

        // ✅ 完了キーワード（文の先頭または句読点直後のみ、正規表現で厳格に）
        const completionPatterns = [
            /^\s*goal completed/i,
            /^\s*task completed/i,
            /^\s*successfully completed/i,
            /^\s*all done/i,
            /^\s*achieved the goal/i,
            /[\.\,\:\;]\s+goal completed/i,
            /[\.\,\:\;]\s+task completed/i
        ];

        // 完了宣言が含まれているか（文の先頭または区切り直後のみ）
        const hasCompletionKeyword = relevantSentences.some(sentence => {
            return completionPatterns.some(pattern => pattern.test(sentence));
        });

        // Success Criteriaに基づく検証
        const commitCriteria = goal.criteria?.commit || [];
        const signalCriteria = goal.criteria?.signal || [];
        const allCriteria = [...commitCriteria, ...signalCriteria];

        if (allCriteria.length > 0) {
            const relevantText = relevantSentences.join(' ').toLowerCase();

            // 各criteriaに含まれるキーワードがrelevantTextに含まれるか確認
            const criteriaMatches = allCriteria.map(criterion => {
                const criterionKeywords = criterion.toLowerCase().split(/\s+/);
                return criterionKeywords.some(kw => relevantText.includes(kw));
            });

            // 80%以上のcriteriaがマッチしたら完了と判定
            const matchRate = criteriaMatches.filter(Boolean).length / allCriteria.length;
            return hasCompletionKeyword && matchRate >= 0.8;
        }

        // Success Criteriaがない場合はキーワードのみで判定
        return hasCompletionKeyword;
    }
}
