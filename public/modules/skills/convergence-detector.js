/**
 * 収束判定エンジン
 * スコアの収束を検出し、最適化を停止するタイミングを判断
 */
export class ConvergenceDetector {
  constructor({ threshold = 0.90, minImprovement = 0.02 } = {}) {
    this.threshold = threshold; // 絶対スコア閾値（90%）
    this.minImprovement = minImprovement; // 最小改善幅（2%）
  }

  /**
   * 収束判定
   * @param {Array<number>} scores - スコア履歴（時系列）
   * @returns {boolean} 収束したか
   */
  isConverged(scores) {
    if (!scores || scores.length < 2) return false;

    const latest = scores[scores.length - 1];
    const previous = scores[scores.length - 2];

    // 条件1: 絶対スコアが閾値以上
    if (latest >= this.threshold) {
      console.log(`[ConvergenceDetector] Converged: Score ${(latest * 100).toFixed(1)}% >= threshold ${(this.threshold * 100).toFixed(1)}%`);
      return true;
    }

    // 条件2: 改善幅が最小値未満
    const improvement = Math.abs(latest - previous);
    if (improvement < this.minImprovement) {
      console.log(`[ConvergenceDetector] Converged: Improvement ${(improvement * 100).toFixed(1)}% < min ${(this.minImprovement * 100).toFixed(1)}%`);
      return true;
    }

    return false;
  }

  /**
   * 収束までの予測イテレーション数を計算
   * @param {Array<number>} scores - スコア履歴
   * @returns {number} 予測イテレーション数（-1 = 予測不可）
   */
  estimateIterationsToConvergence(scores) {
    if (!scores || scores.length < 3) return -1;

    // 最近の3点から改善率を計算
    const recent = scores.slice(-3);
    const improvementRate1 = recent[1] - recent[0];
    const improvementRate2 = recent[2] - recent[1];

    // 改善率の平均
    const avgImprovementRate = (improvementRate1 + improvementRate2) / 2;

    if (avgImprovementRate <= 0) return -1; // 改善していない

    // 閾値までの距離
    const latest = scores[scores.length - 1];
    const distanceToThreshold = this.threshold - latest;

    if (distanceToThreshold <= 0) return 0; // 既に到達

    // 予測イテレーション数
    const estimatedIterations = Math.ceil(distanceToThreshold / avgImprovementRate);

    return estimatedIterations;
  }

  /**
   * 収束トレンドを分析
   * @param {Array<number>} scores - スコア履歴
   * @returns {Object} トレンド分析結果
   */
  analyzeTrend(scores) {
    if (!scores || scores.length < 2) {
      return {
        trend: 'unknown',
        velocityRaw: 0,
        velocity: 0,
        acceleration: 0
      };
    }

    // 速度（改善率）
    const latest = scores[scores.length - 1];
    const previous = scores[scores.length - 2];
    const velocityRaw = latest - previous;
    const velocity = velocityRaw / previous; // 相対改善率

    // 加速度（改善率の変化）
    let acceleration = 0;
    if (scores.length >= 3) {
      const beforePrevious = scores[scores.length - 3];
      const previousVelocity = (previous - beforePrevious) / beforePrevious;
      acceleration = velocity - previousVelocity;
    }

    // トレンド判定
    let trend = 'stable';
    if (velocity > this.minImprovement) {
      trend = acceleration > 0 ? 'accelerating' : 'improving';
    } else if (velocity < -this.minImprovement) {
      trend = 'declining';
    }

    return {
      trend,
      velocityRaw,
      velocity,
      acceleration
    };
  }

  /**
   * 収束レポートを生成
   * @param {Array<number>} scores - スコア履歴
   * @returns {string}
   */
  generateReport(scores) {
    const converged = this.isConverged(scores);
    const trend = this.analyzeTrend(scores);
    const estimatedIterations = this.estimateIterationsToConvergence(scores);

    const latest = scores[scores.length - 1];
    const improvement = scores.length >= 2
      ? latest - scores[scores.length - 2]
      : 0;

    return `
## Convergence Report

**Status**: ${converged ? '✅ Converged' : '⏳ Not Converged'}

### Current State
- Latest Score: ${(latest * 100).toFixed(1)}%
- Threshold: ${(this.threshold * 100).toFixed(1)}%
- Last Improvement: ${(improvement * 100).toFixed(1)}%
- Min Improvement: ${(this.minImprovement * 100).toFixed(1)}%

### Trend Analysis
- Trend: ${trend.trend}
- Velocity (raw): ${(trend.velocityRaw * 100).toFixed(2)}%
- Velocity (relative): ${(trend.velocity * 100).toFixed(2)}%
- Acceleration: ${(trend.acceleration * 100).toFixed(2)}%

### Prediction
- Estimated Iterations to Convergence: ${estimatedIterations >= 0 ? estimatedIterations : 'N/A'}

### Score History
${scores.map((s, i) => `Iteration ${i + 1}: ${(s * 100).toFixed(1)}%`).join('\n')}
`;
  }

  /**
   * 収束条件を更新
   * @param {Object} options - オプション
   */
  updateConditions({ threshold, minImprovement }) {
    if (threshold !== undefined) this.threshold = threshold;
    if (minImprovement !== undefined) this.minImprovement = minImprovement;
  }
}
