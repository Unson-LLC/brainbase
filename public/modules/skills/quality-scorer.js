/**
 * Skills品質評価エンジン
 * 6次元評価（success_rate, completeness, correctness, conciseness, kernel_score, consistency）
 */
export class QualityScorer {
  /**
   * Skillを評価
   * @param {string} skillName - Skill名
   * @param {Array} usageHistory - 使用履歴
   * @returns {Promise<Object>} 評価結果
   */
  async evaluate(skillName, usageHistory) {
    const metrics = {
      success_rate: this._calculateSuccessRate(usageHistory),
      completeness: await this._checkCompleteness(skillName),
      correctness: await this._checkCorrectness(skillName, usageHistory),
      conciseness: await this._checkConciseness(skillName),
      kernel_score: await this._checkKERNEL(skillName),
      consistency: await this._checkConsistency(skillName)
    };

    const weights = {
      success_rate: 0.3,
      completeness: 0.2,
      correctness: 0.2,
      conciseness: 0.1,
      kernel_score: 0.1,
      consistency: 0.1
    };

    const overallQuality = this._weightedAverage(metrics, weights);

    return { metrics, overallQuality };
  }

  /**
   * 成功率を計算
   * @param {Array} history - 使用履歴
   * @returns {number} 成功率（0-1）
   * @private
   */
  _calculateSuccessRate(history) {
    if (!history || history.length === 0) return 0;

    const successes = history.filter(h => h.success).length;
    return successes / history.length;
  }

  /**
   * 完全性をチェック（必須要素の充足度）
   * @param {string} skillName - Skill名
   * @returns {Promise<number>} 完全性スコア（0-1）
   * @private
   */
  async _checkCompleteness(skillName) {
    try {
      const response = await fetch(`/api/skills/evaluate/completeness`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillName })
      });

      if (!response.ok) {
        throw new Error(`Completeness check failed: ${response.statusText}`);
      }

      const data = await response.json();
      return data.score;
    } catch (error) {
      console.warn('[QualityScorer] Completeness check failed:', error);
      return 0.5; // デフォルトスコア
    }
  }

  /**
   * 正確性をチェック（指示の正確性）
   * @param {string} skillName - Skill名
   * @param {Array} usageHistory - 使用履歴
   * @returns {Promise<number>} 正確性スコア（0-1）
   * @private
   */
  async _checkCorrectness(skillName, usageHistory) {
    try {
      const response = await fetch(`/api/skills/evaluate/correctness`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillName, usageHistory })
      });

      if (!response.ok) {
        throw new Error(`Correctness check failed: ${response.statusText}`);
      }

      const data = await response.json();
      return data.score;
    } catch (error) {
      console.warn('[QualityScorer] Correctness check failed:', error);
      return 0.5; // デフォルトスコア
    }
  }

  /**
   * 簡潔性をチェック（冗長性の逆数）
   * @param {string} skillName - Skill名
   * @returns {Promise<number>} 簡潔性スコア（0-1）
   * @private
   */
  async _checkConciseness(skillName) {
    try {
      const response = await fetch(`/api/skills/evaluate/conciseness`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillName })
      });

      if (!response.ok) {
        throw new Error(`Conciseness check failed: ${response.statusText}`);
      }

      const data = await response.json();
      return data.score;
    } catch (error) {
      console.warn('[QualityScorer] Conciseness check failed:', error);
      return 0.5; // デフォルトスコア
    }
  }

  /**
   * KERNEL準拠度をチェック
   * @param {string} skillName - Skill名
   * @returns {Promise<number>} KERNEL準拠スコア（0-1）
   * @private
   */
  async _checkKERNEL(skillName) {
    try {
      const response = await fetch(`/api/skills/evaluate/kernel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillName })
      });

      if (!response.ok) {
        throw new Error(`KERNEL check failed: ${response.statusText}`);
      }

      const data = await response.json();
      return data.score;
    } catch (error) {
      console.warn('[QualityScorer] KERNEL check failed:', error);
      return 0.5; // デフォルトスコア
    }
  }

  /**
   * 一貫性をチェック（他Skillsとの一貫性）
   * @param {string} skillName - Skill名
   * @returns {Promise<number>} 一貫性スコア（0-1）
   * @private
   */
  async _checkConsistency(skillName) {
    try {
      const response = await fetch(`/api/skills/evaluate/consistency`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillName })
      });

      if (!response.ok) {
        throw new Error(`Consistency check failed: ${response.statusText}`);
      }

      const data = await response.json();
      return data.score;
    } catch (error) {
      console.warn('[QualityScorer] Consistency check failed:', error);
      return 0.5; // デフォルトスコア
    }
  }

  /**
   * 加重平均を計算
   * @param {Object} metrics - 各メトリクス
   * @param {Object} weights - 重み
   * @returns {number} 加重平均
   * @private
   */
  _weightedAverage(metrics, weights) {
    let sum = 0;
    let totalWeight = 0;

    for (const [key, value] of Object.entries(metrics)) {
      if (weights[key] !== undefined) {
        sum += value * weights[key];
        totalWeight += weights[key];
      }
    }

    return totalWeight > 0 ? sum / totalWeight : 0;
  }

  /**
   * スコアを0-100点に変換
   * @param {number} score - スコア（0-1）
   * @returns {number} 0-100点
   */
  toPercentage(score) {
    return Math.round(score * 100);
  }

  /**
   * スコアランクを取得（S/A/B/C/D）
   * @param {number} score - スコア（0-1）
   * @returns {string} ランク
   */
  getRank(score) {
    if (score >= 0.9) return 'S';
    if (score >= 0.8) return 'A';
    if (score >= 0.7) return 'B';
    if (score >= 0.6) return 'C';
    return 'D';
  }
}
