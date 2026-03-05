/**
 * 早期停止エンジン
 * 過学習を防ぐため、最適化を早期に停止する判断を行う
 */
import { ConvergenceDetector } from './convergence-detector.js';

export class EarlyStopping {
  constructor({ maxIterations = 4, patienceWindow = 2 } = {}) {
    this.maxIterations = maxIterations; // 最大イテレーション数
    this.patienceWindow = patienceWindow; // スコア回帰を検出するウィンドウサイズ
    this.convergenceDetector = new ConvergenceDetector();
  }

  /**
   * 早期停止すべきか判断
   * @param {Array<number>} scores - スコア履歴
   * @returns {boolean} 停止すべきか
   */
  shouldStop(scores) {
    if (!scores || scores.length === 0) return false;

    // 条件1: 最大イテレーション到達
    if (this._hasReachedMaxIterations(scores)) {
      console.log('[EarlyStopping] Reached max iterations');
      return true;
    }

    // 条件2: スコア回帰（過学習の兆候）
    if (this._hasScoreRegression(scores)) {
      console.log('[EarlyStopping] Score regression detected (overfitting)');
      return true;
    }

    // 条件3: 収束検出
    if (this.convergenceDetector.isConverged(scores)) {
      console.log('[EarlyStopping] Convergence detected');
      return true;
    }

    return false;
  }

  /**
   * 最大イテレーション到達チェック
   * @param {Array<number>} scores - スコア履歴
   * @returns {boolean}
   * @private
   */
  _hasReachedMaxIterations(scores) {
    return scores.length >= this.maxIterations;
  }

  /**
   * スコア回帰チェック（過学習の兆候）
   * @param {Array<number>} scores - スコア履歴
   * @returns {boolean}
   * @private
   */
  _hasScoreRegression(scores) {
    if (scores.length < this.patienceWindow + 1) return false;

    // 最近のN個のスコアが連続して下降しているかチェック
    const recentScores = scores.slice(-(this.patienceWindow + 1));

    let isRegressing = true;
    for (let i = 1; i < recentScores.length; i++) {
      if (recentScores[i] >= recentScores[i - 1]) {
        isRegressing = false;
        break;
      }
    }

    return isRegressing;
  }

  /**
   * 停止理由を取得
   * @param {Array<number>} scores - スコア履歴
   * @returns {string} 停止理由
   */
  getStopReason(scores) {
    if (this._hasReachedMaxIterations(scores)) {
      return 'max_iterations';
    }

    if (this._hasScoreRegression(scores)) {
      return 'score_regression';
    }

    if (this.convergenceDetector.isConverged(scores)) {
      return 'converged';
    }

    return 'unknown';
  }

  /**
   * 最良イテレーションを取得
   * @param {Array<number>} scores - スコア履歴
   * @returns {Object} 最良イテレーション情報
   */
  getBestIteration(scores) {
    if (!scores || scores.length === 0) {
      return { iteration: -1, score: 0 };
    }

    let bestIteration = 0;
    let bestScore = scores[0];

    for (let i = 1; i < scores.length; i++) {
      if (scores[i] > bestScore) {
        bestScore = scores[i];
        bestIteration = i;
      }
    }

    return {
      iteration: bestIteration,
      score: bestScore
    };
  }

  /**
   * 早期停止レポートを生成
   * @param {Array<number>} scores - スコア履歴
   * @returns {string}
   */
  generateReport(scores) {
    const shouldStop = this.shouldStop(scores);
    const stopReason = shouldStop ? this.getStopReason(scores) : null;
    const best = this.getBestIteration(scores);
    const latest = scores.length > 0 ? scores[scores.length - 1] : 0;

    const reasonMessages = {
      max_iterations: `Reached maximum iterations (${this.maxIterations})`,
      score_regression: `Score regression detected (overfitting risk)`,
      converged: `Convergence detected (score stabilized)`,
      unknown: 'Unknown reason'
    };

    return `
## Early Stopping Report

**Should Stop**: ${shouldStop ? '✅ Yes' : '❌ No'}
${shouldStop ? `**Reason**: ${reasonMessages[stopReason] || stopReason}` : ''}

### Best Iteration
- Iteration: ${best.iteration + 1}
- Score: ${(best.score * 100).toFixed(1)}%

### Current State
- Current Iteration: ${scores.length}
- Current Score: ${(latest * 100).toFixed(1)}%
- Max Iterations: ${this.maxIterations}
- Patience Window: ${this.patienceWindow}

### Score History
${scores.map((s, i) => {
  const marker = i === best.iteration ? ' 🏆' : '';
  const delta = i > 0 ? ` (${s >= scores[i - 1] ? '+' : ''}${((s - scores[i - 1]) * 100).toFixed(1)}%)` : '';
  return `Iteration ${i + 1}: ${(s * 100).toFixed(1)}%${delta}${marker}`;
}).join('\n')}

### Recommendation
${this._getRecommendation(shouldStop, stopReason, best, scores)}
`;
  }

  /**
   * 推奨アクションを取得
   * @param {boolean} shouldStop - 停止すべきか
   * @param {string} stopReason - 停止理由
   * @param {Object} best - 最良イテレーション
   * @param {Array<number>} scores - スコア履歴
   * @returns {string}
   * @private
   */
  _getRecommendation(shouldStop, stopReason, best, scores) {
    if (!shouldStop) {
      return '⏩ Continue optimization. No stopping condition met.';
    }

    const latest = scores.length - 1;

    if (stopReason === 'max_iterations') {
      if (best.iteration === latest) {
        return `✅ Use the latest iteration (Iteration ${latest + 1}). It has the best score.`;
      } else {
        return `⚠️ Rollback to Iteration ${best.iteration + 1}. It has a better score than the latest.`;
      }
    }

    if (stopReason === 'score_regression') {
      return `⚠️ Rollback to Iteration ${best.iteration + 1}. Overfitting detected. Use the best iteration before regression.`;
    }

    if (stopReason === 'converged') {
      return `✅ Use the latest iteration (Iteration ${latest + 1}). Score has converged.`;
    }

    return 'Unknown recommendation';
  }

  /**
   * 設定を更新
   * @param {Object} options - オプション
   */
  updateSettings({ maxIterations, patienceWindow }) {
    if (maxIterations !== undefined) this.maxIterations = maxIterations;
    if (patienceWindow !== undefined) this.patienceWindow = patienceWindow;
  }
}
