/**
 * 最適化履歴記録エンジン
 * Skills最適化の履歴をJSON形式で記録・管理
 */
export class HistoryLogger {
  /**
   * 最適化履歴を記録
   * @param {Object} entry - 履歴エントリ
   * @returns {Promise<Object>} 記録結果
   */
  async log(entry) {
    try {
      const response = await fetch('/api/skills/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry)
      });

      if (!response.ok) {
        throw new Error(`Failed to log history: ${response.statusText}`);
      }

      const result = await response.json();
      console.log(`[HistoryLogger] Logged history for ${entry.skillName}`);

      return result;
    } catch (error) {
      console.error('[HistoryLogger] Failed to log history:', error);
      throw error;
    }
  }

  /**
   * 特定Skillの履歴を取得
   * @param {string} skillName - Skill名
   * @returns {Promise<Object>} 履歴
   */
  async load(skillName) {
    try {
      const response = await fetch(`/api/skills/history/${skillName}`);

      if (!response.ok) {
        throw new Error(`Failed to load history: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[HistoryLogger] Failed to load history:', error);
      return {
        skillName,
        optimizations: [],
        currentScore: 0,
        converged: false,
        lastOptimized: null
      };
    }
  }

  /**
   * 履歴エントリを作成
   * @param {Object} data - データ
   * @returns {Object} 履歴エントリ
   */
  createEntry(data) {
    const {
      skillName,
      iteration,
      scoresBefore,
      scoresAfter,
      changes,
      gradient,
      testResults,
      metadata = {}
    } = data;

    return {
      skillName,
      iteration,
      timestamp: new Date().toISOString(),
      scores: {
        before: scoresBefore,
        after: scoresAfter,
        improvement: scoresAfter - scoresBefore
      },
      changes,
      gradient,
      testResults,
      metadata
    };
  }

  /**
   * 履歴サマリーを生成
   * @param {Object} history - 履歴
   * @returns {Object} サマリー
   */
  generateSummary(history) {
    if (!history.optimizations || history.optimizations.length === 0) {
      return {
        totalIterations: 0,
        totalImprovement: 0,
        averageImprovement: 0,
        bestIteration: null,
        currentScore: history.currentScore || 0,
        converged: history.converged || false
      };
    }

    const optimizations = history.optimizations;
    const totalIterations = optimizations.length;

    const scores = optimizations.map(o => o.scores.after);
    const improvements = optimizations.map(o => o.scores.improvement);

    const totalImprovement = improvements.reduce((sum, imp) => sum + imp, 0);
    const averageImprovement = totalImprovement / totalIterations;

    const bestIteration = optimizations.reduce((best, current, index) => {
      return current.scores.after > best.score
        ? { iteration: index, score: current.scores.after, data: current }
        : best;
    }, { iteration: 0, score: scores[0], data: optimizations[0] });

    return {
      totalIterations,
      totalImprovement,
      averageImprovement,
      bestIteration,
      currentScore: history.currentScore || scores[scores.length - 1],
      converged: history.converged || false
    };
  }

  /**
   * 履歴をフォーマット（人間可読形式）
   * @param {Object} history - 履歴
   * @returns {string}
   */
  formatHistory(history) {
    const summary = this.generateSummary(history);

    let output = `# Optimization History: ${history.skillName}\n\n`;

    output += `## Summary\n\n`;
    output += `- Total Iterations: ${summary.totalIterations}\n`;
    output += `- Total Improvement: ${(summary.totalImprovement * 100).toFixed(1)}%\n`;
    output += `- Average Improvement: ${(summary.averageImprovement * 100).toFixed(1)}%\n`;
    output += `- Best Iteration: ${summary.bestIteration ? summary.bestIteration.iteration + 1 : 'N/A'}\n`;
    output += `- Current Score: ${(summary.currentScore * 100).toFixed(1)}%\n`;
    output += `- Converged: ${summary.converged ? 'Yes' : 'No'}\n`;
    output += `- Last Optimized: ${history.lastOptimized || 'Never'}\n\n`;

    if (history.optimizations && history.optimizations.length > 0) {
      output += `## Optimization History\n\n`;
      history.optimizations.forEach((opt, index) => {
        output += `### Iteration ${opt.iteration}\n\n`;
        output += `**Timestamp**: ${opt.timestamp}\n\n`;
        output += `**Scores**:\n`;
        output += `- Before: ${(opt.scores.before * 100).toFixed(1)}%\n`;
        output += `- After: ${(opt.scores.after * 100).toFixed(1)}%\n`;
        output += `- Improvement: ${(opt.scores.improvement * 100).toFixed(1)}%\n\n`;

        if (opt.changes && opt.changes.length > 0) {
          output += `**Changes**:\n`;
          opt.changes.forEach((c, i) => {
            output += `${i + 1}. ${c}\n`;
          });
          output += `\n`;
        }

        if (opt.gradient) {
          output += `**Gradient**:\n`;
          output += `- Structural: ${(opt.gradient.structural * 100).toFixed(1)}%\n`;
          output += `- Semantic: ${(opt.gradient.semantic * 100).toFixed(1)}%\n`;
          output += `- KERNEL: ${(opt.gradient.kernel * 100).toFixed(1)}%\n\n`;
        }

        if (opt.testResults) {
          output += `**Test Results**:\n`;
          output += `- A/B Test: ${opt.testResults.abTest || 'N/A'}\n`;
          output += `- Improvement: ${opt.testResults.improvement ? (opt.testResults.improvement * 100).toFixed(1) + '%' : 'N/A'}\n`;
          output += `- Significant: ${opt.testResults.significant ? 'Yes' : 'No'}\n\n`;
        }

        output += `---\n\n`;
      });
    }

    return output;
  }

  /**
   * 履歴をエクスポート（JSON）
   * @param {Object} history - 履歴
   * @returns {string} JSON文字列
   */
  exportJSON(history) {
    return JSON.stringify(history, null, 2);
  }

  /**
   * 履歴をエクスポート（CSV）
   * @param {Object} history - 履歴
   * @returns {string} CSV文字列
   */
  exportCSV(history) {
    if (!history.optimizations || history.optimizations.length === 0) {
      return 'No data';
    }

    const headers = [
      'Iteration',
      'Timestamp',
      'Score Before',
      'Score After',
      'Improvement',
      'Gradient Structural',
      'Gradient Semantic',
      'Gradient KERNEL',
      'A/B Test Decision',
      'Significant'
    ];

    const rows = history.optimizations.map(opt => [
      opt.iteration,
      opt.timestamp,
      opt.scores.before,
      opt.scores.after,
      opt.scores.improvement,
      opt.gradient?.structural || '',
      opt.gradient?.semantic || '',
      opt.gradient?.kernel || '',
      opt.testResults?.abTest || '',
      opt.testResults?.significant || ''
    ]);

    return [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');
  }
}
