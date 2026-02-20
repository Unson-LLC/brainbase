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

        // 実際の障害を示すパターン（高確度なものに絞る）
        this.errorPatterns = [
            /\bUnhandledPromiseRejection\b/,
            /\bfatal error\b/i,
            /\bpanic:\s/i,
            /\bTraceback \(most recent call last\)/,
            /\bECONNREFUSED\b/,
            /\bsegmentation fault\b/i,
            /\bkilled\b.*\bsignal\b/i,
            /\bexit code [2-9]\d*\b/i,  // exit code 1は許容（多くのCLIが使う）
            /\bprocess exited with code [2-9]\b/i,
            /\bcore dumped\b/i,
        ];

        // 対話的な入力を必要とするパターン（AIの質問文は除外）
        this.questionPatterns = [
            /\(y\/n\)\s*[：:>]?\s*$/im,
            /\[Y\/n\]\s*$/m,
            /\[yes\/no\]\s*$/im,
            /Press\s+(Enter|any key)\s+to\s+continue/i,
        ];

        // 行単位で除外するパターン（Claude Code出力の誤検知防止）
        this.ignoreLinePatterns = [
            /^#/,                                    // コメント行
            /console\.(error|warn|log)/,             // console出力
            /\[.*\]\s+(error|warn|info|debug):/i,   // ロガー出力 [Tag] error:
            /^[●○✓✗⏵⏸⎿⎾→←]/u,                    // Claude Code UIマーカー
            /^\s*[+\-]\s+/,                          // diff出力
            /^\s*\d+[→\s]/,                          // 行番号付きdiff
            /\.test\.\w+/,                           // テストファイル
            /expected.*error/i,                      // テストのexpected error
            /catch\s*\(\w*err/i,                     // try-catch
            /throw new \w*Error/i,                   // エラー生成コード
            /Error\.message/i,                       // エラープロパティ参照
            /err\.message/i,                         // エラープロパティ参照
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
        // 行単位でignoreLinePatternに一致する行を除外してからエラー検知
        const lines = output.split('\n');
        const filteredLines = lines.filter(line =>
            !this.ignoreLinePatterns.some(p => p.test(line))
        );

        if (filteredLines.length === 0) return null;

        const filteredOutput = filteredLines.join('\n');

        const matchedLines = filteredLines.filter(line =>
            this.errorPatterns.some(p => p.test(line))
        );

        if (matchedLines.length === 0) return null;

        const hasCritical = /\b(fatal|panic|UnhandledPromiseRejection|ECONNREFUSED|segmentation fault|core dumped)\b/i.test(filteredOutput);
        const severity = hasCritical ? 'critical' : 'warning';

        return {
            type: 'error',
            severity,
            title: 'エラー検知',
            description: matchedLines.slice(0, 5).join('\n'),
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
