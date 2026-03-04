/**
 * セッションの成功/失敗を分類するクラシファイア
 */
export class SuccessClassifier {
  /**
   * セッションの成功/失敗を分類
   * @param {Object} sessionMeta - セッションメタデータ
   * @param {number} sessionMeta.messageCount - メッセージ数
   * @param {string} sessionMeta.created - 作成日時
   * @param {string} sessionMeta.modified - 更新日時
   * @param {string} sessionMeta.firstPrompt - 最初のプロンプト
   * @returns {Promise<boolean>} 成功: true, 失敗: false
   */
  async classify(sessionMeta) {
    // 基本的な成功条件チェック
    const hasMessages = sessionMeta.messageCount > 0;
    const hasValidDuration = this._hasValidDuration(sessionMeta);
    const hasCompletionIndicator = this._hasCompletionIndicator(sessionMeta);

    // 総合判定
    return hasMessages && hasValidDuration && hasCompletionIndicator;
  }

  /**
   * 有効なセッション期間を持つか
   * @param {Object} sessionMeta - セッションメタデータ
   * @returns {boolean}
   * @private
   */
  _hasValidDuration(sessionMeta) {
    if (!sessionMeta.created || !sessionMeta.modified) return false;

    const start = new Date(sessionMeta.created).getTime();
    const end = new Date(sessionMeta.modified).getTime();
    const duration = end - start;

    // 最低30秒以上のセッション（あまりに短いセッションは失敗とみなす）
    const MIN_DURATION = 30 * 1000; // 30秒
    // 最大24時間以内（あまりに長いセッションは異常とみなす）
    const MAX_DURATION = 24 * 60 * 60 * 1000; // 24時間

    return duration >= MIN_DURATION && duration <= MAX_DURATION;
  }

  /**
   * 完了を示すインジケーターがあるか
   * @param {Object} sessionMeta - セッションメタデータ
   * @returns {boolean}
   * @private
   */
  _hasCompletionIndicator(sessionMeta) {
    const firstPrompt = sessionMeta.firstPrompt || '';

    // 失敗を示すキーワード
    const failureKeywords = [
      'error',
      'failed',
      'exception',
      'bug',
      'issue',
      'problem',
      'unexpected'
    ];

    // 成功を示すキーワード
    const successKeywords = [
      'completed',
      'success',
      'done',
      'finished',
      'implemented',
      '実装完了',
      '完了',
      '成功'
    ];

    const lowerPrompt = firstPrompt.toLowerCase();

    // 失敗キーワードが多い場合は失敗
    const failureCount = failureKeywords.filter(keyword =>
      lowerPrompt.includes(keyword)
    ).length;

    // 成功キーワードが多い場合は成功
    const successCount = successKeywords.filter(keyword =>
      lowerPrompt.includes(keyword)
    ).length;

    // デフォルトは成功（ネガティブな指標がない限り）
    if (failureCount === 0 && successCount === 0) return true;

    return successCount >= failureCount;
  }

  /**
   * セッションの品質スコアを計算（0-1）
   * @param {Object} sessionMeta - セッションメタデータ
   * @returns {Promise<number>} 品質スコア
   */
  async calculateQualityScore(sessionMeta) {
    let score = 0;

    // メッセージ数による評価（適度な対話があるか）
    const messageCount = sessionMeta.messageCount || 0;
    if (messageCount >= 5 && messageCount <= 50) {
      score += 0.3; // 適度な対話
    } else if (messageCount > 0) {
      score += 0.1; // 最低限の対話
    }

    // セッション期間による評価
    if (this._hasValidDuration(sessionMeta)) {
      score += 0.3;
    }

    // 完了インジケーターによる評価
    if (this._hasCompletionIndicator(sessionMeta)) {
      score += 0.4;
    }

    return Math.min(score, 1.0);
  }
}
