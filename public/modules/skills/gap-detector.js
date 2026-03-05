/**
 * 期待値と実際の乖離を検出するエンジン
 */
export class GapDetector {
  /**
   * 乖離を検出
   * @param {Object} expected - 期待値
   * @param {Object} actual - 実際の値
   * @param {Object} options - オプション
   * @returns {Object} 乖離情報
   */
  detectGap(expected, actual, options = {}) {
    const threshold = options.threshold || 0.1; // デフォルト閾値: 10%

    const gaps = [];

    // 数値フィールドの乖離検出
    if (typeof expected === 'number' && typeof actual === 'number') {
      const diff = Math.abs(expected - actual);
      const ratio = expected !== 0 ? diff / expected : diff;

      if (ratio > threshold) {
        gaps.push({
          type: 'numeric',
          expected,
          actual,
          diff,
          ratio,
          severity: this._calculateSeverity(ratio)
        });
      }
    }

    // オブジェクトの場合は再帰的にチェック
    if (typeof expected === 'object' && typeof actual === 'object') {
      for (const key in expected) {
        if (expected.hasOwnProperty(key)) {
          if (!actual.hasOwnProperty(key)) {
            gaps.push({
              type: 'missing_field',
              key,
              expected: expected[key],
              actual: undefined,
              severity: 'high'
            });
          } else {
            const nestedGaps = this.detectGap(expected[key], actual[key], options);
            if (nestedGaps.gaps.length > 0) {
              gaps.push({
                type: 'nested',
                key,
                gaps: nestedGaps.gaps
              });
            }
          }
        }
      }

      // 期待されていないフィールドの検出
      for (const key in actual) {
        if (actual.hasOwnProperty(key) && !expected.hasOwnProperty(key)) {
          gaps.push({
            type: 'unexpected_field',
            key,
            expected: undefined,
            actual: actual[key],
            severity: 'low'
          });
        }
      }
    }

    return {
      hasGap: gaps.length > 0,
      gaps,
      summary: this._generateSummary(gaps)
    };
  }

  /**
   * Skills使用結果の乖離を検出
   * @param {Object} skillExpectation - Skillの期待値
   * @param {Object} sessionResult - セッション結果
   * @returns {Object} 乖離情報
   */
  detectSkillGap(skillExpectation, sessionResult) {
    const gaps = [];

    // 1. 成功率の乖離
    if (skillExpectation.expectedSuccessRate !== undefined) {
      const actualSuccessRate = sessionResult.success ? 1 : 0;
      const diff = Math.abs(skillExpectation.expectedSuccessRate - actualSuccessRate);

      if (diff > 0.2) { // 20%以上の乖離
        gaps.push({
          type: 'success_rate',
          expected: skillExpectation.expectedSuccessRate,
          actual: actualSuccessRate,
          diff,
          severity: this._calculateSeverity(diff)
        });
      }
    }

    // 2. メッセージ数の乖離
    if (skillExpectation.expectedMessageCount !== undefined) {
      const actualMessageCount = sessionResult.metrics?.messageCount || 0;
      const diff = Math.abs(skillExpectation.expectedMessageCount - actualMessageCount);
      const ratio = skillExpectation.expectedMessageCount !== 0
        ? diff / skillExpectation.expectedMessageCount
        : diff;

      if (ratio > 0.3) { // 30%以上の乖離
        gaps.push({
          type: 'message_count',
          expected: skillExpectation.expectedMessageCount,
          actual: actualMessageCount,
          diff,
          ratio,
          severity: this._calculateSeverity(ratio)
        });
      }
    }

    // 3. 完了時間の乖離
    if (skillExpectation.expectedCompletionTime !== undefined) {
      const actualCompletionTime = sessionResult.metrics?.completionTime || 0;
      const diff = Math.abs(skillExpectation.expectedCompletionTime - actualCompletionTime);
      const ratio = skillExpectation.expectedCompletionTime !== 0
        ? diff / skillExpectation.expectedCompletionTime
        : diff;

      if (ratio > 0.5) { // 50%以上の乖離
        gaps.push({
          type: 'completion_time',
          expected: skillExpectation.expectedCompletionTime,
          actual: actualCompletionTime,
          diff,
          ratio,
          severity: this._calculateSeverity(ratio)
        });
      }
    }

    // 4. 学習候補の乖離
    if (skillExpectation.expectedLearnings !== undefined) {
      const actualLearnings = sessionResult.learnings?.length || 0;
      const expectedLearnings = skillExpectation.expectedLearnings;
      const diff = Math.abs(expectedLearnings - actualLearnings);

      if (diff > 2) { // 2個以上の差
        gaps.push({
          type: 'learnings',
          expected: expectedLearnings,
          actual: actualLearnings,
          diff,
          severity: diff > 5 ? 'high' : 'medium'
        });
      }
    }

    return {
      hasGap: gaps.length > 0,
      gaps,
      summary: this._generateSummary(gaps),
      riskLevel: this._calculateRiskLevel(gaps)
    };
  }

  /**
   * 重大度を計算
   * @param {number} ratio - 乖離率
   * @returns {string} 重大度（low/medium/high/critical）
   * @private
   */
  _calculateSeverity(ratio) {
    if (ratio >= 1.0) return 'critical'; // 100%以上
    if (ratio >= 0.5) return 'high';      // 50%以上
    if (ratio >= 0.2) return 'medium';    // 20%以上
    return 'low';
  }

  /**
   * サマリーを生成
   * @param {Array} gaps - 乖離リスト
   * @returns {Object} サマリー
   * @private
   */
  _generateSummary(gaps) {
    const summary = {
      total: gaps.length,
      bySeverity: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0
      },
      byType: {}
    };

    for (const gap of gaps) {
      // 重大度カウント
      if (gap.severity) {
        summary.bySeverity[gap.severity]++;
      }

      // タイプカウント
      if (gap.type) {
        summary.byType[gap.type] = (summary.byType[gap.type] || 0) + 1;
      }
    }

    return summary;
  }

  /**
   * リスクレベルを計算
   * @param {Array} gaps - 乖離リスト
   * @returns {string} リスクレベル（none/low/medium/high/critical）
   * @private
   */
  _calculateRiskLevel(gaps) {
    if (gaps.length === 0) return 'none';

    const hasCritical = gaps.some(g => g.severity === 'critical');
    const hasHigh = gaps.some(g => g.severity === 'high');
    const hasMedium = gaps.some(g => g.severity === 'medium');

    if (hasCritical) return 'critical';
    if (hasHigh) return 'high';
    if (hasMedium) return 'medium';
    return 'low';
  }
}
