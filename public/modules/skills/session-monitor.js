/**
 * セッション終了時に学習候補を自動抽出するモニター
 * SESSION_ARCHIVEDイベントをリッスンし、Skills使用履歴を記録する
 */
import { eventBus, EVENTS } from '/modules/core/event-bus.js';

export class SessionMonitor {
  constructor({ usageTracker, successClassifier }) {
    this.usageTracker = usageTracker;
    this.successClassifier = successClassifier;
    this._unsubscribe = null;
  }

  /**
   * モニタリング開始
   * SESSION_ARCHIVEDイベントをリッスン
   */
  start() {
    this._unsubscribe = eventBus.onAsync(EVENTS.SESSION_ARCHIVED, async (event) => {
      const { sessionId } = event.detail;
      await this._handleSessionEnd(sessionId);
    });
  }

  /**
   * モニタリング停止
   */
  stop() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  }

  /**
   * セッション終了時の処理
   * @param {string} sessionId - セッションID
   * @private
   */
  async _handleSessionEnd(sessionId) {
    try {
      // 1. 処理済みチェック（idempotency）
      const isProcessed = await this._isProcessed(sessionId);
      if (isProcessed) {
        console.log(`[SessionMonitor] Session ${sessionId} already processed`);
        return;
      }

      // 2. セッションメタデータ取得
      const sessionMeta = await this._getSessionMetadata(sessionId);
      if (!sessionMeta) {
        console.warn(`[SessionMonitor] Session ${sessionId} metadata not found`);
        return;
      }

      // 3. 成功/失敗分類
      const success = await this.successClassifier.classify(sessionMeta);

      // 4. 学習候補抽出（既存の last_result_*.txt から）
      const learnings = await this._extractLearnings(sessionId);

      // 5. Skills使用履歴記録
      await this.usageTracker.record({
        sessionId,
        skillName: this._inferSkillName(sessionMeta),
        timestamp: new Date().toISOString(),
        success,
        metrics: {
          messageCount: sessionMeta.messageCount || 0,
          errorCount: 0, // TODO: 実装
          completionTime: this._calculateCompletionTime(sessionMeta)
        },
        learnings
      });

      // 6. 処理済みマーク
      await this._markProcessed(sessionId);

      console.log(`[SessionMonitor] Session ${sessionId} processed successfully`);
    } catch (error) {
      console.error(`[SessionMonitor] Failed to process session ${sessionId}:`, error);
    }
  }

  /**
   * 処理済みチェック
   * @param {string} sessionId - セッションID
   * @returns {Promise<boolean>}
   * @private
   */
  async _isProcessed(sessionId) {
    try {
      const response = await fetch('/api/skills/processed-sessions');
      const data = await response.json();
      return data.processedSessions.includes(sessionId);
    } catch (error) {
      console.warn('[SessionMonitor] Failed to check processed sessions:', error);
      return false;
    }
  }

  /**
   * 処理済みマーク
   * @param {string} sessionId - セッションID
   * @private
   */
  async _markProcessed(sessionId) {
    try {
      await fetch('/api/skills/processed-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
    } catch (error) {
      console.error('[SessionMonitor] Failed to mark processed:', error);
    }
  }

  /**
   * セッションメタデータ取得
   * @param {string} sessionId - セッションID
   * @returns {Promise<Object|null>}
   * @private
   */
  async _getSessionMetadata(sessionId) {
    try {
      const response = await fetch(`/api/sessions/${sessionId}/metadata`);
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      console.warn('[SessionMonitor] Failed to get session metadata:', error);
      return null;
    }
  }

  /**
   * 学習候補抽出
   * @param {string} sessionId - セッションID
   * @returns {Promise<Array>}
   * @private
   */
  async _extractLearnings(sessionId) {
    try {
      const response = await fetch(`/api/skills/learnings/${sessionId}`);
      if (!response.ok) return [];
      const data = await response.json();
      return data.learnings || [];
    } catch (error) {
      console.warn('[SessionMonitor] Failed to extract learnings:', error);
      return [];
    }
  }

  /**
   * Skill名推論
   * @param {Object} sessionMeta - セッションメタデータ
   * @returns {string}
   * @private
   */
  _inferSkillName(sessionMeta) {
    // firstPromptから推論（例: "### architecture-patterns" が含まれていれば）
    const firstPrompt = sessionMeta.firstPrompt || '';
    const skillMatch = firstPrompt.match(/###\s+([a-z-]+)/);
    return skillMatch ? skillMatch[1] : 'general';
  }

  /**
   * 完了時間計算
   * @param {Object} sessionMeta - セッションメタデータ
   * @returns {number} ミリ秒
   * @private
   */
  _calculateCompletionTime(sessionMeta) {
    if (!sessionMeta.created || !sessionMeta.modified) return 0;
    const start = new Date(sessionMeta.created).getTime();
    const end = new Date(sessionMeta.modified).getTime();
    return end - start;
  }
}
