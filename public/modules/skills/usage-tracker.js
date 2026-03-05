/**
 * Skills使用履歴を記録するトラッカー
 * ~/workspace/.claude/skills-usage/ に履歴を保存
 */
export class UsageTracker {
  /**
   * Skills使用履歴を記録
   * @param {Object} data - 使用履歴データ
   * @param {string} data.sessionId - セッションID
   * @param {string} data.skillName - Skill名
   * @param {string} data.timestamp - タイムスタンプ（ISO 8601形式）
   * @param {boolean} data.success - 成功/失敗
   * @param {Object} data.metrics - メトリクス
   * @param {number} data.metrics.messageCount - メッセージ数
   * @param {number} data.metrics.errorCount - エラー数
   * @param {number} data.metrics.completionTime - 完了時間（ミリ秒）
   * @param {Array} data.learnings - 学習候補
   */
  async record(data) {
    try {
      const response = await fetch('/api/skills/usage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        throw new Error(`Failed to record usage: ${response.statusText}`);
      }

      const result = await response.json();
      console.log(`[UsageTracker] Recorded usage for session ${data.sessionId}`);
      return result;
    } catch (error) {
      console.error('[UsageTracker] Failed to record usage:', error);
      throw error;
    }
  }

  /**
   * 特定Skillの使用履歴を取得
   * @param {string} skillName - Skill名
   * @returns {Promise<Array>} 使用履歴の配列
   */
  async getHistory(skillName) {
    try {
      const response = await fetch(`/api/skills/usage/${skillName}`);
      if (!response.ok) {
        throw new Error(`Failed to get history: ${response.statusText}`);
      }

      const data = await response.json();
      return data.history || [];
    } catch (error) {
      console.error('[UsageTracker] Failed to get history:', error);
      return [];
    }
  }

  /**
   * 全Skillsの使用履歴を取得
   * @returns {Promise<Array>} 使用履歴の配列
   */
  async getAllHistory() {
    try {
      const response = await fetch('/api/skills/usage');
      if (!response.ok) {
        throw new Error(`Failed to get all history: ${response.statusText}`);
      }

      const data = await response.json();
      return data.history || [];
    } catch (error) {
      console.error('[UsageTracker] Failed to get all history:', error);
      return [];
    }
  }

  /**
   * 特定Skillの成功率を計算
   * @param {string} skillName - Skill名
   * @returns {Promise<number>} 成功率（0-1）
   */
  async getSuccessRate(skillName) {
    const history = await this.getHistory(skillName);
    if (history.length === 0) return 0;

    const successes = history.filter(h => h.success).length;
    return successes / history.length;
  }
}
