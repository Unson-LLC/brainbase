/**
 * ProblemDetector
 *
 * セッション出力からエラー・スタック・逸脱を検知
 *
 * 検知タイプ:
 * - error:     エラーパターン（Error, failed, FAIL, stack trace）
 * - stuck:     N秒間出力変化なし
 * - deviation: ゴールからの逸脱（ManagerAIで判定、ここではフラグのみ）
 * - escalation: AIが質問している（対話代理トリガー）
 */

export class ProblemDetector {
    constructor(options = {}) {
        this.stuckThresholdMs = options.stuckThresholdMs || 120000; // 2分
        this._lastOutputAt = new Map();
        this._lastOutputHash = new Map();

        this.errorPatterns = [
            /\bError\b[:\s]/,
            /\bERROR\b/,
            /\bFAIL(ED)?\b/i,
            /\bfatal\b/i,
            /\bpanic\b/i,
            /\bTraceback\b/,
            /at\s+\S+\s+\(\S+:\d+:\d+\)/,
            /^\s+at\s+/m,
            /\bUnhandledPromiseRejection\b/,
            /\bSyntaxError\b/,
            /\bTypeError\b/,
            /\bReferenceError\b/,
            /\bEACCES\b/,
            /\bENOENT\b/,
            /\bECONNREFUSED\b/,
            /\bexit code [1-9]\d*\b/i,
            /\bcommand failed\b/i,
            /\bpermission denied\b/i,
        ];

        this.questionPatterns = [
            /\?\s*$/m,
            /\(y\/n\)/i,
            /\[Y\/n\]/,
            /\[yes\/no\]/i,
            /Press\s+(Enter|any key)/i,
            /Do you want to/i,
            /Would you like to/i,
            /Please (choose|select|confirm)/i,
            /Enter.*:/,
        ];

        this.ignorePatterns = [
            /^#/,
            /console\.(error|warn)/,
            /\.test\./,
            /expected.*error/i,
        ];
    }

    /**
     * 出力行を分析して問題を検知
     * @param {string[]} newLines - 新しい出力行
     * @param {Object} goal - ゴールオブジェクト
     * @param {string} sessionId - セッションID
     * @returns {Object[]} 検知された問題リスト
     */
    analyze(newLines, goal, sessionId) {
        const problems = [];

        if (!newLines || newLines.length === 0) {
            const stuckProblem = this._checkStuck(sessionId);
            if (stuckProblem) {
                problems.push(stuckProblem);
            }
            return problems;
        }

        this._lastOutputAt.set(sessionId, Date.now());

        const joinedOutput = newLines.join('\n');

        const errorProblem = this._detectErrors(joinedOutput, sessionId);
        if (errorProblem) {
            problems.push(errorProblem);
        }

        const questionProblem = this._detectQuestion(joinedOutput, sessionId);
        if (questionProblem) {
            problems.push(questionProblem);
        }

        return problems;
    }

    /**
     * @private
     */
    _detectErrors(output, sessionId) {
        for (const pattern of this.ignorePatterns) {
            if (pattern.test(output)) {
                return null;
            }
        }

        const matchedPatterns = [];
        for (const pattern of this.errorPatterns) {
            if (pattern.test(output)) {
                matchedPatterns.push(pattern.source);
            }
        }

        if (matchedPatterns.length === 0) return null;

        const hasCritical = /\b(fatal|panic|UnhandledPromiseRejection)\b/i.test(output);
        const severity = hasCritical ? 'critical' : 'warning';

        const errorLines = output.split('\n')
            .filter(line => this.errorPatterns.some(p => p.test(line)))
            .slice(0, 5);

        return {
            type: 'error',
            severity,
            title: 'エラー検知',
            description: errorLines.join('\n'),
            suggestedActions: ['エラーを確認して修正', '別アプローチを試行', 'セッションを停止']
        };
    }

    /**
     * @private
     */
    _checkStuck(sessionId) {
        const lastOutput = this._lastOutputAt.get(sessionId);
        if (!lastOutput) return null;

        const elapsed = Date.now() - lastOutput;
        if (elapsed < this.stuckThresholdMs) return null;

        return {
            type: 'stuck',
            severity: 'warning',
            title: '進捗なし',
            description: `${Math.round(elapsed / 1000)}秒間出力変化がありません`,
            suggestedActions: ['セッション状態を確認', 'プロンプトを送信', 'セッションを再起動']
        };
    }

    /**
     * @private
     */
    _detectQuestion(output, sessionId) {
        const lastLines = output.split('\n').slice(-5).join('\n');

        for (const pattern of this.questionPatterns) {
            if (pattern.test(lastLines)) {
                return {
                    type: 'escalation',
                    severity: 'info',
                    title: '入力待ち検知',
                    description: lastLines.trim(),
                    suggestedActions: ['Manager AIが代理回答', 'CEOにエスカレーション']
                };
            }
        }

        return null;
    }

    /**
     * 出力のハッシュが変化したかチェック
     */
    hasOutputChanged(sessionId, content) {
        const hash = `${content.length}:${content.slice(-100)}`;
        const prev = this._lastOutputHash.get(sessionId);
        this._lastOutputHash.set(sessionId, hash);
        return hash !== prev;
    }

    /**
     * セッションの追跡データをクリア
     */
    clearSession(sessionId) {
        this._lastOutputAt.delete(sessionId);
        this._lastOutputHash.delete(sessionId);
    }
}
